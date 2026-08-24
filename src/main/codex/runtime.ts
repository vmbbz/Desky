import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';

import type { AdapterEvent } from '../../shared/adapter-events';
import type { AgentActionCommand } from '../../shared/agent-actions';
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

export type CodexSandboxMode = 'read-only' | 'workspace-write';

export interface CodexRuntimeConfiguration {
  workspaceDirectory: string;
  sandbox: CodexSandboxMode;
}

export interface CodexClientPort {
  connect(): Promise<unknown>;
  request(method: string, params?: unknown): Promise<unknown>;
  respond(id: number | string, result: unknown): void;
  onNotification(listener: (value: CodexServerNotification) => void): () => void;
  onRequest(listener: (value: CodexServerRequest) => void): () => void;
  onClose(listener: (reason: string) => void): () => void;
  close(): void;
  getStderrPreview(secrets?: Array<string | undefined>): string;
}

export interface CodexRuntimeDependencies {
  appVersion: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  discover?: () => Promise<CodexExecutableAdmission>;
  createClient?: (admission: CodexExecutableAdmission) => CodexClientPort;
  createConnectionId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readCodexRuntimeConfiguration(value: unknown): CodexRuntimeConfiguration {
  if (!isRecord(value)
    || typeof value.workspaceDirectory !== 'string'
    || value.workspaceDirectory.length === 0
    || value.workspaceDirectory.length > 2_048
    || !isAbsolute(value.workspaceDirectory)
    || (value.sandbox !== 'read-only' && value.sandbox !== 'workspace-write')) {
    throw new Error('Invalid Codex runtime configuration.');
  }
  return { workspaceDirectory: value.workspaceDirectory, sandbox: value.sandbox };
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
  private client?: CodexClientPort;
  private normalizer = new CodexProtocolNormalizer();
  private configuration?: CodexRuntimeConfiguration;
  private connectionId?: string;
  private intentionalClose = false;
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
  }

  getState(): AdapterConnectionState { return cloneState(this.state); }

  async connect(configurationValue: unknown): Promise<AdapterConnectionState> {
    const configuration = readCodexRuntimeConfiguration(configurationValue);
    await this.disconnectClient(false);
    this.configuration = configuration;
    this.intentionalClose = false;
    this.patchState({ status: 'connecting', message: 'Starting Codex app-server' });
    try {
      const admission = await this.discover();
      const client = this.createClient(admission);
      this.client = client;
      this.normalizer = new CodexProtocolNormalizer();
      this.unsubscribeClient.push(
        client.onNotification((notification) => this.handleNotification(notification)),
        client.onRequest((request) => this.handleRequest(request)),
        client.onClose((reason) => this.handleClose(reason)),
      );
      readCodexInitializeResponse(await client.connect());
      const account = readCodexAccountState(
        await client.request('account/read', { refreshToken: false }),
      );
      if (account.requiresOpenaiAuth && !account.authenticated) {
        throw new Error('Sign in with the Codex CLI before connecting Desky.');
      }
      const connectionId = this.createConnectionId();
      this.connectionId = connectionId;
      this.patchState({
        status: 'connected',
        runtimeVersion: admission.cliVersion,
        message: 'Codex app-server connected',
        sessions: [],
        selectedSessionId: undefined,
        activeTurnId: undefined,
      });
      this.emitEvent(this.normalizer.connectionReady({ connectionId }, admission.cliVersion));
      await this.refreshSessions();
      return this.getState();
    } catch (error) {
      await this.disconnectClient(false);
      this.connectionId = undefined;
      this.patchState({ status: 'error', message: safeError(error) });
      throw error;
    }
  }

  async disconnect(): Promise<AdapterConnectionState> {
    const connectionId = this.currentConnectionId();
    await this.disconnectClient(true);
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

  private handleClose(reason: string): void {
    if (this.intentionalClose) return;
    const connectionId = this.currentConnectionId();
    this.client = undefined;
    for (const unsubscribe of this.unsubscribeClient.splice(0)) unsubscribe();
    this.pendingApprovals.clear();
    this.patchState({ status: 'error', message: safeError(reason), activeTurnId: undefined });
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
  }

  private failProtocolValidation(): void {
    const connectionId = this.currentConnectionId();
    this.intentionalClose = true;
    for (const unsubscribe of this.unsubscribeClient.splice(0)) unsubscribe();
    this.client?.close();
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
    this.client?.close();
    this.client = undefined;
    this.pendingApprovals.clear();
  }

  private requireClient(): CodexClientPort {
    if (!this.client || this.state.status !== 'connected') throw new Error('Codex app-server is not connected.');
    return this.client;
  }

  private requireConfiguration(): CodexRuntimeConfiguration {
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
