import { randomUUID } from 'node:crypto';

import type { AdapterEvent } from '../../shared/adapter-events';
import type { AgentActionCommand } from '../../shared/agent-actions';
import type {
  AdapterConnectionState,
  AdapterCreateSessionInput,
  AdapterResolveApprovalInput,
} from '../../shared/agent-adapter';
import {
  hermesAdapterDescriptor,
  hermesFoundationCapabilities,
  type HermesConnectInput,
} from '../../shared/hermes';
import type { AgentAdapterRuntime } from '../adapters/runtime';
import {
  HermesApiClient,
  isHermesReconnectableError,
  readHermesEndpoint,
  type HermesApiAdmission,
  type HermesApiClientPort,
} from './api-client';
import {
  hermesApprovalChoice,
  HermesRunNormalizer,
  type HermesApprovalRoute,
} from './protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readHermesConfiguration(value: unknown): HermesConnectInput {
  if (!isRecord(value)
    || typeof value.endpoint !== 'string'
    || value.endpoint.length > 2_048
    || typeof value.token !== 'string'
    || value.token.length === 0
    || value.token.length > 16_384) {
    throw new Error('Invalid Hermes connection configuration.');
  }
  readHermesEndpoint(value.endpoint);
  return { endpoint: value.endpoint, token: value.token };
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

function safeError(error: unknown, secrets: Array<string | undefined> = []): string {
  let message = error instanceof Error ? error.message : typeof error === 'string'
    ? error
    : 'Hermes operation failed.';
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, '[redacted]');
  }
  return message
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(token|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .slice(0, 240);
}

const defaultReconnectDelaysMs = [500, 2_000, 6_500] as const;
const defaultHealthCheckIntervalMs = 30_000;

export interface HermesRuntimeDependencies {
  createClient?: (configuration: HermesConnectInput) => HermesApiClientPort;
  createConnectionId?: () => string;
  reconnectDelaysMs?: readonly number[];
  healthCheckIntervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

export class HermesRuntime implements AgentAdapterRuntime {
  readonly descriptor = hermesAdapterDescriptor;
  private readonly stateListeners = new Set<(state: AdapterConnectionState) => void>();
  private readonly eventListeners = new Set<(event: AdapterEvent) => void>();
  private readonly actionListeners = new Set<(command: AgentActionCommand) => void>();
  private readonly approvals = new Map<string, HermesApprovalRoute>();
  private readonly createClient: (configuration: HermesConnectInput) => HermesApiClientPort;
  private readonly createConnectionId: () => string;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly healthCheckIntervalMs: number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private client?: HermesApiClientPort;
  private configuration?: HermesConnectInput;
  private admission?: HermesApiAdmission;
  private connectionId?: string;
  private streamAbort?: AbortController;
  private healthTimer?: ReturnType<typeof setTimeout>;
  private reconnectPromise?: Promise<void>;
  private turnTerminal = true;
  private eventSequence = 0;
  private lifecycleGeneration = 0;
  private state: AdapterConnectionState = {
    schemaVersion: 1,
    adapterId: 'hermes',
    descriptor: hermesAdapterDescriptor,
    status: 'disconnected',
    endpoint: '',
    authenticationMethod: 'bearer-token',
    insecureLocal: false,
    message: 'Connect to a Hermes API server',
    reconnectAttempt: 0,
    sessions: [],
    capabilities: hermesFoundationCapabilities,
  };

