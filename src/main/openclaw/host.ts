import { randomUUID } from 'node:crypto';

import type { AdapterEvent } from '../../shared/adapter-events';
import type { AgentActionCommand } from '../../shared/agent-actions';
import { openClawCapabilities } from '../../shared/adapter-capabilities';
import type { VoiceInputEvent, VoiceInputSession } from '../../shared/voice-input';
import {
  isBoundedVoiceConversationOutputBase64,
  isVoiceConversationAudioFormat,
  type VoiceConversationAudioFormat,
  type VoiceConversationEvent,
  type VoiceConversationSession,
} from '../../shared/voice-conversation';
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
  normalizeOpenClawAgentAction,
  normalizeOpenClawEvent,
  type DeviceIdentity,
} from './protocol';
import type { SecureVault } from './secure-vault';
import { isTerminalSecureTransportError } from '../secure-transport';

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
const actionCapabilitiesMethod = 'desky.actions.capabilities';
const voiceInputMethods = [
  'talk.session.create',
  'talk.session.appendAudio',
  'talk.session.close',
] as const;
const voiceConversationMethods = [
  'talk.session.create',
  'talk.session.appendAudio',
  'talk.session.cancelOutput',
  'talk.session.acknowledgeMark',
  'talk.session.close',
] as const;
const talkCatalogMethod = 'talk.catalog';
const maximumReconnectAttempt = 100;

function cloneState(state: OpenClawConnectionState): OpenClawConnectionState {
  return {
    ...state,
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

function readTalkAudioFormats(value: unknown): VoiceConversationAudioFormat[] {
  if (!Array.isArray(value)) return [];
  const formats: VoiceConversationAudioFormat[] = [];
  for (const candidate of value) {
    if (!isVoiceConversationAudioFormat(candidate)) continue;
    if (!formats.some((format) => (
      format.encoding === candidate.encoding && format.sampleRateHz === candidate.sampleRateHz
    ))) formats.push({ ...candidate });
    if (formats.length === 4) break;
  }
  return formats;
}

function configuredTalkProvider(group: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(group.providers)) return undefined;
  const activeProvider = typeof group.activeProvider === 'string' ? group.activeProvider : undefined;
  const providers = group.providers.filter(
    (provider): provider is Record<string, unknown> => Boolean(provider) && typeof provider === 'object',
  );
  return providers.find((provider) => provider.id === activeProvider && provider.configured === true)
    ?? providers.find((provider) => provider.configured === true);
}

async function discoverTalkCapabilities(
  client: GatewayClientPort,
  methods: readonly string[],
  events: readonly string[],
) {
  const relaySurface = voiceInputMethods.every((method) => methods.includes(method))
    && events.includes('talk.event');
  const unsupported = openClawCapabilities(false).voiceConversation;
  if (!relaySurface) {
    return {
      voiceInput: openClawCapabilities(false).voiceInput,
      voiceConversation: unsupported,
    };
  }
  if (!methods.includes(talkCatalogMethod)) {
    return {
      voiceInput: openClawCapabilities(false, true).voiceInput,
      voiceConversation: unsupported,
    };
  }
  let value: unknown;
  try {
    value = await client.request(talkCatalogMethod, {});
  } catch {
    return {
      voiceInput: {
        availability: 'setup-required' as const,
        transport: 'none' as const,
        setupHint: 'OpenClaw Talk discovery failed. Reconnect after checking the Gateway.',
      },
      voiceConversation: {
        ...unsupported,
        availability: 'setup-required' as const,
        setupHint: 'OpenClaw realtime voice discovery failed. Reconnect after checking the Gateway.',
      },
    };
  }
  if (!value || typeof value !== 'object') {
    return {
      voiceInput: openClawCapabilities(false).voiceInput,
      voiceConversation: unsupported,
    };
  }
  const catalog = value as Record<string, unknown>;
  const transcription = catalog.transcription && typeof catalog.transcription === 'object'
    ? catalog.transcription as Record<string, unknown>
    : {};
  const realtime = catalog.realtime && typeof catalog.realtime === 'object'
    ? catalog.realtime as Record<string, unknown>
    : {};
  const realtimeProvider = configuredTalkProvider(realtime);
  const transports = Array.isArray(realtimeProvider?.transports) ? realtimeProvider.transports : [];
  const inputFormats = readTalkAudioFormats(realtimeProvider?.inputAudioFormats);
  const outputFormats = readTalkAudioFormats(realtimeProvider?.outputAudioFormats);
  const realtimeReady = realtime.ready === true
    && voiceConversationMethods.every((method) => methods.includes(method))
    && transports.includes('gateway-relay')
    && inputFormats.length > 0
    && outputFormats.length > 0;
  return {
    voiceInput: transcription.ready === true
      ? openClawCapabilities(false, true).voiceInput
      : {
          availability: 'setup-required' as const,
          transport: 'none' as const,
          setupHint: 'Configure an OpenClaw realtime transcription provider and credentials, then reconnect.',
        },
    voiceConversation: realtimeReady
      ? {
          availability: 'available' as const,
          transport: 'gateway-relay-realtime' as const,
          inputFormats,
          outputFormats,
          supportsBargeIn: realtimeProvider?.supportsBargeIn === true,
        }
      : {
          ...unsupported,
          availability: 'setup-required' as const,
          setupHint: 'Configure an OpenClaw realtime voice provider and credentials, then reconnect.',
        },
  };
}

function hasDeskyActionCapabilities(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && record.toolName === 'desky_avatar_action'
    && Array.isArray(record.actions)
    && record.actions.includes('wave')
    && record.actions.includes('jump');
}

async function discoverDeskyActionCapabilities(
  client: GatewayClientPort,
  methods: readonly string[],
): Promise<boolean> {
  if (!methods.includes(actionCapabilitiesMethod)) return false;
  try {
    return hasDeskyActionCapabilities(await client.request(actionCapabilitiesMethod, {}));
  } catch {
    // Action discovery is optional. Fail this capability closed without
    // discarding an otherwise valid Gateway connection.
    return false;
  }
}

export function redactOpenClawError(error: unknown, secrets: Array<string | undefined> = []): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'OpenClaw operation failed.';
  let redacted = raw;
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(secret, '[redacted]');
  }
  return redacted
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(token|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .slice(0, 240);
}

