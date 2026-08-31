import { randomUUID } from 'node:crypto';

import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import type { AdapterEvent } from '../../shared/adapter-events';
import type { AgentActionCommand } from '../../shared/agent-actions';
import type { CodexSandboxMode } from '../../shared/codex-workspace';
import type {
  AdapterConnectionState,
  AdapterCreateSessionInput,
  AdapterResolveApprovalInput,
  ApprovalKind,
} from '../../shared/agent-adapter';
import { claudeAdapterDescriptor, claudeFoundationCapabilities } from '../../shared/claude';
import type { AgentAdapterRuntime } from '../adapters/runtime';
import {
  CLAUDE_AGENT_SDK_VERSION,
  ClaudeSdkClient,
  type ClaudePermissionRequest,
  type ClaudeSdkClientPort,
  type ClaudeSdkQueryHandle,
} from './sdk-client';
import { claudeApprovalPresentation, ClaudeProtocolNormalizer } from './protocol';

export interface ClaudeRuntimeConfiguration {
  workspaceGrantId: string;
  apiKey?: string;
  rememberApiKey: boolean;
  permissionMode: 'plan' | 'default';
}

interface ResolvedClaudeConfiguration extends Omit<ClaudeRuntimeConfiguration, 'apiKey'> {
  apiKey: string;
  workspaceDirectory: string;
}

interface StoredClaudeCredential {
  version: 1;
  apiKey: string;
}

