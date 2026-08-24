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
import { HermesApiClient, readHermesEndpoint, type HermesApiClientPort } from './api-client';
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

export interface HermesRuntimeDependencies {
  createClient?: (configuration: HermesConnectInput) => HermesApiClientPort;
  createConnectionId?: () => string;
}

export class HermesRuntime implements AgentAdapterRuntime {
  readonly descriptor = hermesAdapterDescriptor;
  private readonly stateListeners = new Set<(state: AdapterConnectionState) => void>();
  private readonly eventListeners = new Set<(event: AdapterEvent) => void>();
  private readonly actionListeners = new Set<(command: AgentActionCommand) => void>();
  private readonly approvals = new Map<string, HermesApprovalRoute>();
  private readonly createClient: (configuration: HermesConnectInput) => HermesApiClientPort;
  private readonly createConnectionId: () => string;
  private client?: HermesApiClientPort;
  private connectionId?: string;
  private streamAbort?: AbortController;
  private turnTerminal = true;
  private eventSequence = 0;
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
  }

  getState(): AdapterConnectionState { return cloneState(this.state); }

  async connect(configurationValue: unknown): Promise<AdapterConnectionState> {
    const configuration = readHermesConfiguration(configurationValue);
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
      this.client = client;
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
      return this.getState();
    } catch (error) {
      const message = safeError(error, [configuration.token]);
      this.client = undefined;
      this.connectionId = undefined;
      this.patchState({ status: 'error', message, runtimeVersion: undefined, sessions: [] });
      throw new Error(message);
    }
  }

  async disconnect(): Promise<AdapterConnectionState> {
    await this.disconnectInternal(true);
    return this.getState();
  }

  async refreshSessions(): Promise<AdapterConnectionState> {
    const sessions = await this.requireClient().listSessions();
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
    const session = await this.requireClient().createSession(input.label);
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
    const client = this.requireClient();
    const sessionId = this.state.selectedSessionId;
    if (!sessionId) throw new Error('Select or create a Hermes session first.');
    const runId = await client.startRun(sessionId, message);
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
    await this.requireClient().stopRun(runId);
    this.patchState({ message: 'Stopping Hermes turn' });
  }

  async resolveApproval(input: AdapterResolveApprovalInput): Promise<void> {
    if (input.kind !== 'exec') throw new Error('Hermes only exposes command approvals.');
    const route = this.approvals.get(input.requestId);
    if (!route || route.runId !== this.state.activeTurnId) throw new Error('Unknown or expired Hermes approval.');
    const choice = hermesApprovalChoice(input.decision, route.choices);
    await this.requireClient().resolveApproval(route.runId, choice);
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
        this.failTurn(runId, 'Hermes closed the run stream before a terminal event.');
      }
    } catch (error) {
      if (!signal.aborted) this.failTurn(runId, safeError(error));
    }
  }

  private async disconnectInternal(emitClosed: boolean): Promise<void> {
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
