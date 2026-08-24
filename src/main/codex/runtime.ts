import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import type { AdapterEvent } from '../../shared/adapter-events';
import type { AgentActionCommand } from '../../shared/agent-actions';
import type { CodexSandboxMode } from '../../shared/codex-workspace';
import type {
  AdapterConnectionState,
  AdapterCreateSessionInput,
  AdapterResolveApprovalInput,
} from '../../shared/agent-adapter';
import {
  codexAdapterDescriptor,
  codexFoundationCapabilities,
} from '../../shared/codex';
import type { AgentAdapterRuntime } from '../adapters/runtime';
import {
  CodexAppServerClient,
  createCodexProcessFactory,
  type CodexClientClose,
  type CodexServerNotification,
  type CodexServerRequest,
} from './app-server-client';
import {
  buildCodexEnvironment,
  discoverCodexExecutable,
  type CodexExecutableAdmission,
} from './executable-discovery';
import {
  codexApprovalDecision,
  CodexProtocolNormalizer,
  readCodexAccountState,
  readCodexInitializeResponse,
  readCodexSessions,
  readCodexThreadId,
  readCodexTurnId,
  type CodexApprovalRoute,
} from './protocol';

export interface CodexRuntimeConfiguration {
  workspaceGrantId: string;
  sandbox: CodexSandboxMode;
}

interface ResolvedCodexRuntimeConfiguration extends CodexRuntimeConfiguration {
  workspaceDirectory: string;
}

export interface CodexClientPort {
  connect(): Promise<unknown>;
  request(method: string, params?: unknown): Promise<unknown>;
  respond(id: number | string, result: unknown): void;
  respondError(id: number | string, error: { code: number; message: string }): void;
  onNotification(listener: (value: CodexServerNotification) => void): () => void;
  onRequest(listener: (value: CodexServerRequest) => void): () => void;
  onClose(listener: (value: CodexClientClose) => void): () => void;
  close(): Promise<void>;
  getStderrPreview(secrets?: Array<string | undefined>): string;
}

export interface CodexRuntimeDependencies {
  appVersion: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  discover?: () => Promise<CodexExecutableAdmission>;
  createClient?: (admission: CodexExecutableAdmission) => CodexClientPort;
  createConnectionId?: () => string;
  resolveWorkspaceGrant?: (grantId: string, sandbox: CodexSandboxMode) => Promise<string>;
  reconnectDelaysMs?: readonly number[];
  wait?: (milliseconds: number) => Promise<void>;
}

const defaultReconnectDelaysMs = [500, 1_500, 4_000] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readCodexRuntimeConfiguration(value: unknown): CodexRuntimeConfiguration {
  if (!isRecord(value)
    || typeof value.workspaceGrantId !== 'string'
    || value.workspaceGrantId.length === 0
    || value.workspaceGrantId.length > 160
    || (value.sandbox !== 'read-only' && value.sandbox !== 'workspace-write')) {
    throw new Error('Invalid Codex runtime configuration.');
  }
  return { workspaceGrantId: value.workspaceGrantId, sandbox: value.sandbox };
}

function safeError(error: unknown, secrets: Array<string | undefined> = []): string {
  let message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Codex operation failed.';
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  return message
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(token|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
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
      agentActions: {
        ...state.capabilities.agentActions,
        actions: [...state.capabilities.agentActions.actions],
      },
    },
  };
}

export class CodexRuntime implements AgentAdapterRuntime {
  readonly descriptor = codexAdapterDescriptor;
  private readonly stateListeners = new Set<(state: AdapterConnectionState) => void>();
  private readonly eventListeners = new Set<(event: AdapterEvent) => void>();
  private readonly actionListeners = new Set<(command: AgentActionCommand) => void>();
  private readonly pendingApprovals = new Map<string, CodexApprovalRoute>();
  private readonly unsubscribeClient: Array<() => void> = [];
  private readonly environment: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly discover: () => Promise<CodexExecutableAdmission>;
  private readonly createClient: (admission: CodexExecutableAdmission) => CodexClientPort;
  private readonly createConnectionId: () => string;
  private readonly resolveWorkspaceGrant?: (
    grantId: string,
    sandbox: CodexSandboxMode,
  ) => Promise<string>;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly wait: (milliseconds: number) => Promise<void>;
  private client?: CodexClientPort;
  private normalizer = new CodexProtocolNormalizer();
  private configuration?: ResolvedCodexRuntimeConfiguration;
  private connectionId?: string;
  private intentionalClose = false;
  private lifecycleGeneration = 0;
  private state: AdapterConnectionState = {
    schemaVersion: 1,
    adapterId: 'codex',
    descriptor: codexAdapterDescriptor,
    status: 'disconnected',
    endpoint: 'Local stdio',
    authenticationMethod: 'codex-account',
    insecureLocal: false,
    message: 'Connect to a local Codex app-server',
    reconnectAttempt: 0,
    sessions: [],
    capabilities: codexFoundationCapabilities,
  };