  constructor(dependencies: HermesRuntimeDependencies = {}) {
    this.createClient = dependencies.createClient
      ?? ((configuration) => new HermesApiClient(configuration.endpoint, configuration.token));
    this.createConnectionId = dependencies.createConnectionId ?? randomUUID;
    this.reconnectDelaysMs = dependencies.reconnectDelaysMs ?? defaultReconnectDelaysMs;
    this.healthCheckIntervalMs = dependencies.healthCheckIntervalMs ?? defaultHealthCheckIntervalMs;
    this.wait = dependencies.wait
      ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    if (this.reconnectDelaysMs.length > 3
      || this.reconnectDelaysMs.some((delay) => !Number.isSafeInteger(delay) || delay < 0 || delay > 30_000)) {
      throw new Error('Invalid Hermes reconnect policy.');
    }
    if (!Number.isSafeInteger(this.healthCheckIntervalMs)
      || this.healthCheckIntervalMs < 0
      || this.healthCheckIntervalMs > 300_000) {
      throw new Error('Invalid Hermes health-check policy.');
    }
  }

  getState(): AdapterConnectionState { return cloneState(this.state); }

  async connect(configurationValue: unknown): Promise<AdapterConnectionState> {
    const configuration = readHermesConfiguration(configurationValue);
    this.lifecycleGeneration += 1;
    this.reconnectPromise = undefined;
    const generation = this.lifecycleGeneration;
    await this.disconnectInternal(false);
    const endpoint = readHermesEndpoint(configuration.endpoint);
    this.patchState({
      status: 'connecting',
      endpoint: endpoint.baseUrl,
      insecureLocal: endpoint.insecureLocal,
      message: 'Verifying Hermes API server',
    });
    const client = this.createClient(configuration);
    try {
      const admission = await client.admit();
      const sessions = await client.listSessions();
      if (generation !== this.lifecycleGeneration) throw new Error('Hermes connection was cancelled.');
      this.client = client;
      this.configuration = { ...configuration };
      this.admission = admission;
      this.connectionId = this.createConnectionId();
      this.patchState({
        status: 'connected',
        message: `Ready via ${admission.model}`,
        runtimeVersion: admission.version,
        sessions,
        selectedSessionId: sessions[0]?.id,
        reconnectAttempt: 0,
      });
      this.emit({ type: 'connection.ready', payload: { runtimeName: 'Hermes Agent' } });
      this.scheduleHealthCheck(generation);
      return this.getState();
    } catch (error) {
      const message = safeError(error, [configuration.token]);
      this.clearHealthCheck();
      this.client = undefined;
      this.configuration = undefined;
      this.admission = undefined;
      this.connectionId = undefined;
      this.patchState({ status: 'error', message, runtimeVersion: undefined, sessions: [] });
      throw new Error(message);
    }
  }

  async disconnect(): Promise<AdapterConnectionState> {
    this.lifecycleGeneration += 1;
    this.reconnectPromise = undefined;
    await this.disconnectInternal(true);
    return this.getState();
  }

  async refreshSessions(): Promise<AdapterConnectionState> {
    const sessions = await this.connectedOperation((client) => client.listSessions());
    const selectedSessionId = this.state.selectedSessionId
      && sessions.some((session) => session.id === this.state.selectedSessionId)
      ? this.state.selectedSessionId
      : sessions[0]?.id;
    this.patchState({ sessions, selectedSessionId });
    return this.getState();
  }

  async createSession(input: AdapterCreateSessionInput): Promise<AdapterConnectionState> {
    if (input.label !== undefined && (typeof input.label !== 'string' || input.label.length > 160)) {
      throw new Error('Invalid Hermes session label.');
    }
    const session = await this.connectedOperation((client) => client.createSession(input.label));
    const sessions = [session, ...this.state.sessions.filter((entry) => entry.id !== session.id)];
    this.patchState({ sessions, selectedSessionId: session.id });
    return this.getState();
  }

  async selectSession(sessionId: string): Promise<AdapterConnectionState> {
    if (!this.state.sessions.some((session) => session.id === sessionId)) {
      throw new Error('Unknown Hermes session.');
    }
    if (this.state.activeTurnId) throw new Error('Cannot switch Hermes sessions during an active turn.');
    this.patchState({ selectedSessionId: sessionId });
    return this.getState();
  }

