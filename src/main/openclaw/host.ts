import { randomUUID } from 'node:crypto';

import type { AdapterEvent } from '../../shared/adapter-events';
import type {
  OpenClawConnectInput,
  OpenClawConnectionState,
  OpenClawResolveApprovalInput,
  OpenClawSessionSummary,
} from '../../shared/openclaw';
import { OpenClawGatewayClient, type GatewayConnectOptions } from './gateway-client';
import {
  findPairingRequestId,
  GatewayRequestError,
  generateDeviceIdentity,
  normalizeGatewayUrl,
  normalizeOpenClawEvent,
  type DeviceIdentity,
} from './protocol';
import type { SecureVault } from './secure-vault';

interface StoredProfile {
  gatewayUrl: string;
  authKind: 'token' | 'password';
  credential?: string;
  deviceToken?: string;
  selectedSessionKey?: string;
}

interface SessionsListResult {
  sessions?: unknown[];
}

interface ApprovalResolution {
  applied: boolean;
  status: 'allowed' | 'denied' | 'expired' | 'cancelled';
}

interface AbortAcknowledgement {
  status: 'aborted' | 'no-active-run';
  abortedRunId: string | null;
}

const profileIndexKey = 'openclaw:active-profile';
const identityKey = 'openclaw:device-identity';

function cloneState(state: OpenClawConnectionState): OpenClawConnectionState {
  return { ...state, sessions: state.sessions.map((session) => ({ ...session })) };
}

export function redactOpenClawError(error: unknown, secrets: Array<string | undefined> = []): string {
  const raw = error instanceof Error ? error.message : 'OpenClaw operation failed.';
  let redacted = raw;
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(secret, '[redacted]');
  }
  return redacted
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(token|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .slice(0, 240);
}

function sessionSummary(value: unknown): OpenClawSessionSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const key = typeof row.key === 'string' ? row.key : undefined;
  if (!key) return undefined;
  const label = typeof row.label === 'string' && row.label.trim()
    ? row.label.trim()
    : typeof row.displayName === 'string' && row.displayName.trim()
      ? row.displayName.trim()
      : key;
  return {
    key,
    label: label.slice(0, 100),
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : undefined,
  };
}

function approvalResolution(value: unknown, requestId: string): ApprovalResolution {
  if (!value || typeof value !== 'object') {
    throw new Error('Gateway returned an invalid approval acknowledgement.');
  }
  const result = value as Record<string, unknown>;
  const approval = result.approval;
  if (typeof result.applied !== 'boolean' || !approval || typeof approval !== 'object') {
    throw new Error('Gateway returned an invalid approval acknowledgement.');
  }
  const record = approval as Record<string, unknown>;
  const terminalStatuses = ['allowed', 'denied', 'expired', 'cancelled'] as const;
  const status = terminalStatuses.find((candidate) => candidate === record.status);
  if (record.id !== requestId || !status) {
    throw new Error('Gateway returned an invalid approval acknowledgement.');
  }
  return { applied: result.applied, status };
}

function abortAcknowledgement(value: unknown, requestedRunId?: string): AbortAcknowledgement {
  if (!value || typeof value !== 'object') {
    throw new Error('Gateway returned an invalid cancellation acknowledgement.');
  }
  const result = value as Record<string, unknown>;
  const status = result.status === 'aborted' || result.status === 'no-active-run'
    ? result.status
    : undefined;
  const abortedRunId = typeof result.abortedRunId === 'string'
    ? result.abortedRunId
    : result.abortedRunId === null
      ? null
      : undefined;
  if (result.ok !== true || !status || abortedRunId === undefined
    || (status === 'aborted' && (!abortedRunId || (requestedRunId && abortedRunId !== requestedRunId)))
    || (status === 'no-active-run' && abortedRunId !== null)) {
    throw new Error('Gateway returned an invalid cancellation acknowledgement.');
  }
  return { status, abortedRunId };
}

function rememberTerminal(values: Set<string>, id: string): boolean {
  if (values.has(id)) return false;
  values.add(id);
  if (values.size > 1_000) {
    const oldest = values.values().next().value;
    if (oldest) values.delete(oldest);
  }
  return true;
}