  constructor(dependencies: CodexRuntimeDependencies) {
    this.environment = dependencies.environment ?? process.env;
    this.platform = dependencies.platform ?? process.platform;
    this.discover = dependencies.discover
      ?? (() => discoverCodexExecutable(this.environment, this.platform));
    this.createClient = dependencies.createClient ?? ((admission) => new CodexAppServerClient(
      createCodexProcessFactory(admission.executablePath, buildCodexEnvironment(this.environment)),
      dependencies.appVersion,
    ));
    this.createConnectionId = dependencies.createConnectionId ?? randomUUID;
    this.resolveWorkspaceGrant = dependencies.resolveWorkspaceGrant;
    this.reconnectDelaysMs = dependencies.reconnectDelaysMs ?? defaultReconnectDelaysMs;
    this.wait = dependencies.wait
      ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    if (this.reconnectDelaysMs.length > 3
      || this.reconnectDelaysMs.some((delay) => !Number.isSafeInteger(delay) || delay < 0 || delay > 30_000)) {
      throw new Error('Invalid Codex reconnect policy.');
    }
  }

  getState(): AdapterConnectionState { return cloneState(this.state); }

  async connect(configurationValue: unknown): Promise<AdapterConnectionState> {
    const requestedConfiguration = readCodexRuntimeConfiguration(configurationValue);
    this.lifecycleGeneration += 1;
    const generation = this.lifecycleGeneration;
    await this.disconnectClient(false);
    this.intentionalClose = false;
    this.patchState({ status: 'connecting', message: 'Starting Codex app-server' });
    try {
      await this.establishClient(requestedConfiguration, undefined, generation);
      return this.getState();
    } catch (error) {
      const safeMessage = safeError(error, [this.configuration?.workspaceDirectory]);
      try {
        await this.disconnectClient(false);
      } catch {
        this.patchState({ status: 'error', message: 'Codex process-tree termination failed.' });
        throw new Error('Codex process-tree termination failed.');
      }
      this.connectionId = undefined;
      this.configuration = undefined;
      this.patchState({ status: 'error', message: safeMessage, reconnectAttempt: 0 });
      throw new Error(safeMessage);
    }
  }

  async disconnect(): Promise<AdapterConnectionState> {
    this.lifecycleGeneration += 1;
    const connectionId = this.currentConnectionId();
    try {
      await this.disconnectClient(true);
    } catch {
      this.configuration = undefined;
      this.connectionId = undefined;
      this.patchState({
        status: 'error', message: 'Codex process-tree termination failed.', activeTurnId: undefined,
      });
      throw new Error('Codex process-tree termination failed.');
    }
    this.configuration = undefined;
    this.connectionId = undefined;
    this.pendingApprovals.clear();
    this.patchState({
      status: 'disconnected',
      message: 'Codex app-server disconnected',
      sessions: [],
      selectedSessionId: undefined,
      activeTurnId: undefined,
      runtimeVersion: undefined,
      reconnectAttempt: 0,
    });
    if (connectionId) {
      this.emitEvent({
        protocolVersion: 1,
        eventId: `${connectionId}:closed`,
        timestamp: new Date().toISOString(),
        connectionId,
        type: 'connection.closed',
        payload: { reason: 'Disconnected by user' },
      });
    }
    return this.getState();
  }

  async refreshSessions(): Promise<AdapterConnectionState> {
    const client = this.requireClient();
    const sessions = readCodexSessions(await client.request('thread/list', {
      limit: 100,
      archived: false,
      sortKey: 'updated_at',
      sortDirection: 'desc',
    }));
    const selectedSessionId = this.state.selectedSessionId
      && sessions.some((session) => session.id === this.state.selectedSessionId)
      ? this.state.selectedSessionId
      : undefined;
    this.patchState({ sessions, selectedSessionId });
    return this.getState();
  }