  async send(message: string): Promise<void> {
    if (!message.trim() || message.length > 64_000) throw new Error('Invalid Hermes message.');
    if (this.state.activeTurnId) throw new Error('Hermes already has an active turn.');
    const sessionId = this.state.selectedSessionId;
    if (!sessionId) throw new Error('Select or create a Hermes session first.');
    const client = this.requireClient();
    const runId = await this.connectedOperation((activeClient) => activeClient.startRun(sessionId, message));
    this.turnTerminal = false;
    this.streamAbort = new AbortController();
    this.patchState({ activeTurnId: runId, message: 'Hermes is working' });
    this.emit({
      type: 'user.input.accepted',
      sessionId,
      turnId: runId,
      payload: { summary: message.trim().slice(0, 180) },
    });
    this.emit({
      type: 'agent.thinking', sessionId, turnId: runId, payload: { status: 'Thinking' },
    });
    const normalizer = new HermesRunNormalizer(this.requireConnectionId(), sessionId, runId);
    void this.consumeRun(client, normalizer, runId, this.streamAbort.signal);
  }

  async cancel(): Promise<void> {
    const runId = this.state.activeTurnId;
    if (!runId) return;
    await this.connectedOperation((client) => client.stopRun(runId));
    this.patchState({ message: 'Stopping Hermes turn' });
  }

  async resolveApproval(input: AdapterResolveApprovalInput): Promise<void> {
    if (input.kind !== 'exec') throw new Error('Hermes only exposes command approvals.');
    const route = this.approvals.get(input.requestId);
    if (!route || route.runId !== this.state.activeTurnId) throw new Error('Unknown or expired Hermes approval.');
    const choice = hermesApprovalChoice(input.decision, route.choices);
    await this.connectedOperation((client) => client.resolveApproval(route.runId, choice));
    this.approvals.delete(input.requestId);
    this.emit({
      type: 'approval.resolved',
      sessionId: this.state.selectedSessionId,
      turnId: route.runId,
      payload: {
        requestId: input.requestId,
        status: input.decision === 'deny' ? 'denied' : 'allowed',
      },
    });
    this.patchState({ message: 'Hermes resumed' });
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
    const token = isRecord(operationInput) && typeof operationInput.token === 'string'
      ? operationInput.token
      : undefined;
    const submittedText = typeof operationInput === 'string' ? operationInput : undefined;
    return safeError(error, [token, submittedText]);
  }

  private async consumeRun(
    client: HermesApiClientPort,
    normalizer: HermesRunNormalizer,
    runId: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await client.streamRun(runId, (nativeEvent) => {
        const result = normalizer.normalize(nativeEvent);
        if (result.approval) this.approvals.set(result.approval.requestId, result.approval);
        for (const event of result.events) this.emitNormalized(event);
        if (result.terminal) this.finishTurn(runId, eventMessage(result.events));
      }, signal);
      if (!this.turnTerminal && !signal.aborted) {
        await this.handleUnexpectedFailure(
          client,
          new Error('Hermes closed the run stream before a terminal event.'),
          true,
        );
      }
    } catch (error) {
      if (!signal.aborted) {
        await this.handleUnexpectedFailure(client, error, isHermesReconnectableError(error));
      }
    }
  }

  private async disconnectInternal(emitClosed: boolean): Promise<void> {
    this.clearHealthCheck();
    const connectionId = this.connectionId;
    const runId = this.state.activeTurnId;
    const streamAbort = this.streamAbort;
    if (runId && this.client) {
      try { await this.client.stopRun(runId); } catch { /* fail closed locally below */ }
      this.failTurn(runId, 'Hermes turn cancelled during disconnect.', 'cancelled');
    }
    streamAbort?.abort();
    this.streamAbort = undefined;
    this.client = undefined;
    this.configuration = undefined;
    this.admission = undefined;
    this.connectionId = undefined;
    this.approvals.clear();
    this.turnTerminal = true;
    this.patchState({
      status: 'disconnected',
      message: 'Hermes API server disconnected',
      sessions: [],
      selectedSessionId: undefined,
      activeTurnId: undefined,
      runtimeVersion: undefined,
      reconnectAttempt: 0,
    });
    if (emitClosed && connectionId) {
      this.emitWithConnection(connectionId, {
        type: 'connection.closed', payload: { reason: 'Disconnected by user' },
      });
    }
  }