export class OpenClawAdapterHost {
  private client?: GatewayClientPort;
  private profile?: StoredProfile;
  private identity?: DeviceIdentity;
  private reconnectTimer?: NodeJS.Timeout;
  private generation = 0;
  private manualDisconnect = false;
  private rememberCredential = false;
  private readonly stateListeners = new Set<(state: OpenClawConnectionState) => void>();
  private readonly eventListeners = new Set<(event: AdapterEvent) => void>();
  private readonly terminalRuns = new Set<string>();
  private readonly terminalApprovals = new Set<string>();
  private state: OpenClawConnectionState = {
    status: 'disconnected',
    gatewayUrl: 'ws://127.0.0.1:18789/',
    authKind: 'token',
    insecureLoopback: true,
    message: 'Connect to an OpenClaw Gateway',
    reconnectAttempt: 0,
    sessions: [],
  };

  constructor(
    private readonly vault: SecureVault,
    private readonly appVersion: string,
    private readonly platform: string,
    private readonly createClient: GatewayClientFactory = (options) => new OpenClawGatewayClient(options),
  ) {
    this.restoreProfile();
  }

  onState(listener: (state: OpenClawConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onEvent(listener: (event: AdapterEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  getState(): OpenClawConnectionState {
    return cloneState(this.state);
  }

  async connect(input: OpenClawConnectInput): Promise<OpenClawConnectionState> {
    const endpoint = normalizeGatewayUrl(input.gatewayUrl);
    const credential = input.credential?.trim();
    const saved = this.profile?.gatewayUrl === endpoint.url ? this.profile : undefined;
    if (!credential && !saved?.credential && !saved?.deviceToken) {
      throw new Error('Enter a gateway token or password.');
    }
    const previousProfile = this.profile;
    const previousRememberCredential = this.rememberCredential;
    this.manualDisconnect = false;
    this.rememberCredential = input.rememberCredential;
    this.clearReconnectTimer();
    this.generation += 1;
    this.client?.close('Replacing connection');
    this.profile = {
      gatewayUrl: endpoint.url,
      authKind: input.authKind,
      credential: credential ?? saved?.credential,
      deviceToken: credential ? undefined : saved?.deviceToken,
      selectedSessionKey: saved?.selectedSessionKey,
    };
    try {
      await this.connectCurrentProfile(false, this.generation);
      this.persistProfile(this.rememberCredential);
      return this.getState();
    } catch (error) {
      this.profile = previousProfile;
      this.rememberCredential = previousRememberCredential;
      throw error;
    }
  }

  async disconnect(): Promise<OpenClawConnectionState> {
    this.manualDisconnect = true;
    this.generation += 1;
    this.clearReconnectTimer();
    const client = this.client;
    this.client = undefined;
    client?.close();
    this.patchState({
      status: 'disconnected',
      message: 'Disconnected by you',
      activeRunId: undefined,
      reconnectAttempt: 0,
    });
    return this.getState();
  }

  async refreshSessions(): Promise<OpenClawConnectionState> {
    const client = this.requireClient();
    const result = await client.request<SessionsListResult | unknown[]>('sessions.list', {
      limit: 100,
      sortBy: 'updatedAt',
      includeGlobal: true,
    });
    const rows = Array.isArray(result) ? result : result.sessions ?? [];
    const sessions = rows.map(sessionSummary).filter((item): item is OpenClawSessionSummary => Boolean(item));
    this.patchState({ sessions });
    return this.getState();
  }

  async createSession(input: { label?: string }): Promise<OpenClawConnectionState> {
    const label = input.label?.trim().slice(0, 100);
    const result = await this.requireClient().request<unknown>('sessions.create', label ? { label } : {});
    if (!result || typeof result !== 'object' || typeof (result as Record<string, unknown>).key !== 'string') {
      throw new Error('Gateway returned an invalid session creation result.');
    }
    await this.refreshSessions();
    return this.selectSession((result as Record<string, unknown>).key as string);
  }

  async selectSession(sessionKey: string): Promise<OpenClawConnectionState> {
    if (!sessionKey || sessionKey.length > 512) throw new Error('Invalid OpenClaw session key.');
    const client = this.requireClient();
    const previous = this.state.selectedSessionKey;
    if (previous && previous !== sessionKey && client.features?.methods.includes('sessions.messages.unsubscribe')) {
      await client.request('sessions.messages.unsubscribe', { key: previous });
    }
    const replay = await client.request<unknown>('sessions.messages.subscribe', {
      key: sessionKey,
      includeApprovals: true,
    });
    this.profile = { ...(this.profile as StoredProfile), selectedSessionKey: sessionKey };
    this.persistProfile(this.rememberCredential);
    this.patchState({ selectedSessionKey: sessionKey, message: 'Ready for a message' });
    this.emitApprovalReplay(replay, sessionKey);
    return this.getState();
  }

  async send(message: string): Promise<void> {
    const text = message.trim();
    if (!text || text.length > 100_000) throw new Error('Message must be between 1 and 100,000 characters.');
    const sessionKey = this.state.selectedSessionKey;
    if (!sessionKey) throw new Error('Select or create an OpenClaw session first.');
    const localTurnId = randomUUID();
    const result = await this.requireClient().request<unknown>('chat.send', {
      sessionKey,
      message: text,
      deliver: false,
      idempotencyKey: randomUUID(),
    }, 30_000);
    const runId = result && typeof result === 'object' && typeof (result as Record<string, unknown>).runId === 'string'
      ? (result as Record<string, unknown>).runId as string
      : localTurnId;
    this.patchState({ activeRunId: runId, message: 'OpenClaw accepted the turn' });
    this.emitEvent({
      protocolVersion: 1,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      connectionId: this.client?.connectionId ?? 'openclaw',
      sessionId: sessionKey,
      turnId: runId,
      type: 'user.input.accepted',
      payload: { summary: text.slice(0, 80) },
    });
  }

  async cancel(): Promise<void> {
    const key = this.state.selectedSessionKey;
    const runId = this.state.activeRunId;
    if (!key && !runId) return;
    const result = abortAcknowledgement(await this.requireClient().request('sessions.abort', {
      ...(key ? { key } : {}),
      ...(runId ? { runId } : {}),
      clearQueued: true,
    }), runId);
    if (runId) {
      this.emitTurnFailed(
        runId,
        result.status === 'aborted'
          ? 'Turn cancelled'
          : 'Turn ended while Desky was reconnecting; refresh the transcript.',
      );
    } else {
      this.patchState({ message: result.status === 'aborted' ? 'Session work cancelled' : 'No active work to cancel' });
    }
  }

  async resolveApproval(input: OpenClawResolveApprovalInput): Promise<void> {
    if (!input.requestId || input.requestId.length > 1024) throw new Error('Invalid approval request.');
    const result = approvalResolution(await this.requireClient().request('approval.resolve', {
      id: input.requestId,
      kind: input.kind,
      decision: input.decision,
    }), input.requestId);
    const outcome = result.applied
      ? result.status === 'denied'
        ? 'Approval denied by OpenClaw'
        : 'Approval accepted by OpenClaw'
      : `Approval already ${result.status} in OpenClaw`;
    this.patchState({ message: outcome });
    this.emitApprovalResolved(input.requestId, result.status);
  }

  private async connectCurrentProfile(reconnecting: boolean, generation: number): Promise<void> {
    const profile = this.profile;
    if (!profile) throw new Error('No OpenClaw profile is configured.');
    const endpoint = normalizeGatewayUrl(profile.gatewayUrl);
    const identity = this.loadIdentity();
    this.patchState({
      status: reconnecting ? 'reconnecting' : 'connecting',
      gatewayUrl: endpoint.url,
      authKind: profile.authKind,
      insecureLoopback: endpoint.insecureLoopback,
      message: reconnecting ? `Reconnect attempt ${this.state.reconnectAttempt}` : 'Authenticating with OpenClaw',
      pairingRequestId: undefined,
    });
    const client = this.createClient({
      url: endpoint.url,
      appVersion: this.appVersion,
      platform: this.platform,
      identity,
      authKind: profile.authKind,
      credential: profile.credential,
      deviceToken: profile.deviceToken,
      onEvent: (event, payload) => this.handleNativeEvent(client, event, payload),
      onClose: (reason, expected) => this.handleClose(generation, reason, expected),
      onSequenceGap: () => void this.reconcileAfterGap(),
    });
    this.client = client;
    try {
      const hello = await client.connect();
      if (generation !== this.generation) return;
      this.assertRequiredFeatures(hello.features.methods);
      if (hello.auth.deviceToken) {
        profile.deviceToken = hello.auth.deviceToken;
        this.persistProfile(this.rememberCredential);
      }
      this.patchState({
        status: 'connected',
        serverVersion: hello.server.version,
        message: 'Connected — choose a session',
        reconnectAttempt: 0,
      });
      this.emitEvent({
        protocolVersion: 1,
        eventId: randomUUID(),
        timestamp: new Date().toISOString(),
        connectionId: hello.server.connId,
        sessionId: profile.selectedSessionKey,
        type: 'connection.ready',
        payload: { runtimeName: `OpenClaw ${hello.server.version}` },
      });
      if (hello.features.methods.includes('sessions.subscribe')) {
        await client.request('sessions.subscribe', {});
      }
      await this.refreshSessions();
      if (profile.selectedSessionKey && this.state.sessions.some((item) => item.key === profile.selectedSessionKey)) {
        await this.selectSession(profile.selectedSessionKey);
        if (reconnecting && hello.features.methods.includes('chat.history')) {
          await client.request('chat.history', { sessionKey: profile.selectedSessionKey, limit: 50 });
        }
      }
    } catch (error) {
      if (generation !== this.generation) return;
      client.close('Connection failed');
      const pairingRequestId = error instanceof GatewayRequestError
        ? findPairingRequestId(error.details)
        : undefined;
      const message = pairingRequestId
        ? `Approve device ${pairingRequestId} in OpenClaw, then reconnect.`
        : redactOpenClawError(error, [profile.credential, profile.deviceToken]);
      this.patchState({
        status: pairingRequestId ? 'pairing' : 'error',
        pairingRequestId,
        message,
      });
      throw new Error(message);
    }
  }

  private assertRequiredFeatures(methods: string[]): void {
    const required = ['sessions.list', 'sessions.messages.subscribe', 'chat.send', 'sessions.abort', 'approval.resolve'];
    const missing = required.filter((method) => !methods.includes(method));
    if (missing.length) throw new Error(`Gateway is missing required protocol-v4 methods: ${missing.join(', ')}`);
  }

  private handleNativeEvent(client: GatewayClientPort, event: string, payload: unknown): void {
    if (client !== this.client) return;
    if (event === 'sessions.changed' || event === 'session.created' || event === 'session.updated') {
      void this.refreshSessions().catch(() => undefined);
    }
    for (const normalized of normalizeOpenClawEvent(client.connectionId ?? 'openclaw', event, payload)) {
      if (normalized.type === 'approval.requested'
        && this.terminalApprovals.has(normalized.payload.requestId)) continue;
      if (normalized.type === 'approval.resolved') {
        if (!rememberTerminal(this.terminalApprovals, normalized.payload.requestId)) continue;
        this.patchState({ message: `Approval ${normalized.payload.status} by OpenClaw` });
      }
      const terminalTurn = normalized.type === 'turn.completed' || normalized.type === 'turn.failed';
      if (terminalTurn && normalized.turnId) {
        if (!rememberTerminal(this.terminalRuns, normalized.turnId)) continue;
        this.patchState({ activeRunId: undefined });
      } else if (normalized.turnId && !this.state.activeRunId) {
        this.patchState({ activeRunId: normalized.turnId });
      }
      this.emitEvent(normalized);
    }
  }

  private handleClose(generation: number, reason: string, expected: boolean): void {
    if (generation !== this.generation || expected) return;
    this.client = undefined;
    this.emitEvent({
      protocolVersion: 1,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      connectionId: 'openclaw',
      sessionId: this.state.selectedSessionKey,
      turnId: this.state.activeRunId,
      type: 'connection.closed',
      payload: { reason: redactOpenClawError(reason) },
    });
    if (!this.manualDisconnect && this.profile) this.scheduleReconnect(generation);
  }

  private scheduleReconnect(generation: number): void {
    this.clearReconnectTimer();
    const attempt = this.state.reconnectAttempt + 1;
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(attempt - 1, 5)));
    this.patchState({ status: 'reconnecting', reconnectAttempt: attempt, message: `Reconnecting in ${Math.ceil(delay / 1000)}s` });
    this.reconnectTimer = setTimeout(() => {
      if (generation !== this.generation || this.manualDisconnect) return;
      void this.connectCurrentProfile(true, generation).catch((error: unknown) => {
        if (error instanceof GatewayRequestError && !error.retryable) return;
        if (generation === this.generation) this.scheduleReconnect(generation);
      });
    }, delay);
  }

  private async reconcileAfterGap(): Promise<void> {
    try {
      await this.refreshSessions();
      const sessionKey = this.state.selectedSessionKey;
      if (sessionKey && this.client?.features?.methods.includes('chat.history')) {
        await this.client.request('chat.history', { sessionKey, limit: 50 });
      }
      this.patchState({ message: 'Connection resynchronized after an event gap' });
    } catch (error) {
      this.patchState({ message: redactOpenClawError(error) });
    }
  }

  private emitApprovalReplay(value: unknown, sessionKey: string): void {
    if (!value || typeof value !== 'object') return;
    const replay = value as Record<string, unknown>;
    const approvals = Array.isArray(replay.approvals)
      ? replay.approvals
      : replay.approvalReplay && typeof replay.approvalReplay === 'object'
        ? (replay.approvalReplay as Record<string, unknown>).approvals
        : undefined;
    if (!Array.isArray(approvals)) return;
    for (const approval of approvals) {
      for (const event of normalizeOpenClawEvent(this.client?.connectionId ?? 'openclaw', 'session.approval', {
        sessionKey,
        phase: 'pending',
        approval,
      })) this.emitEvent(event);
    }
  }

  private restoreProfile(): void {
    try {
      this.profile = this.vault.get<StoredProfile>(profileIndexKey);
      if (!this.profile) return;
      this.rememberCredential = Boolean(this.profile.credential);
      const endpoint = normalizeGatewayUrl(this.profile.gatewayUrl);
      this.state = {
        ...this.state,
        gatewayUrl: endpoint.url,
        authKind: this.profile.authKind,
        insecureLoopback: endpoint.insecureLoopback,
        selectedSessionKey: this.profile.selectedSessionKey,
        message: 'Saved OpenClaw connection available',
      };
    } catch (error) {
      this.state = { ...this.state, status: 'error', message: redactOpenClawError(error) };
    }
  }

  private loadIdentity(): DeviceIdentity {
    if (this.identity) return this.identity;
    this.identity = this.vault.get<DeviceIdentity>(identityKey) ?? generateDeviceIdentity();
    this.vault.set(identityKey, this.identity);
    return this.identity;
  }

  private persistProfile(rememberCredential: boolean): void {
    if (!this.profile) return;
    const persisted = { ...this.profile };
    if (!rememberCredential) delete persisted.credential;
    this.vault.set(profileIndexKey, persisted);
  }

  private requireClient(): GatewayClientPort {
    if (!this.client || this.state.status !== 'connected') throw new Error('Connect to OpenClaw first.');
    return this.client;
  }

  private patchState(patch: Partial<OpenClawConnectionState>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of this.stateListeners) listener(snapshot);
  }

  private emitEvent(event: AdapterEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private emitApprovalResolved(
    requestId: string,
    status: ApprovalResolution['status'],
  ): void {
    if (!rememberTerminal(this.terminalApprovals, requestId)) return;
    this.emitEvent({
      protocolVersion: 1,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      connectionId: this.client?.connectionId ?? 'openclaw',
      sessionId: this.state.selectedSessionKey,
      turnId: this.state.activeRunId,
      type: 'approval.resolved',
      payload: { requestId, status },
    });
  }

  private emitTurnFailed(turnId: string, safeError: string): void {
    if (!rememberTerminal(this.terminalRuns, turnId)) return;
    this.patchState({ activeRunId: undefined, message: safeError });
    this.emitEvent({
      protocolVersion: 1,
      eventId: randomUUID(),
      timestamp: new Date().toISOString(),
      connectionId: this.client?.connectionId ?? 'openclaw',
      sessionId: this.state.selectedSessionKey,
      turnId,
      type: 'turn.failed',
      payload: { safeError },
    });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}

export interface GatewayClientPort {
  readonly connectionId?: string;
  readonly features?: { methods: string[]; events: string[]; capabilities?: string[] };
  connect(): Promise<{
    type: 'hello-ok';
    protocol: number;
    server: { version: string; connId: string };
    features: { methods: string[]; events: string[]; capabilities?: string[] };
    auth: { deviceToken?: string; role: string; scopes: string[] };
    policy: { maxPayload: number; maxBufferedBytes: number; tickIntervalMs: number };
  }>;
  request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  close(reason?: string): void;
}

export type GatewayClientFactory = (options: GatewayConnectOptions) => GatewayClientPort;