  async createSession(input: AdapterCreateSessionInput): Promise<AdapterConnectionState> {
    const client = this.requireClient();
    const configuration = this.requireConfiguration();
    const result = await client.request('thread/start', {
      cwd: configuration.workspaceDirectory,
      approvalPolicy: 'on-request',
      sandbox: configuration.sandbox,
      ephemeral: false,
    });
    const sessionId = readCodexThreadId(result);
    if (input.label?.trim()) {
      await client.request('thread/name/set', { threadId: sessionId, name: input.label.trim().slice(0, 100) });
    }
    await this.refreshSessions();
    this.patchState({ selectedSessionId: sessionId, message: 'Codex thread ready' });
    return this.getState();
  }

  async selectSession(sessionId: string): Promise<AdapterConnectionState> {
    const client = this.requireClient();
    if (!this.state.sessions.some((session) => session.id === sessionId)) {
      throw new Error('Unknown Codex thread.');
    }
    const result = await client.request('thread/resume', { threadId: sessionId });
    if (readCodexThreadId(result) !== sessionId) throw new Error('Codex resumed the wrong thread.');
    this.pendingApprovals.clear();
    this.patchState({ selectedSessionId: sessionId, activeTurnId: undefined, message: 'Codex thread ready' });
    return this.getState();
  }

  async send(message: string): Promise<void> {
    const client = this.requireClient();
    const sessionId = this.state.selectedSessionId;
    if (!sessionId) throw new Error('Select a Codex thread before sending a message.');
    if (this.state.activeTurnId) throw new Error('Codex already has an active turn.');
    const result = await client.request('turn/start', {
      threadId: sessionId,
      input: [{ type: 'text', text: message }],
    });
    const turnId = readCodexTurnId(result);
    this.patchState({ activeTurnId: turnId, message: 'Codex accepted the turn' });
    const context = this.context();
    for (const event of this.normalizer.userInputAccepted(context, sessionId, turnId, message)) {
      this.emitEvent(event);
    }
  }

  async cancel(): Promise<void> {
    const sessionId = this.state.selectedSessionId;
    const turnId = this.state.activeTurnId;
    if (!sessionId || !turnId) return;
    await this.requireClient().request('turn/interrupt', { threadId: sessionId, turnId });
  }

  async resolveApproval(input: AdapterResolveApprovalInput): Promise<void> {
    const route = this.pendingApprovals.get(input.requestId);
    if (!route || route.kind !== input.kind) throw new Error('Unknown or expired Codex approval.');
    this.pendingApprovals.delete(input.requestId);
    this.requireClient().respond(route.rpcId, { decision: codexApprovalDecision(input.decision) });
    this.emitEvent({
      protocolVersion: 1,
      eventId: `${this.currentConnectionId()}:approval:${input.requestId}`,
      timestamp: new Date().toISOString(),
      connectionId: this.currentConnectionId() ?? 'codex',
      sessionId: route.sessionId,
      turnId: route.turnId,
      type: 'approval.resolved',
      payload: { requestId: input.requestId, status: input.decision === 'deny' ? 'denied' : 'allowed' },
    });
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
    return safeError(error, [
      typeof operationInput === 'string' ? operationInput : undefined,
      this.configuration?.workspaceDirectory,
    ]);
  }

  private handleNotification(notification: CodexServerNotification): void {
    let events: AdapterEvent[];
    try {
      events = this.normalizer.normalizeNotification(notification, this.context());
    } catch {
      this.failProtocolValidation();
      return;
    }
    for (const event of events) {
      if (event.type === 'turn.completed' || event.type === 'turn.failed') {
        this.pendingApprovals.clear();
        const message = event.type === 'turn.completed' ? event.payload.summary : event.payload.safeError;
        this.patchState({ activeTurnId: undefined, message });
      }
      this.emitEvent(event);
    }
  }