  private finishTurn(runId: string, message: string): void {
    if (this.turnTerminal || this.state.activeTurnId !== runId) return;
    this.turnTerminal = true;
    this.approvals.clear();
    this.streamAbort = undefined;
    this.patchState({ activeTurnId: undefined, message });
  }

  private failTurn(runId: string, message: string, kind: 'cancelled' | 'error' = 'error'): void {
    if (this.turnTerminal || this.state.activeTurnId !== runId) return;
    this.emit({
      type: 'turn.failed',
      sessionId: this.state.selectedSessionId,
      turnId: runId,
      payload: { safeError: message, kind },
    });
    this.finishTurn(runId, kind === 'cancelled' ? 'Hermes turn cancelled' : 'Hermes turn failed');
  }

  private requireClient(): HermesApiClientPort {
    if (!this.client || this.state.status !== 'connected') throw new Error('Hermes is not connected.');
    return this.client;
  }

  private requireConnectionId(): string {
    if (!this.connectionId) throw new Error('Hermes is not connected.');
    return this.connectionId;
  }

  private async connectedOperation<T>(
    operation: (client: HermesApiClientPort) => Promise<T>,
  ): Promise<T> {
    const client = this.requireClient();
    try {
      return await operation(client);
    } catch (error) {
      void this.handleUnexpectedFailure(client, error, isHermesReconnectableError(error));
      throw new Error(safeError(error, [this.configuration?.token]));
    }
  }

  private handleUnexpectedFailure(
    source: HermesApiClientPort,
    error: unknown,
    reconnectable: boolean,
  ): Promise<void> {
    if (source !== this.client || this.state.status !== 'connected') {
      return this.reconnectPromise ?? Promise.resolve();
    }
    if (this.reconnectPromise) return this.reconnectPromise;
    const reconnect = this.reconnectAfterUnexpectedFailure(error, reconnectable)
      .finally(() => {
        if (this.reconnectPromise === reconnect) this.reconnectPromise = undefined;
      });
    this.reconnectPromise = reconnect;
    return reconnect;
  }