function voiceInputSetupHint(error: unknown): string | undefined {
  const message = redactOpenClawError(error);
  if (/openai.*realtime transcription.*api key/i.test(message)) {
    return 'OpenClaw transcription needs an OpenAI Platform API key. Configure it, then reconnect.';
  }
  if (/no realtime transcription provider registered|realtime transcription provider .*not configured|credentials missing for realtime stt/i.test(message)) {
    return 'Configure an OpenClaw realtime transcription provider and credentials, then reconnect.';
  }
  return undefined;
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
  private readonly actionListeners = new Set<(command: AgentActionCommand) => void>();
  private readonly voiceInputListeners = new Set<(event: VoiceInputEvent) => void>();
  private readonly voiceConversationListeners = new Set<(event: VoiceConversationEvent) => void>();
  private activeVoiceInputSession?: { sessionId: string; transcriptionSessionId: string };
  private activeVoiceConversationSession?: {
    sessionId: string;
    supportsBargeIn: boolean;
  };
  private readonly terminalRuns = new Set<string>();
  private readonly terminalApprovals = new Set<string>();
  private readonly handledActionCommands = new Set<string>();
  private state: OpenClawConnectionState = {
    status: 'disconnected',
    gatewayUrl: 'ws://127.0.0.1:18789/',
    authKind: 'token',
    insecureLoopback: true,
    message: 'Connect to an OpenClaw Gateway',
    reconnectAttempt: 0,
    sessions: [],
    capabilities: openClawCapabilities(false),
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

  onAction(listener: (command: AgentActionCommand) => void): () => void {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  onVoiceInputEvent(listener: (event: VoiceInputEvent) => void): () => void {
    this.voiceInputListeners.add(listener);
    return () => this.voiceInputListeners.delete(listener);
  }

  onVoiceConversationEvent(listener: (event: VoiceConversationEvent) => void): () => void {
    this.voiceConversationListeners.add(listener);
    return () => this.voiceConversationListeners.delete(listener);
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
    this.closeVoiceInputLocally('disconnected');
    this.closeVoiceConversationLocally('disconnected');
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
    this.closeVoiceInputLocally('disconnected');
    this.closeVoiceConversationLocally('disconnected');
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
        result.status === 'aborted' ? 'cancelled' : 'error',
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

  async startVoiceInput(): Promise<VoiceInputSession> {
    const client = this.requireClient();
    if (this.activeVoiceInputSession || this.activeVoiceConversationSession) {
      throw new Error('Finish the current voice session before starting dictation.');
    }
    if (!this.state.capabilities.voiceInput
      || this.state.capabilities.voiceInput.availability !== 'available'
      || !voiceInputMethods.every((method) => client.features?.methods.includes(method))) {
      throw new Error('This OpenClaw Gateway does not offer admitted streaming transcription.');
    }
    let value: unknown;
    try {
      value = await client.request<unknown>('talk.session.create', {
        mode: 'transcription',
        transport: 'gateway-relay',
        brain: 'none',
      });
    } catch (error) {
      const setupHint = voiceInputSetupHint(error);
      if (setupHint) {
        this.patchState({
          message: setupHint,
          capabilities: {
            ...this.state.capabilities,
            voiceInput: {
              availability: 'setup-required',
              transport: 'none',
              setupHint,
            },
          },
        });
        throw new Error(setupHint);
      }
      throw error;
    }
    if (!value || typeof value !== 'object') {
      throw new Error('OpenClaw returned an invalid voice-input session.');
    }
    const result = value as Record<string, unknown>;
    const sessionId = typeof result.sessionId === 'string' ? result.sessionId : undefined;
    const transcriptionSessionId = typeof result.transcriptionSessionId === 'string'
      ? result.transcriptionSessionId
      : sessionId;
    const audio = result.audio && typeof result.audio === 'object'
      ? result.audio as Record<string, unknown>
      : undefined;
    if (!sessionId || sessionId.length > 512
      || !transcriptionSessionId || transcriptionSessionId.length > 512
      || audio?.inputEncoding !== 'g711_ulaw'
      || audio.inputSampleRateHz !== 8000) {
      if (sessionId) {
        await client.request('talk.session.close', { sessionId }).catch(() => undefined);
      }
      throw new Error('OpenClaw returned an unsupported voice-input audio format.');
    }
    this.activeVoiceInputSession = { sessionId, transcriptionSessionId };
    return { sessionId, inputEncoding: 'g711_ulaw', inputSampleRateHz: 8000 };
  }

  async appendVoiceInput(sessionId: string, audioBase64: string): Promise<void> {
    if (sessionId !== this.activeVoiceInputSession?.sessionId) {
      throw new Error('Voice-input session is no longer active.');
    }
    await this.requireClient().request('talk.session.appendAudio', { sessionId, audioBase64 }, 10_000);
  }

  async stopVoiceInput(sessionId: string, discard: boolean): Promise<void> {
    if (sessionId !== this.activeVoiceInputSession?.sessionId) return;
    try {
      await this.requireClient().request('talk.session.close', { sessionId }, 10_000);
      if (sessionId === this.activeVoiceInputSession?.sessionId) {
        this.emitVoiceInputEvent({
          type: 'closed',
          sessionId,
          reason: discard ? 'cancelled' : 'complete',
        });
      }
    } finally {
      if (sessionId === this.activeVoiceInputSession?.sessionId) {
        this.activeVoiceInputSession = undefined;
      }
    }
  }

  async startVoiceConversation(): Promise<VoiceConversationSession> {
    const client = this.requireClient();
    if (this.activeVoiceInputSession || this.activeVoiceConversationSession) {
      throw new Error('Finish the current voice session before starting a conversation.');
    }
    const capability = this.state.capabilities.voiceConversation;
    if (capability.availability !== 'available'
      || !voiceConversationMethods.every((method) => client.features?.methods.includes(method))) {
      throw new Error(capability.setupHint ?? 'This OpenClaw Gateway does not offer admitted realtime voice.');
    }
    const sessionKey = this.state.selectedSessionKey;
    if (!sessionKey) throw new Error('Select or create an OpenClaw session before starting voice conversation.');
    let value: unknown;
    try {
      value = await client.request('talk.session.create', {
        sessionKey,
        mode: 'realtime',
        transport: 'gateway-relay',
        brain: 'agent-consult',
      }, 20_000);
    } catch (error) {
      const message = redactOpenClawError(error);
      if (/realtime|provider|credential|oauth|api key/i.test(message)) {
        const setupHint = this.markVoiceConversationSetupRequired(message);
        throw new Error(setupHint);
      }
      throw error;
    }
    if (!value || typeof value !== 'object') {
      throw new Error('OpenClaw returned an invalid realtime voice session.');
    }
    const result = value as Record<string, unknown>;
    const sessionId = typeof result.relaySessionId === 'string'
      ? result.relaySessionId
      : typeof result.sessionId === 'string' ? result.sessionId : undefined;
    const audio = result.audio && typeof result.audio === 'object'
      ? result.audio as Record<string, unknown>
      : undefined;
    const input: VoiceConversationAudioFormat = {
      encoding: audio?.inputEncoding as VoiceConversationAudioFormat['encoding'],
      sampleRateHz: Number(audio?.inputSampleRateHz),
      channels: 1,
    };
    const output: VoiceConversationAudioFormat = {
      encoding: audio?.outputEncoding as VoiceConversationAudioFormat['encoding'],
      sampleRateHz: Number(audio?.outputSampleRateHz),
      channels: 1,
    };
    if (!sessionId || sessionId.length > 512
      || !isVoiceConversationAudioFormat(input)
      || !isVoiceConversationAudioFormat(output)) {
      if (sessionId) await client.request('talk.session.close', { sessionId }).catch(() => undefined);
      throw new Error('OpenClaw returned an unsupported realtime voice audio format.');
    }
    this.activeVoiceConversationSession = {
      sessionId,
      supportsBargeIn: capability.supportsBargeIn,
    };
    return {
      sessionId,
      input,
      output,
      supportsBargeIn: capability.supportsBargeIn,
    };
  }

  async appendVoiceConversation(
    sessionId: string,
    audioBase64: string,
    timestamp?: number,
  ): Promise<void> {
    if (sessionId !== this.activeVoiceConversationSession?.sessionId) {
      throw new Error('Voice conversation is no longer active.');
    }
    await this.requireClient().request('talk.session.appendAudio', {
      sessionId,
      audioBase64,
      ...(timestamp === undefined ? {} : { timestamp }),
    }, 10_000);
  }

  async cancelVoiceConversationOutput(
    sessionId: string,
    turnId?: string,
  ): Promise<'applied' | 'stale' | 'idle'> {
    if (sessionId !== this.activeVoiceConversationSession?.sessionId) return 'idle';
    const value = await this.requireClient().request<unknown>('talk.session.cancelOutput', {
      sessionId,
      ...(turnId ? { turnId } : {}),
      reason: 'deskiii-user-interrupt',
    }, 10_000);
    if (!value || typeof value !== 'object') return 'idle';
    const status = (value as Record<string, unknown>).status;
    return status === 'applied' || status === 'stale' ? status : 'idle';
  }

  async acknowledgeVoiceConversationMark(sessionId: string, markName: string): Promise<void> {
    if (sessionId !== this.activeVoiceConversationSession?.sessionId) return;
    await this.requireClient().request('talk.session.acknowledgeMark', { sessionId, markName }, 10_000);
  }

  async stopVoiceConversation(sessionId: string): Promise<void> {
    if (sessionId !== this.activeVoiceConversationSession?.sessionId) return;
    try {
      await this.requireClient().request('talk.session.close', { sessionId }, 10_000);
      if (sessionId === this.activeVoiceConversationSession?.sessionId) {
        this.emitVoiceConversationEvent({ type: 'closed', sessionId, reason: 'complete' });
      }
    } finally {
      if (sessionId === this.activeVoiceConversationSession?.sessionId) {
        this.activeVoiceConversationSession = undefined;
      }
    }
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
      // An explicit Connect starts a fresh retry budget. Background retries remain
      // contract-bounded so a long outage can never poison the renderer state.
      reconnectAttempt: reconnecting
        ? Math.min(this.state.reconnectAttempt, maximumReconnectAttempt)
        : 0,
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
      const actionCapabilitiesAvailable = await discoverDeskyActionCapabilities(
        client,
        hello.features.methods,
      );
      const talkCapabilities = await discoverTalkCapabilities(
        client,
        hello.features.methods,
        hello.features.events,
      );
      if (hello.auth.deviceToken) {
        profile.deviceToken = hello.auth.deviceToken;
        this.persistProfile(this.rememberCredential);
      }
      this.patchState({
        status: 'connected',
        serverVersion: hello.server.version,
        message: 'Connected — choose a session',
        reconnectAttempt: 0,
        capabilities: {
          ...openClawCapabilities(
            actionCapabilitiesAvailable,
            talkCapabilities.voiceInput.availability === 'available',
            talkCapabilities.voiceConversation.availability === 'available',
          ),
          voiceInput: talkCapabilities.voiceInput,
          voiceConversation: talkCapabilities.voiceConversation,
        },
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
      const selectedSessionExists = profile.selectedSessionKey
        && this.state.sessions.some((item) => item.key === profile.selectedSessionKey);
      if (profile.selectedSessionKey && !selectedSessionExists) {
        profile.selectedSessionKey = undefined;
        this.patchState({
          selectedSessionKey: undefined,
          message: this.state.sessions.length > 0
            ? 'Saved session was replaced — selecting the newest session'
            : 'Connected — create a session',
        });
        this.persistProfile(this.rememberCredential);
      }
      const selectedSessionKey = selectedSessionExists
        ? profile.selectedSessionKey
        : this.state.sessions[0]?.key;
      if (selectedSessionKey) {
        await this.selectSession(selectedSessionKey);
        if (reconnecting && hello.features.methods.includes('chat.history')) {
          await client.request('chat.history', { sessionKey: selectedSessionKey, limit: 50 });
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
      if (isTerminalSecureTransportError(error)) throw error;
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
    if (event === 'talk.event') {
      this.handleVoiceInputEvent(payload);
      this.handleVoiceConversationEvent(payload);
    }
    const action = normalizeOpenClawAgentAction(client.connectionId ?? 'openclaw', event, payload);
    if (action
      && action.sessionId === this.state.selectedSessionKey
      && !this.terminalRuns.has(action.turnId)
      && rememberTerminal(this.handledActionCommands, action.commandId)) {
      this.emitAction(action);
    }
    for (const normalized of normalizeOpenClawEvent(client.connectionId ?? 'openclaw', event, payload)) {
      const terminalTurn = normalized.type === 'turn.completed' || normalized.type === 'turn.failed';
      if (normalized.turnId && !terminalTurn && this.terminalRuns.has(normalized.turnId)) {
        continue;
      }
      if (normalized.type === 'approval.requested'
        && this.terminalApprovals.has(normalized.payload.requestId)) continue;
      if (normalized.type === 'approval.resolved') {
        if (!rememberTerminal(this.terminalApprovals, normalized.payload.requestId)) continue;
        this.patchState({ message: `Approval ${normalized.payload.status} by OpenClaw` });
      }
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
    this.closeVoiceInputLocally('disconnected');
    this.closeVoiceConversationLocally('disconnected');
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
    const attempt = Math.min(this.state.reconnectAttempt + 1, maximumReconnectAttempt);
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(attempt - 1, 5)));
    this.patchState({ status: 'reconnecting', reconnectAttempt: attempt, message: `Reconnecting in ${Math.ceil(delay / 1000)}s` });
    this.reconnectTimer = setTimeout(() => {
      if (generation !== this.generation || this.manualDisconnect) return;
      void this.connectCurrentProfile(true, generation).catch((error: unknown) => {
        if (error instanceof GatewayRequestError && !error.retryable) return;
        if (isTerminalSecureTransportError(error)) return;
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

  private markVoiceConversationSetupRequired(providerMessage: string): string {
    const accountRejected = /403|forbidden|rejected|account|oauth/i.test(providerMessage);
    const setupHint = accountRejected
      ? 'OpenClaw realtime voice was rejected. Verify the selected OAuth account has GPT-Live access, then reconnect.'
      : 'Configure an OpenClaw realtime voice provider and credentials, then reconnect.';
    this.patchState({
      message: providerMessage,
      capabilities: {
        ...this.state.capabilities,
        voiceConversation: {
          availability: 'setup-required',
          transport: 'none',
          inputFormats: [],
          outputFormats: [],
          supportsBargeIn: false,
          setupHint,
        },
      },
    });
    return setupHint;
  }

  private emitEvent(event: AdapterEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private emitAction(command: AgentActionCommand): void {
    for (const listener of this.actionListeners) listener(command);
  }

  private handleVoiceInputEvent(value: unknown): void {
    if (!value || typeof value !== 'object' || !this.activeVoiceInputSession) return;
    const payload = value as Record<string, unknown>;
    const eventSessionId = typeof payload.transcriptionSessionId === 'string'
      ? payload.transcriptionSessionId
      : typeof payload.sessionId === 'string'
        ? payload.sessionId
        : undefined;
    if (eventSessionId !== this.activeVoiceInputSession.transcriptionSessionId) return;
    const { sessionId } = this.activeVoiceInputSession;
    const talkEvent = payload.talkEvent && typeof payload.talkEvent === 'object'
      ? payload.talkEvent as Record<string, unknown>
      : payload;
    const eventType = typeof payload.type === 'string'
      ? payload.type
      : typeof talkEvent.type === 'string'
        ? talkEvent.type
        : '';
    const text = typeof payload.text === 'string'
      ? payload.text.trim()
      : typeof talkEvent.text === 'string'
        ? talkEvent.text.trim()
        : typeof talkEvent.transcript === 'string'
          ? talkEvent.transcript.trim()
          : '';
    if (text && ['partial', 'transcript', 'transcript.delta', 'transcript.done'].includes(eventType)) {
      this.emitVoiceInputEvent({
        type: 'transcript',
        sessionId,
        text: text.slice(0, 100_000),
        final: payload.final === true || talkEvent.final === true || eventType === 'transcript.done',
      });
      return;
    }
    if (eventType === 'error') {
      const message = typeof payload.message === 'string'
        ? payload.message
        : typeof talkEvent.message === 'string'
          ? talkEvent.message
          : 'OpenClaw transcription failed.';
      this.emitVoiceInputEvent({
        type: 'error',
        sessionId,
        message: redactOpenClawError(message).slice(0, 240),
      });
      return;
    }
    if (eventType === 'close') {
      this.activeVoiceInputSession = undefined;
      this.emitVoiceInputEvent({
        type: 'closed',
        sessionId,
        reason: payload.reason === 'error' ? 'error' : 'complete',
      });
    }
  }

  private handleVoiceConversationEvent(value: unknown): void {
    if (!value || typeof value !== 'object' || !this.activeVoiceConversationSession) return;
    const payload = value as Record<string, unknown>;
    const eventSessionId = typeof payload.relaySessionId === 'string'
      ? payload.relaySessionId
      : typeof payload.sessionId === 'string' ? payload.sessionId : undefined;
    if (eventSessionId !== this.activeVoiceConversationSession.sessionId) return;
    const { sessionId } = this.activeVoiceConversationSession;
    const talkEvent = payload.talkEvent && typeof payload.talkEvent === 'object'
      ? payload.talkEvent as Record<string, unknown>
      : payload;
    const eventType = typeof payload.type === 'string'
      ? payload.type
      : typeof talkEvent.type === 'string' ? talkEvent.type : '';
    const turnId = typeof talkEvent.turnId === 'string' && talkEvent.turnId.length <= 512
      ? talkEvent.turnId
      : undefined;
    if (eventType === 'ready' || eventType === 'session.ready') {
      this.emitVoiceConversationEvent({ type: 'ready', sessionId });
      return;
    }
    if (eventType === 'audio' || eventType === 'output.audio.delta') {
      const audioBase64 = typeof payload.audioBase64 === 'string'
        ? payload.audioBase64
        : talkEvent.audioBase64;
      if (!isBoundedVoiceConversationOutputBase64(audioBase64)) {
        this.emitVoiceConversationEvent({
          type: 'error',
          sessionId,
          message: 'OpenClaw returned an invalid or oversized realtime audio chunk.',
        });
        return;
      }
      this.emitVoiceConversationEvent({ type: 'audio', sessionId, audioBase64, turnId });
      return;
    }
    if (eventType === 'audioDone' || eventType === 'output.audio.done') {
      this.emitVoiceConversationEvent({ type: 'audio-done', sessionId, turnId });
      return;
    }
    if (eventType === 'clear' || eventType === 'output.audio.clear') {
      this.emitVoiceConversationEvent({ type: 'clear', sessionId, turnId });
      return;
    }
    if (eventType === 'mark' || eventType === 'output.audio.mark') {
      const markName = typeof payload.markName === 'string'
        ? payload.markName
        : typeof talkEvent.markName === 'string' ? talkEvent.markName : undefined;
      if (markName && markName.length <= 512) {
        this.emitVoiceConversationEvent({ type: 'mark', sessionId, markName, turnId });
      }
      return;
    }
    if (eventType === 'transcript'
      || eventType === 'transcript.delta'
      || eventType === 'transcript.done') {
      const role = payload.role === 'user' || payload.role === 'assistant'
        ? payload.role
        : talkEvent.role === 'user' || talkEvent.role === 'assistant' ? talkEvent.role : undefined;
      const text = typeof payload.text === 'string'
        ? payload.text.trim()
        : typeof talkEvent.text === 'string' ? talkEvent.text.trim() : '';
      if (role && text) {
        this.emitVoiceConversationEvent({
          type: 'transcript',
          sessionId,
          role,
          text: text.slice(0, 100_000),
          final: payload.final === true || talkEvent.final === true || eventType === 'transcript.done',
          turnId,
        });
      }
      return;
    }
    if (eventType === 'error' || eventType === 'session.error') {
      const message = typeof payload.message === 'string'
        ? payload.message
        : typeof talkEvent.message === 'string' ? talkEvent.message : 'OpenClaw realtime voice failed.';
      const safeMessage = redactOpenClawError(message).slice(0, 240);
      if (/403|forbidden|rejected|provider|credential|oauth|api key|account access|unavailable/i.test(safeMessage)) {
        this.markVoiceConversationSetupRequired(safeMessage);
      }
      this.emitVoiceConversationEvent({
        type: 'error',
        sessionId,
        message: safeMessage,
      });
      return;
    }
    if (eventType === 'close' || eventType === 'session.closed') {
      this.activeVoiceConversationSession = undefined;
      this.emitVoiceConversationEvent({
        type: 'closed',
        sessionId,
        reason: payload.reason === 'error' ? 'error' : 'complete',
      });
    }
  }

  private closeVoiceInputLocally(
    reason: 'complete' | 'cancelled' | 'error' | 'disconnected',
  ): void {
    const sessionId = this.activeVoiceInputSession?.sessionId;
    this.activeVoiceInputSession = undefined;
    if (sessionId) this.emitVoiceInputEvent({ type: 'closed', sessionId, reason });
  }

  private closeVoiceConversationLocally(
    reason: 'complete' | 'cancelled' | 'error' | 'disconnected',
  ): void {
    const sessionId = this.activeVoiceConversationSession?.sessionId;
    this.activeVoiceConversationSession = undefined;
    if (sessionId) this.emitVoiceConversationEvent({ type: 'closed', sessionId, reason });
  }

  private emitVoiceInputEvent(event: VoiceInputEvent): void {
    for (const listener of this.voiceInputListeners) listener(event);
  }

  private emitVoiceConversationEvent(event: VoiceConversationEvent): void {
    for (const listener of this.voiceConversationListeners) listener(event);
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

  private emitTurnFailed(
    turnId: string,
    safeError: string,
    kind: 'cancelled' | 'error' = 'error',
  ): void {
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
      payload: { safeError, kind },
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