  private handleRequest(request: CodexServerRequest): void {
    const normalized = this.normalizer.normalizeApprovalRequest(request, this.context());
    if (!normalized) {
      if (request.method === 'item/commandExecution/requestApproval'
        || request.method === 'item/fileChange/requestApproval') {
        this.client?.respond(request.id, { decision: 'decline' });
      } else {
        this.client?.respondError(request.id, {
          code: -32601,
          message: 'Unsupported Codex server request.',
        });
      }
      return;
    }
    if (this.pendingApprovals.size >= 16) {
      this.client?.respond(request.id, { decision: 'decline' });
      return;
    }
    this.pendingApprovals.set(normalized.route.requestId, normalized.route);
    this.emitEvent(normalized.event);
  }

  private handleClose(source: CodexClientPort, close: CodexClientClose): void {
    if (this.intentionalClose || source !== this.client || this.state.status !== 'connected') return;
    void this.reconnectAfterUnexpectedClose(close);
  }

  private async reconnectAfterUnexpectedClose(close: CodexClientClose): Promise<void> {
    const { reason } = close;
    const connectionId = this.currentConnectionId();
    const configuration = this.configuration;
    const selectedSessionId = this.state.selectedSessionId;
    const activeTurnId = this.state.activeTurnId;
    const expiredApprovals = [...this.pendingApprovals.values()];
    this.client = undefined;
    for (const unsubscribe of this.unsubscribeClient.splice(0)) unsubscribe();
    this.pendingApprovals.clear();
    if (connectionId) {
      for (const approval of expiredApprovals) {
        this.emitEvent({
          protocolVersion: 1,
          eventId: `${connectionId}:expired:${approval.requestId}`,
          timestamp: new Date().toISOString(),
          connectionId,
          sessionId: approval.sessionId,
          turnId: approval.turnId,
          type: 'approval.resolved',
          payload: { requestId: approval.requestId, status: 'expired' },
        });
      }
    }
    if (connectionId && activeTurnId) {
      this.emitEvent({
        protocolVersion: 1,
        eventId: `${connectionId}:lost-turn:${activeTurnId}`,
        timestamp: new Date().toISOString(),
        connectionId,
        sessionId: selectedSessionId,
        turnId: activeTurnId,
        type: 'turn.failed',
        payload: { safeError: 'The Codex connection closed. The turn was not replayed.', kind: 'error' },
      });
    }
    this.patchState({ message: safeError(reason), activeTurnId: undefined });
    if (connectionId) {
      this.emitEvent({
        protocolVersion: 1,
        eventId: `${connectionId}:unexpected-close`,
        timestamp: new Date().toISOString(),
        connectionId,
        type: 'connection.closed',
        payload: { reason: safeError(reason) },
      });
    }
    this.connectionId = undefined;
    this.lifecycleGeneration += 1;
    const generation = this.lifecycleGeneration;
    if (!close.reconnectable || !configuration || this.reconnectDelaysMs.length === 0) {
      this.patchState({ status: 'error', reconnectAttempt: 0 });
      return;
    }
    let lastError = safeError(reason, [configuration.workspaceDirectory]);
    for (let index = 0; index < this.reconnectDelaysMs.length; index += 1) {
      const attempt = index + 1;
      this.patchState({
        status: 'reconnecting',
        reconnectAttempt: attempt,
        message: `Restarting Codex app-server (${attempt}/${this.reconnectDelaysMs.length})`,
      });
      await this.wait(this.reconnectDelaysMs[index]);
      if (generation !== this.lifecycleGeneration) return;
      try {
        await this.establishClient(configuration, selectedSessionId, generation);
        return;
      } catch (error) {
        lastError = safeError(error, [configuration.workspaceDirectory]);
        try {
          await this.disconnectClient(false);
        } catch {
          lastError = 'Codex process-tree termination failed.';
          break;
        }
      }
    }
    if (generation !== this.lifecycleGeneration) return;
    this.connectionId = undefined;
    this.patchState({
      status: 'error',
      message: `Codex could not reconnect. ${lastError}`.slice(0, 240),
      activeTurnId: undefined,
    });
  }

  private failProtocolValidation(): void {
    this.lifecycleGeneration += 1;
    const connectionId = this.currentConnectionId();
    this.intentionalClose = true;
    for (const unsubscribe of this.unsubscribeClient.splice(0)) unsubscribe();
    const client = this.client;
    if (client) void client.close().catch(() => undefined);
    this.client = undefined;
    this.pendingApprovals.clear();
    const reason = 'Codex app-server protocol validation failed.';
    this.patchState({ status: 'error', message: reason, activeTurnId: undefined });
    if (connectionId) {
      this.emitEvent({
        protocolVersion: 1,
        eventId: `${connectionId}:protocol-failure`,
        timestamp: new Date().toISOString(),
        connectionId,
        type: 'connection.closed',
        payload: { reason },
      });
    }
    this.connectionId = undefined;
  }