  private async reconnectAfterUnexpectedFailure(error: unknown, reconnectable: boolean): Promise<void> {
    const reason = safeError(error, [this.configuration?.token]);
    const connectionId = this.connectionId;
    const configuration = this.configuration;
    const expectedAdmission = this.admission;
    const selectedSessionId = this.state.selectedSessionId;
    const activeTurnId = this.state.activeTurnId;
    this.clearHealthCheck();
    this.streamAbort?.abort();
    this.streamAbort = undefined;
    this.client = undefined;
    this.expireApprovals(connectionId, selectedSessionId, activeTurnId);
    if (activeTurnId) {
      this.failTurn(activeTurnId, 'The Hermes connection closed. The turn was not replayed.');
    }
    if (connectionId) {
      this.emitWithConnection(connectionId, {
        type: 'connection.closed', payload: { reason },
      });
    }
    this.connectionId = undefined;
    this.lifecycleGeneration += 1;
    const generation = this.lifecycleGeneration;
    if (!reconnectable || !configuration || !expectedAdmission || this.reconnectDelaysMs.length === 0) {
      this.configuration = undefined;
      this.admission = undefined;
      this.patchState({ status: 'error', message: reason, reconnectAttempt: 0, activeTurnId: undefined });
      return;
    }

    let lastError = reason;
    for (let index = 0; index < this.reconnectDelaysMs.length; index += 1) {
      const attempt = index + 1;
      this.patchState({
        status: 'reconnecting',
        reconnectAttempt: attempt,
        message: `Reconnecting to Hermes (${attempt}/${this.reconnectDelaysMs.length})`,
        activeTurnId: undefined,
      });
      await this.wait(this.reconnectDelaysMs[index]);
      if (generation !== this.lifecycleGeneration) return;
      try {
        const client = this.createClient(configuration);
        const admission = await client.admit();
        if (admission.version !== expectedAdmission.version || admission.model !== expectedAdmission.model) {
          throw new Error('Hermes runtime version or model changed during reconnect.');
        }
        const sessions = await client.listSessions();
        if (generation !== this.lifecycleGeneration) return;
        const restoredSessionId = selectedSessionId
          && sessions.some((session) => session.id === selectedSessionId)
          ? selectedSessionId
          : sessions[0]?.id;
        this.client = client;
        this.admission = admission;
        this.connectionId = this.createConnectionId();
        this.turnTerminal = true;
        this.patchState({
          status: 'connected',
          message: 'Hermes API server reconnected',
          runtimeVersion: admission.version,
          sessions,
          selectedSessionId: restoredSessionId,
          reconnectAttempt: 0,
          activeTurnId: undefined,
        });
        this.emit({ type: 'connection.ready', payload: { runtimeName: 'Hermes Agent' } });
        this.scheduleHealthCheck(generation);
        return;
      } catch (reconnectError) {
        lastError = safeError(reconnectError, [configuration.token]);
        if (!isHermesReconnectableError(reconnectError)) break;
      }
    }
    if (generation !== this.lifecycleGeneration) return;
    this.client = undefined;
    this.configuration = undefined;
    this.admission = undefined;
    this.connectionId = undefined;
    this.patchState({
      status: 'error',
      message: `Hermes could not reconnect. ${lastError}`.slice(0, 240),
      activeTurnId: undefined,
    });
  }

  private expireApprovals(
    connectionId: string | undefined,
    sessionId: string | undefined,
    turnId: string | undefined,
  ): void {
    const approvals = [...this.approvals.values()];
    this.approvals.clear();
    if (!connectionId) return;
    for (const approval of approvals) {
      this.emitWithConnection(connectionId, {
        type: 'approval.resolved',
        sessionId,
        turnId: turnId ?? approval.runId,
        payload: { requestId: approval.requestId, status: 'expired' },
      });
    }
  }

  private scheduleHealthCheck(generation: number): void {
    this.clearHealthCheck();
    if (this.healthCheckIntervalMs === 0) return;
    this.healthTimer = setTimeout(() => {
      this.healthTimer = undefined;
      void this.runHealthCheck(generation);
    }, this.healthCheckIntervalMs);
    this.healthTimer.unref?.();
  }

  private async runHealthCheck(generation: number): Promise<void> {
    if (generation !== this.lifecycleGeneration || this.state.status !== 'connected') return;
    if (this.state.activeTurnId) {
      this.scheduleHealthCheck(generation);
      return;
    }
    const client = this.client;
    const expectedAdmission = this.admission;
    if (!client || !expectedAdmission) return;
    try {
      const admission = await client.admit();
      if (admission.version !== expectedAdmission.version || admission.model !== expectedAdmission.model) {
        throw new Error('Hermes runtime version or model changed during health check.');
      }
      this.scheduleHealthCheck(generation);
    } catch (error) {
      await this.handleUnexpectedFailure(client, error, isHermesReconnectableError(error));
    }
  }

  private clearHealthCheck(): void {
    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.healthTimer = undefined;
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

function eventMessage(events: AdapterEvent[]): string {
  let terminal: AdapterEvent | undefined;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === 'turn.completed' || events[index].type === 'turn.failed') {
      terminal = events[index];
      break;
    }
  }
  return terminal?.type === 'turn.completed' ? 'Hermes turn completed'
    : terminal?.type === 'turn.failed' && terminal.payload.kind === 'cancelled'
      ? 'Hermes turn cancelled'
      : 'Hermes turn failed';
}