export interface ClaudeCredentialVault {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

export const claudeCredentialVaultKey = 'claude:active-profile';

interface PendingClaudeApproval {
  requestId: string;
  kind: ApprovalKind;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[];
  resolve: (result: PermissionResult) => void;
  abortListener: () => void;
  signal: AbortSignal;
}

export interface ClaudeRuntimeDependencies {
  appVersion: string;
  environment?: NodeJS.ProcessEnv;
  cliExecutablePath?: string;
  createClient?: () => ClaudeSdkClientPort;
  createConnectionId?: () => string;
  createTurnId?: () => string;
  resolveWorkspaceGrant?: (grantId: string, sandbox: CodexSandboxMode) => Promise<string>;
  vault?: ClaudeCredentialVault;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readClaudeConfiguration(value: unknown): ClaudeRuntimeConfiguration {
  if (!isRecord(value)
    || typeof value.workspaceGrantId !== 'string'
    || value.workspaceGrantId.length === 0
    || value.workspaceGrantId.length > 160
    || (value.apiKey !== undefined && (typeof value.apiKey !== 'string'
      || value.apiKey.length === 0
      || value.apiKey.length > 16_384))
    || (value.rememberApiKey !== undefined && typeof value.rememberApiKey !== 'boolean')
    || (value.permissionMode !== 'plan' && value.permissionMode !== 'default')) {
    throw new Error('Invalid Claude connection configuration.');
  }
  return {
    workspaceGrantId: value.workspaceGrantId,
    ...(value.apiKey === undefined ? {} : { apiKey: value.apiKey }),
    rememberApiKey: value.rememberApiKey ?? false,
    permissionMode: value.permissionMode,
  };
}

function readStoredCredential(value: unknown): StoredClaudeCredential | undefined {
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.apiKey !== 'string'
    || value.apiKey.length === 0
    || value.apiKey.length > 16_384) return undefined;
  return { version: 1, apiKey: value.apiKey };
}

function safeError(error: unknown, secrets: Array<string | undefined> = []): string {
  let message = error instanceof Error ? error.message : typeof error === 'string'
    ? error
    : 'Claude operation failed.';
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  return message
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(token|password|authorization|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .slice(0, 240);
}

function cloneState(state: AdapterConnectionState): AdapterConnectionState {
  return {
    ...state,
    descriptor: {
      ...state.descriptor,
      distributionProfiles: [...state.descriptor.distributionProfiles],
      authenticationMethods: state.descriptor.authenticationMethods.map((method) => ({ ...method })),
    },
    sessions: state.sessions.map((session) => ({ ...session })),
    capabilities: {
      ...state.capabilities,
      voiceInput: { ...state.capabilities.voiceInput },
      voiceConversation: {
        ...state.capabilities.voiceConversation,
        inputFormats: state.capabilities.voiceConversation.inputFormats.map((format) => ({ ...format })),
        outputFormats: state.capabilities.voiceConversation.outputFormats.map((format) => ({ ...format })),
      },
      agentActions: {
        ...state.capabilities.agentActions,
        actions: [...state.capabilities.agentActions.actions],
      },
    },
  };
}

function approvalKind(toolName: string): ApprovalKind {
  return ['Write', 'Edit', 'NotebookEdit'].includes(toolName) ? 'file-change' : 'exec';
}

export class ClaudeRuntime implements AgentAdapterRuntime {
  readonly descriptor = claudeAdapterDescriptor;
  private readonly stateListeners = new Set<(state: AdapterConnectionState) => void>();
  private readonly eventListeners = new Set<(event: AdapterEvent) => void>();
  private readonly actionListeners = new Set<(command: AgentActionCommand) => void>();
  private readonly approvals = new Map<string, PendingClaudeApproval>();
  private readonly createClient: () => ClaudeSdkClientPort;
  private readonly createConnectionId: () => string;
  private readonly createTurnId: () => string;
  private readonly resolveWorkspaceGrant?: (
    grantId: string,
    sandbox: CodexSandboxMode,
  ) => Promise<string>;
  private readonly vault?: ClaudeCredentialVault;
  private client?: ClaudeSdkClientPort;
  private configuration?: ResolvedClaudeConfiguration;
  private connectionId?: string;
  private query?: ClaudeSdkQueryHandle;
  private turnTerminal = true;
  private eventSequence = 0;
  private state: AdapterConnectionState = {
    schemaVersion: 1,
    adapterId: 'claude',
    descriptor: claudeAdapterDescriptor,
    status: 'disconnected',
    endpoint: 'Local Agent SDK',
    authenticationMethod: 'anthropic-api-key',
    insecureLocal: false,
    message: 'Connect with an Anthropic API key',
    runtimeVersion: `Agent SDK ${CLAUDE_AGENT_SDK_VERSION}`,
    reconnectAttempt: 0,
    sessions: [],
    capabilities: claudeFoundationCapabilities,
  };

  constructor(dependencies: ClaudeRuntimeDependencies) {
    this.createClient = dependencies.createClient
      ?? (() => new ClaudeSdkClient(
        dependencies.environment,
        undefined,
        dependencies.cliExecutablePath,
      ));
    this.createConnectionId = dependencies.createConnectionId ?? randomUUID;
    this.createTurnId = dependencies.createTurnId ?? randomUUID;
    this.resolveWorkspaceGrant = dependencies.resolveWorkspaceGrant;
    this.vault = dependencies.vault;
    this.appVersion = dependencies.appVersion;
  }

  private readonly appVersion: string;

  getState(): AdapterConnectionState { return cloneState(this.state); }

  async connect(configurationValue: unknown): Promise<AdapterConnectionState> {
    const requested = readClaudeConfiguration(configurationValue);
    if (!this.resolveWorkspaceGrant) throw new Error('Claude workspace selection is unavailable.');
    if (requested.rememberApiKey && !this.vault) {
      throw new Error('Secure Claude credential storage is unavailable.');
    }
    await this.disconnectInternal(false);
    this.patchState({ status: 'connecting', message: 'Preparing Claude Agent SDK' });
    try {
      const sandbox: CodexSandboxMode = requested.permissionMode === 'plan'
        ? 'read-only'
        : 'workspace-write';
      const workspaceDirectory = await this.resolveWorkspaceGrant(requested.workspaceGrantId, sandbox);
      const saved = requested.apiKey === undefined
        ? readStoredCredential(this.vault?.get<unknown>(claudeCredentialVaultKey))
        : undefined;
      const apiKey = requested.apiKey ?? saved?.apiKey;
      if (!apiKey) {
        throw new Error('Anthropic API key is required. Enter it or use saved access.');
      }
      const client = this.createClient();
      const sessions = await client.listSessions(workspaceDirectory);
      this.client = client;
      this.configuration = { ...requested, apiKey, workspaceDirectory };
      this.connectionId = this.createConnectionId();
      this.patchState({
        status: 'connected',
        message: requested.permissionMode === 'plan'
          ? 'Claude ready in plan mode; authentication verifies on first turn'
          : 'Claude ready with on-request permissions; authentication verifies on first turn',
        sessions,
        selectedSessionId: sessions[0]?.id,
        reconnectAttempt: 0,
      });
      this.emit({ type: 'connection.ready', payload: { runtimeName: 'Claude Agent SDK' } });
      return this.getState();
    } catch (error) {
      const message = safeError(error, [requested.apiKey]);
      this.client = undefined;
      this.configuration = undefined;
      this.connectionId = undefined;
      this.patchState({ status: 'error', message, sessions: [], selectedSessionId: undefined });
      throw new Error(message);
    }
  }

  async disconnect(): Promise<AdapterConnectionState> {
    await this.disconnectInternal(true);
    return this.getState();
  }

  async refreshSessions(): Promise<AdapterConnectionState> {
    const configuration = this.requireConfiguration();
    const sessions = await this.requireClient().listSessions(configuration.workspaceDirectory);
    const selectedSessionId = this.state.selectedSessionId
      && sessions.some((session) => session.id === this.state.selectedSessionId)
      ? this.state.selectedSessionId
      : sessions[0]?.id;
    this.patchState({ sessions, selectedSessionId });
    return this.getState();
  }

  async createSession(input: AdapterCreateSessionInput): Promise<AdapterConnectionState> {
    if (input.label !== undefined && (typeof input.label !== 'string' || input.label.length > 160)) {
      throw new Error('Invalid Claude session label.');
    }
    if (this.state.activeTurnId) throw new Error('Cannot create a Claude session during an active turn.');
    this.patchState({
      selectedSessionId: undefined,
      message: 'New Claude session will be created with the next message',
    });
    return this.getState();
  }

  async selectSession(sessionId: string): Promise<AdapterConnectionState> {
    if (!this.state.sessions.some((session) => session.id === sessionId)) {
      throw new Error('Unknown Claude session.');
    }
    if (this.state.activeTurnId) throw new Error('Cannot switch Claude sessions during an active turn.');
    this.patchState({ selectedSessionId: sessionId });
    return this.getState();
  }

  async send(message: string): Promise<void> {
    if (!message.trim() || message.length > 64_000) throw new Error('Invalid Claude message.');
    if (this.state.activeTurnId) throw new Error('Claude already has an active turn.');
    const client = this.requireClient();
    const configuration = this.requireConfiguration();
    const turnId = this.createTurnId();
    this.turnTerminal = false;
    this.patchState({ activeTurnId: turnId, message: 'Claude is working' });
    this.emit({
      type: 'user.input.accepted',
      sessionId: this.state.selectedSessionId,
      turnId,
      payload: { summary: message.trim().slice(0, 180) },
    });
    this.emit({
      type: 'agent.thinking',
      sessionId: this.state.selectedSessionId,
      turnId,
      payload: { status: 'Thinking' },
    });
    try {
      this.query = await client.start({
        prompt: message,
        cwd: configuration.workspaceDirectory,
        apiKey: configuration.apiKey,
        appVersion: this.appVersion,
        resumeSessionId: this.state.selectedSessionId,
        permissionMode: configuration.permissionMode,
        onPermission: (request) => this.requestApproval(request, turnId),
      });
      const normalizer = new ClaudeProtocolNormalizer({
        connectionId: this.requireConnectionId(),
        selectedSessionId: this.state.selectedSessionId,
        turnId,
        expectedCwd: configuration.workspaceDirectory,
        expectedPermissionMode: configuration.permissionMode,
      });
      void this.consumeQuery(this.query, normalizer, turnId);
    } catch (error) {
      this.failTurn(turnId, safeError(error, [configuration.apiKey]));
      throw error;
    }
  }

  async cancel(): Promise<void> {
    const turnId = this.state.activeTurnId;
    if (!turnId) return;
    this.query?.abort();
    this.query?.close();
    this.denyPendingApprovals('Claude turn cancelled.');
    this.failTurn(turnId, 'Claude turn cancelled.', 'cancelled');
  }

  async resolveApproval(input: AdapterResolveApprovalInput): Promise<void> {
    const pending = this.approvals.get(input.requestId);
    if (!pending || pending.kind !== input.kind || !this.state.activeTurnId) {
      throw new Error('Unknown or expired Claude approval.');
    }
    if (input.decision === 'allow-always' && pending.suggestions.length === 0) {
      throw new Error('Claude did not offer a persistent approval scope.');
    }
    this.approvals.delete(input.requestId);
    pending.signal.removeEventListener('abort', pending.abortListener);
    pending.resolve(input.decision === 'deny'
      ? { behavior: 'deny', message: 'Denied by user.' }
      : {
          behavior: 'allow',
          updatedInput: pending.input,
          ...(input.decision === 'allow-always'
            ? { updatedPermissions: pending.suggestions }
            : {}),
        });
    this.emit({
      type: 'approval.resolved',
      sessionId: this.state.selectedSessionId,
      turnId: this.state.activeTurnId,
      payload: {
        requestId: input.requestId,
        status: input.decision === 'deny' ? 'denied' : 'allowed',
      },
    });
    this.patchState({ message: 'Claude resumed' });
  }

  onState(listener: (state: AdapterConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onEvent(listener: (event: AdapterEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onAction(listener: (command: AgentActionCommand) => void): () => void {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  rendererSafeError(error: unknown, operationInput?: unknown): string {
    const key = isRecord(operationInput) && typeof operationInput.apiKey === 'string'
      ? operationInput.apiKey
      : undefined;
    const text = typeof operationInput === 'string' ? operationInput : undefined;
    return safeError(error, [key, text, this.configuration?.apiKey, this.configuration?.workspaceDirectory]);
  }

  private requestApproval(request: ClaudePermissionRequest, turnId: string): Promise<PermissionResult> {
    if (turnId !== this.state.activeTurnId
      || !request.requestId
      || request.requestId.length > 512
      || this.approvals.has(request.requestId)) {
      return Promise.resolve({ behavior: 'deny', message: 'Invalid or stale approval request.' });
    }
    return new Promise((resolve) => {
      const kind = approvalKind(request.toolName);
      const suggestions = (request.suggestions ?? []).filter(isRecord) as PermissionUpdate[];
      const abortListener = () => {
        if (!this.approvals.delete(request.requestId)) return;
        resolve({ behavior: 'deny', message: 'Approval request cancelled.' });
        this.emit({
          type: 'approval.resolved',
          sessionId: this.state.selectedSessionId,
          turnId,
          payload: { requestId: request.requestId, status: 'cancelled' },
        });
      };
      this.approvals.set(request.requestId, {
        requestId: request.requestId,
        kind,
        input: request.input,
        suggestions,
        resolve,
        abortListener,
        signal: request.signal,
      });
      request.signal.addEventListener('abort', abortListener, { once: true });
      const presentation = claudeApprovalPresentation(request.toolName, request.input, request);
      this.emit({
        type: 'approval.requested',
        sessionId: this.state.selectedSessionId,
        turnId,
        payload: {
          requestId: request.requestId,
          kind,
          action: presentation.action,
          safeTarget: presentation.safeTarget,
          allowedDecisions: suggestions.length > 0
            ? ['allow-once', 'allow-always', 'deny']
            : ['allow-once', 'deny'],
        },
      });
      this.patchState({ message: 'Claude is waiting for approval' });
    });
  }

  private async consumeQuery(
    query: ClaudeSdkQueryHandle,
    normalizer: ClaudeProtocolNormalizer,
    turnId: string,
  ): Promise<void> {
    try {
      for await (const message of query.messages) {
        const result = normalizer.normalize(message);
        if (result.init) {
          const session = {
            id: result.init.sessionId,
            label: this.state.sessions.find((entry) => entry.id === result.init?.sessionId)?.label
              ?? 'Claude session',
            updatedAt: Date.now(),
          };
          this.patchState({
            selectedSessionId: result.init.sessionId,
            runtimeVersion: `Claude Code ${result.init.runtimeVersion} / SDK ${CLAUDE_AGENT_SDK_VERSION}`,
            sessions: [session, ...this.state.sessions.filter((entry) => entry.id !== session.id)],
            message: `Claude is working via ${result.init.model}`,
          });
        }
        if (result.events.some((event) => event.type === 'turn.completed')) {
          this.settleCredentialAfterSuccessfulTurn();
        }
        for (const event of result.events) this.emitNormalized(event);
        if (result.terminal) this.finishTurn(turnId, terminalMessage(result.events));
      }
      if (!this.turnTerminal) this.failTurn(turnId, 'Claude query closed before a terminal result.');
    } catch (error) {
      if (!this.turnTerminal) this.failTurn(turnId, safeError(error, [this.configuration?.apiKey]));
    } finally {
      query.close();
      if (this.query === query) this.query = undefined;
    }
  }

  private async disconnectInternal(emitClosed: boolean): Promise<void> {
    const connectionId = this.connectionId;
    const turnId = this.state.activeTurnId;
    if (turnId) {
      this.query?.abort();
      this.query?.close();
      this.denyPendingApprovals('Claude disconnected.');
      this.failTurn(turnId, 'Claude turn cancelled during disconnect.', 'cancelled');
    }
    this.query = undefined;
    this.client = undefined;
    this.configuration = undefined;
    this.connectionId = undefined;
    this.turnTerminal = true;
    this.patchState({
      status: 'disconnected',
      message: 'Claude Agent SDK disconnected',
      sessions: [],
      selectedSessionId: undefined,
      activeTurnId: undefined,
      runtimeVersion: `Agent SDK ${CLAUDE_AGENT_SDK_VERSION}`,
      reconnectAttempt: 0,
    });
    if (emitClosed && connectionId) {
      this.emitWithConnection(connectionId, {
        type: 'connection.closed', payload: { reason: 'Disconnected by user' },
      });
    }
  }

  private denyPendingApprovals(message: string): void {
    for (const pending of this.approvals.values()) {
      pending.signal.removeEventListener('abort', pending.abortListener);
      pending.resolve({ behavior: 'deny', message });
    }
    this.approvals.clear();
  }

  private settleCredentialAfterSuccessfulTurn(): void {
    const configuration = this.requireConfiguration();
    if (configuration.rememberApiKey) {
      if (!this.vault) throw new Error('Secure Claude credential storage is unavailable.');
      this.vault.set(claudeCredentialVaultKey, {
        version: 1,
        apiKey: configuration.apiKey,
      } satisfies StoredClaudeCredential);
    } else {
      this.vault?.delete(claudeCredentialVaultKey);
    }
  }

  private finishTurn(turnId: string, message: string): void {
    if (this.turnTerminal || this.state.activeTurnId !== turnId) return;
    this.turnTerminal = true;
    this.denyPendingApprovals('Claude turn ended.');
    this.patchState({ activeTurnId: undefined, message });
  }

  private failTurn(turnId: string, message: string, kind: 'cancelled' | 'error' = 'error'): void {
    if (this.turnTerminal || this.state.activeTurnId !== turnId) return;
    this.emit({
      type: 'turn.failed',
      sessionId: this.state.selectedSessionId,
      turnId,
      payload: { safeError: message, kind },
    });
    this.finishTurn(turnId, kind === 'cancelled' ? 'Claude turn cancelled' : 'Claude turn failed');
  }

  private requireClient(): ClaudeSdkClientPort {
    if (!this.client || this.state.status !== 'connected') throw new Error('Claude is not connected.');
    return this.client;
  }

  private requireConfiguration(): ResolvedClaudeConfiguration {
    if (!this.configuration) throw new Error('Claude is not connected.');
    return this.configuration;
  }

  private requireConnectionId(): string {
    if (!this.connectionId) throw new Error('Claude is not connected.');
    return this.connectionId;
  }

  private patchState(patch: Partial<AdapterConnectionState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of this.stateListeners) listener(snapshot);
  }

  private emitNormalized(event: AdapterEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private emit(input: Omit<AdapterEvent, 'protocolVersion' | 'eventId' | 'timestamp' | 'connectionId'>): void {
    this.emitWithConnection(this.requireConnectionId(), input);
  }

  private emitWithConnection(
    connectionId: string,
    input: Omit<AdapterEvent, 'protocolVersion' | 'eventId' | 'timestamp' | 'connectionId'>,
  ): void {
    this.eventSequence += 1;
    this.emitNormalized({
      ...input,
      protocolVersion: 1,
      eventId: `${connectionId}:runtime:${this.eventSequence}`,
      timestamp: new Date().toISOString(),
      connectionId,
    } as AdapterEvent);
  }
}

function terminalMessage(events: AdapterEvent[]): string {
  const terminal = events.find((event) => event.type === 'turn.completed' || event.type === 'turn.failed');
  return terminal?.type === 'turn.completed' ? 'Claude turn completed' : 'Claude turn failed';
}