  private async disconnectClient(intentional: boolean): Promise<void> {
    this.intentionalClose = intentional;
    for (const unsubscribe of this.unsubscribeClient.splice(0)) unsubscribe();
    const client = this.client;
    this.client = undefined;
    this.pendingApprovals.clear();
    if (client) await client.close();
  }

  private async establishClient(
    requestedConfiguration: CodexRuntimeConfiguration,
    selectedSessionId: string | undefined,
    generation: number,
  ): Promise<void> {
    if (!this.resolveWorkspaceGrant) throw new Error('Codex workspace selection is unavailable.');
    const workspaceDirectory = await this.resolveWorkspaceGrant(
      requestedConfiguration.workspaceGrantId,
      requestedConfiguration.sandbox,
    );
    if (!workspaceDirectory || workspaceDirectory.length > 2_048 || !isAbsolute(workspaceDirectory)) {
      throw new Error('Codex workspace approval returned an invalid directory.');
    }
    if (generation !== this.lifecycleGeneration) throw new Error('Codex connection was cancelled.');
    const configuration: ResolvedCodexRuntimeConfiguration = {
      ...requestedConfiguration,
      workspaceDirectory,
    };
    this.configuration = configuration;
    const admission = await this.discover();
    if (generation !== this.lifecycleGeneration) throw new Error('Codex connection was cancelled.');
    const client = this.createClient(admission);
    this.client = client;
    this.normalizer = new CodexProtocolNormalizer();
    this.unsubscribeClient.push(
      client.onNotification((notification) => this.handleNotification(notification)),
      client.onRequest((request) => this.handleRequest(request)),
      client.onClose((closeValue) => this.handleClose(client, closeValue)),
    );
    readCodexInitializeResponse(await client.connect());
    const account = readCodexAccountState(
      await client.request('account/read', { refreshToken: false }),
    );
    if (account.requiresOpenaiAuth && !account.authenticated) {
      throw new Error('Sign in with the Codex CLI before connecting Desky.');
    }
    const sessions = readCodexSessions(await client.request('thread/list', {
      limit: 100,
      archived: false,
      sortKey: 'updated_at',
      sortDirection: 'desc',
    }));
    let resumedSessionId: string | undefined;
    if (selectedSessionId && sessions.some((session) => session.id === selectedSessionId)) {
      const resumed = await client.request('thread/resume', { threadId: selectedSessionId });
      if (readCodexThreadId(resumed) !== selectedSessionId) {
        throw new Error('Codex resumed the wrong thread.');
      }
      resumedSessionId = selectedSessionId;
    }
    if (generation !== this.lifecycleGeneration) throw new Error('Codex connection was cancelled.');
    const connectionId = this.createConnectionId();
    this.connectionId = connectionId;
    this.intentionalClose = false;
    this.patchState({
      status: 'connected',
      runtimeVersion: admission.cliVersion,
      message: resumedSessionId ? 'Codex app-server reconnected' : 'Codex app-server connected',
      reconnectAttempt: 0,
      sessions,
      selectedSessionId: resumedSessionId,
      activeTurnId: undefined,
    });
    this.emitEvent(this.normalizer.connectionReady({ connectionId }, admission.cliVersion));
  }

  private requireClient(): CodexClientPort {
    if (!this.client || this.state.status !== 'connected') throw new Error('Codex app-server is not connected.');
    return this.client;
  }

  private requireConfiguration(): ResolvedCodexRuntimeConfiguration {
    if (!this.configuration) throw new Error('Codex runtime is not configured.');
    return this.configuration;
  }

  private context() {
    return {
      connectionId: this.currentConnectionId() ?? 'codex',
      selectedSessionId: this.state.selectedSessionId,
      activeTurnId: this.state.activeTurnId,
    };
  }

  private currentConnectionId(): string | undefined {
    return this.connectionId;
  }

  private patchState(patch: Partial<AdapterConnectionState>): void {
    this.state = { ...this.state, ...patch };
    const next = this.getState();
    for (const listener of this.stateListeners) listener(next);
  }

  private emitEvent(event: AdapterEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }
}
