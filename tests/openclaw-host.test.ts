import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OpenClawAdapterHost,
  redactOpenClawError,
  type GatewayClientFactory,
  type GatewayClientPort,
} from '../src/main/openclaw/host';
import { mapOpenClawState } from '../src/main/adapters/openclaw-runtime';
import { assertAdapterConnectionState } from '../src/main/adapters/contract';
import { SecureVault, type EncryptionProvider } from '../src/main/openclaw/secure-vault';
import type { GatewayConnectOptions } from '../src/main/openclaw/gateway-client';
import { SecureTransportError } from '../src/main/secure-transport';

const temporaryDirectories: string[] = [];
const requiredMethods = [
  'sessions.list', 'sessions.subscribe', 'sessions.messages.subscribe',
  'sessions.messages.unsubscribe', 'sessions.create', 'chat.send', 'chat.history',
  'sessions.abort', 'approval.resolve',
  'desky.actions.capabilities',
  'talk.catalog', 'talk.session.create', 'talk.session.appendAudio',
  'talk.session.cancelOutput', 'talk.session.acknowledgeMark', 'talk.session.close',
];

const encryption: EncryptionProvider = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`secured:${value}`),
  decryptString: (value) => value.toString().replace(/^secured:/, ''),
};

class FixtureClient implements GatewayClientPort {
  readonly connectionId = 'fixture-connection';
  readonly features = { methods: requiredMethods, events: ['chat', 'agent', 'session.approval', 'talk.event'] };
  readonly calls: Array<{ method: string; params: unknown }> = [];
  private approvalResolved = false;

  constructor(
    readonly options: GatewayConnectOptions,
    private readonly approvalResult?: unknown,
    private readonly abortResult: unknown = { ok: true, abortedRunId: 'run-1', status: 'aborted' },
  ) {}

  connect() {
    return Promise.resolve({
      type: 'hello-ok' as const,
      protocol: 4,
      server: { version: '2026.8.22', connId: this.connectionId },
      features: this.features,
      auth: {
        deviceToken: 'paired-device-token',
        role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.approvals'],
      },
      policy: { maxPayload: 1_048_576, maxBufferedBytes: 1_048_576, tickIntervalMs: 30_000 },
    });
  }

  request<T>(method: string, params: unknown = {}): Promise<T> {
    this.calls.push({ method, params });
    let value: unknown = { ok: true };
    if (method === 'sessions.list') {
      value = { sessions: [{ key: 'agent:main:desky', label: 'Desky session', updatedAt: 10 }] };
    } else if (method === 'sessions.messages.subscribe') {
      value = { approvals: [] };
    } else if (method === 'sessions.create') {
      value = { ok: true, key: 'agent:main:new' };
    } else if (method === 'chat.send') {
      value = { runId: 'run-1' };
    } else if (method === 'approval.resolve') {
      value = this.resolveApproval(params);
    } else if (method === 'sessions.abort') {
      value = this.abortResult;
    } else if (method === 'desky.actions.capabilities') {
      value = {
        schemaVersion: 1,
        pluginId: 'desky-actions',
        toolName: 'desky_avatar_action',
        actions: ['wave', 'jump'],
        transport: 'session-tool-stream',
      };
    } else if (method === 'talk.catalog') {
      value = {
        modes: ['realtime', 'transcription'],
        transports: ['gateway-relay'],
        brains: ['agent-consult', 'none'],
        speech: { providers: [] },
        transcription: { ready: true, providers: [{ id: 'openai', configured: true }] },
        realtime: {
          ready: true,
          activeProvider: 'openai',
          providers: [{
            id: 'openai',
            configured: true,
            transports: ['gateway-relay'],
            inputAudioFormats: [
              { encoding: 'g711_ulaw', sampleRateHz: 8000, channels: 1 },
              { encoding: 'pcm16', sampleRateHz: 24000, channels: 1 },
            ],
            outputAudioFormats: [
              { encoding: 'g711_ulaw', sampleRateHz: 8000, channels: 1 },
              { encoding: 'pcm16', sampleRateHz: 24000, channels: 1 },
            ],
            supportsBargeIn: true,
          }],
        },
      };
    } else if (method === 'talk.session.create') {
      const mode = (params as { mode?: string }).mode;
      value = mode === 'realtime'
        ? {
            sessionId: 'realtime-session-1',
            relaySessionId: 'realtime-session-1',
            audio: {
              inputEncoding: 'g711_ulaw',
              inputSampleRateHz: 8000,
              outputEncoding: 'pcm16',
              outputSampleRateHz: 24000,
            },
          }
        : {
            sessionId: 'voice-session-1',
            transcriptionSessionId: 'voice-transcription-1',
            audio: { inputEncoding: 'g711_ulaw', inputSampleRateHz: 8000 },
          };
    } else if (method === 'talk.session.cancelOutput') {
      value = { ok: true, status: 'applied', turnId: 'talk-turn-1' };
    }
    return Promise.resolve(value as T);
  }

  private resolveApproval(params: unknown) {
    if (this.approvalResult !== undefined) return this.approvalResult;
    const id = (params as { id: string }).id;
    const result = {
      applied: !this.approvalResolved,
      approval: { id, status: 'allowed', decision: 'allow-once' },
    };
    this.approvalResolved = true;
    return result;
  }

  close(reason?: string): void {
    void reason;
  }
}

class RejectingClient extends FixtureClient {
  override connect(): Promise<never> {
    return Promise.reject(new Error('unauthorized token=bootstrap-token raw bootstrap-token'));
  }
}

class OfflineClient extends FixtureClient {
  override connect(): Promise<never> {
    return Promise.reject(new Error('network unavailable'));
  }
}

class TlsRejectingClient extends FixtureClient {
  override connect(): Promise<never> {
    return Promise.reject(new SecureTransportError(
      'OpenClaw TLS certificate is expired.',
      'tls-certificate-expired',
    ));
  }
}

class RejectingActionDiscoveryClient extends FixtureClient {
  override request<T>(method: string, params: unknown = {}): Promise<T> {
    if (method === 'desky.actions.capabilities') {
      return Promise.reject(new Error('optional action plugin request failed'));
    }
    return super.request<T>(method, params);
  }
}

class MissingTranscriptionProviderClient extends FixtureClient {
  override request<T>(method: string, params: unknown = {}): Promise<T> {
    if (method === 'talk.session.create') {
      return Promise.reject(new Error('No realtime transcription provider registered'));
    }
    return super.request<T>(method, params);
  }
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('OpenClawAdapterHost contract fixture', () => {
  it('redacts labeled and exact secret values from bounded renderer errors', () => {
    const safe = redactOpenClawError(
      new Error('authorization: Bearer abc token=visible raw exact-secret'),
      ['exact-secret'],
    );
    expect(safe).not.toContain('abc');
    expect(safe).not.toContain('visible');
    expect(safe).not.toContain('exact-secret');
    expect(safe.length).toBeLessThanOrEqual(240);
    expect(redactOpenClawError({ message: 'cross-realm token=hidden detail' })).toBe(
      'cross-realm token=[redacted] detail',
    );
  });

  it('rejects a failed connection with the same redacted message stored in state', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => new RejectingClient(options),
    );

    const failure = await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    }).catch((error: unknown) => error as Error);
    expect(failure.message).not.toContain('bootstrap-token');
    expect(host.getState().message).toBe(failure.message);
  });

  it('lets an explicit bootstrap credential bypass a stale device token without destroying saved access on failure', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const vault = new SecureVault(join(directory, 'vault.json'), encryption);
    vault.set('openclaw:active-profile', {
      gatewayUrl: 'ws://127.0.0.1:18789/',
      authKind: 'token',
      deviceToken: 'saved-device-token',
    });
    const attempts: GatewayConnectOptions[] = [];
    const host = new OpenClawAdapterHost(vault, '0.1.0', 'win32', (options) => {
      attempts.push(options);
      return new RejectingClient(options);
    });

    await expect(host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789/',
      authKind: 'token',
      credential: 'replacement-bootstrap-token',
      rememberCredential: false,
    })).rejects.toThrow();
    expect(attempts[0]).toMatchObject({
      credential: 'replacement-bootstrap-token',
      deviceToken: undefined,
    });
    expect(vault.get<{ deviceToken?: string }>('openclaw:active-profile')?.deviceToken).toBe('saved-device-token');

    await expect(host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789/',
      authKind: 'token',
      rememberCredential: false,
    })).rejects.toThrow();
    expect(attempts[1]).toMatchObject({ deviceToken: 'saved-device-token' });
  });

  it('keeps the core Gateway connected when optional action discovery fails closed', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => new RejectingActionDiscoveryClient(options),
    );

    const connected = await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });

    expect(connected.status).toBe('connected');
    expect(connected.capabilities.agentActions).toMatchObject({
      availability: 'setup-required',
      actions: [],
    });
  });

  it('withdraws a stale connected claim when the Gateway starts draining', async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const clients: FixtureClient[] = [];
    let probes = 0;
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => {
        const client = new FixtureClient(options);
        clients.push(client);
        return client;
      },
      async () => {
        probes += 1;
        if (probes === 1 || probes >= 3) return { status: 'started' as const };
        return { status: 'draining' as const };
      },
    );

    await expect(host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    })).resolves.toMatchObject({ status: 'connected' });

    await host.send('Check your available skills.');
    const voiceSession = await host.startVoiceConversation();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(host.getState()).toMatchObject({
      status: 'reconnecting',
      message: 'OpenClaw Gateway is draining for restart. Restart it, then reconnect.',
    });
    expect(probes).toBe(2);
    expect(clients).toHaveLength(1);
    await expect(host.send('This new turn must not be admitted.')).rejects.toThrow(
      'Connect to OpenClaw first.',
    );

    await expect(host.cancelVoiceConversationOutput(
      voiceSession.sessionId,
      'talk-turn-1',
    )).resolves.toBe('applied');
    await expect(host.resolveApproval({
      requestId: 'approval-during-drain',
      kind: 'exec',
      decision: 'deny',
    })).resolves.toBeUndefined();
    await expect(host.cancel()).resolves.toBeUndefined();
    expect(clients[0].calls).toEqual(expect.arrayContaining([
      {
        method: 'talk.session.cancelOutput',
        params: {
          sessionId: voiceSession.sessionId,
          turnId: 'talk-turn-1',
          reason: 'deskiii-internal-fallback',
        },
      },
      {
        method: 'approval.resolve',
        params: { id: 'approval-during-drain', kind: 'exec', decision: 'deny' },
      },
      {
        method: 'sessions.abort',
        params: { key: 'agent:main:desky', runId: 'run-1', clearQueued: true },
      },
    ]));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(probes).toBe(3);
    expect(host.getState()).toMatchObject({ status: 'connected', message: undefined });
    await expect(host.send('Admit work after startup recovers.')).resolves.toBeUndefined();
    expect(clients).toHaveLength(1);
  });

  it('rejects an explicit connection while the Gateway is already draining', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => new FixtureClient(options),
      async () => ({ status: 'draining' }),
    );

    await expect(host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    })).rejects.toThrow(
      'OpenClaw Gateway is draining for restart. Restart it, then reconnect.',
    );
    expect(host.getState()).toMatchObject({
      status: 'error',
      message: 'OpenClaw Gateway is draining for restart. Restart it, then reconnect.',
    });
  });

  it('covers sessions, streaming, approvals, cancellation, and reconnect', async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const clients: FixtureClient[] = [];
    const factory: GatewayClientFactory = (options) => {
      const client = new FixtureClient(options);
      clients.push(client);
      return client;
    };
    const vault = new SecureVault(join(directory, 'vault.json'), encryption);
    const host = new OpenClawAdapterHost(
      vault,
      '0.1.0',
      'win32',
      factory,
    );
    const eventTypes: string[] = [];
    const actions: string[] = [];
    host.onEvent((event) => eventTypes.push(event.type));
    host.onAction((command) => actions.push(`${command.commandId}:${command.payload.action}`));

    const connected = await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });
    expect(connected).toMatchObject({ status: 'connected', serverVersion: '2026.8.22' });
    expect(connected.capabilities.agentActions).toMatchObject({
      availability: 'available',
      transport: 'typed-tool-event',
      actions: ['wave', 'jump'],
    });
    expect(connected.sessions).toEqual([{ key: 'agent:main:desky', label: 'Desky session', updatedAt: 10 }]);
    const stored = vault.get<{ credential?: string; deviceToken?: string }>('openclaw:active-profile');
    expect(stored?.credential).toBeUndefined();
    expect(stored?.deviceToken).toBe('paired-device-token');

    await host.selectSession('agent:main:desky');
    await host.send('Hello OpenClaw');
    expect(host.getState().activeRunId).toBe('run-1');
    clients[0].options.onEvent('agent', {
      sessionKey: 'agent:main:desky', runId: 'run-1', stream: 'tool', data: { phase: 'start', name: 'workspace' },
    });
    const avatarAction = {
      sessionKey: 'agent:main:desky',
      runId: 'run-1',
      stream: 'tool',
      data: {
        phase: 'start',
        name: 'desky_avatar_action',
        toolCallId: 'action-1',
        args: { action: 'wave' },
      },
    };
    clients[0].options.onEvent('agent', avatarAction);
    clients[0].options.onEvent('agent', avatarAction);
    clients[0].options.onEvent('agent', {
      ...avatarAction,
      sessionKey: 'agent:main:other',
      data: { ...avatarAction.data, toolCallId: 'action-other-session' },
    });
    clients[0].options.onEvent('chat', {
      sessionKey: 'agent:main:desky', runId: 'run-1', seq: 2, state: 'delta', deltaText: 'Done',
    });
    clients[0].options.onEvent('session.approval', {
      sessionKey: 'agent:main:desky', phase: 'pending',
      approval: { id: 'approval-1', presentation: { kind: 'exec', commandText: 'npm test', allowedDecisions: ['allow-once', 'deny'] } },
    });
    await host.resolveApproval({ requestId: 'approval-1', kind: 'exec', decision: 'allow-once' });
    expect(host.getState().message).toBe('Approval accepted by OpenClaw');
    clients[0].options.onEvent('session.approval', {
      sessionKey: 'agent:main:desky', phase: 'terminal',
      approval: { id: 'approval-1', status: 'allowed', decision: 'allow-once' },
    });
    await host.resolveApproval({ requestId: 'approval-1', kind: 'exec', decision: 'allow-once' });
    expect(host.getState().message).toBe('Approval already allowed in OpenClaw');
    await host.cancel();
    expect(clients[0].calls).toContainEqual({
      method: 'sessions.abort',
      params: { key: 'agent:main:desky', runId: 'run-1', clearQueued: true },
    });
    expect(host.getState().activeRunId).toBeUndefined();
    expect(eventTypes).toEqual(expect.arrayContaining([
      'connection.ready', 'user.input.accepted', 'tool.started', 'assistant.delta',
      'approval.requested', 'approval.resolved',
    ]));
    expect(eventTypes.filter((type) => type === 'approval.resolved')).toHaveLength(1);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatch(/^[a-f0-9]{64}:wave$/);

    clients[0].options.onClose('network unavailable', false);
    expect(host.getState()).toMatchObject({ status: 'reconnecting', reconnectAttempt: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clients).toHaveLength(2);
    expect(host.getState().status).toBe('connected');
  });

  it('bounds prolonged reconnect attempts and resets the budget on explicit Connect', async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const clients: FixtureClient[] = [];
    let recover = false;
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => {
        const client = clients.length === 0 || recover
          ? new FixtureClient(options)
          : new OfflineClient(options);
        clients.push(client);
        return client;
      },
    );

    await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });
    clients[0].options.onClose('network unavailable', false);
    for (let attempt = 0; attempt < 105; attempt += 1) {
      await vi.runOnlyPendingTimersAsync();
    }

    expect(host.getState()).toMatchObject({
      status: 'reconnecting',
      reconnectAttempt: 100,
    });
    const states: number[] = [];
    host.onState((state) => {
      assertAdapterConnectionState(mapOpenClawState(state));
      states.push(state.reconnectAttempt);
    });
    recover = true;

    await expect(host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    })).resolves.toMatchObject({ status: 'connected', reconnectAttempt: 0 });
    expect(states).toEqual(expect.arrayContaining([0]));
  });

  it('admits bounded transcription streaming and isolates events to the active voice session', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    let client: FixtureClient | undefined;
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => {
        client = new FixtureClient(options);
        return client;
      },
    );
    const events: unknown[] = [];
    host.onVoiceInputEvent((event) => events.push(event));
    const connected = await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });
    expect(connected.capabilities.voiceInput).toEqual({
      availability: 'available',
      transport: 'streaming-transcription',
      inputEncoding: 'g711_ulaw',
      inputSampleRateHz: 8000,
    });

    const session = await host.startVoiceInput();
    await host.appendVoiceInput(session.sessionId, '////');
    client?.options.onEvent('talk.event', {
      transcriptionSessionId: 'other-session', type: 'transcript', text: 'private', final: true,
    });
    client?.options.onEvent('talk.event', {
      transcriptionSessionId: 'voice-transcription-1', type: 'partial', text: 'Hello', final: false,
    });
    client?.options.onEvent('talk.event', {
      transcriptionSessionId: 'voice-transcription-1', type: 'transcript', text: 'Hello Deskiii', final: true,
    });
    await host.stopVoiceInput(session.sessionId, false);

    expect(client?.calls).toEqual(expect.arrayContaining([
      { method: 'talk.session.create', params: { mode: 'transcription', transport: 'gateway-relay', brain: 'none' } },
      { method: 'talk.session.appendAudio', params: { sessionId: session.sessionId, audioBase64: '////' } },
      { method: 'talk.session.close', params: { sessionId: session.sessionId } },
    ]));
    expect(events).toEqual([
      { type: 'transcript', sessionId: session.sessionId, text: 'Hello', final: false },
      { type: 'transcript', sessionId: session.sessionId, text: 'Hello Deskiii', final: true },
      { type: 'closed', sessionId: session.sessionId, reason: 'complete' },
    ]);
  });

  it('discovers, starts, interrupts, marks, and closes a turn-scoped realtime voice relay', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    let client: FixtureClient | undefined;
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => {
        client = new FixtureClient(options);
        return client;
      },
    );
    const events: unknown[] = [];
    host.onVoiceConversationEvent((event) => events.push(event));
    const connected = await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });
    expect(connected.capabilities.voiceConversation).toMatchObject({
      availability: 'available',
      transport: 'gateway-relay-realtime',
      supportsBargeIn: true,
    });
    await host.selectSession('agent:main:desky');

    const session = await host.startVoiceConversation();
    expect(session).toEqual({
      sessionId: 'realtime-session-1',
      input: { encoding: 'g711_ulaw', sampleRateHz: 8000, channels: 1 },
      output: { encoding: 'pcm16', sampleRateHz: 24000, channels: 1 },
      supportsBargeIn: true,
    });
    await host.appendVoiceConversation(session.sessionId, '////', 123);
    client?.options.onEvent('talk.event', {
      relaySessionId: session.sessionId,
      type: 'transcript',
      role: 'assistant',
      text: 'Hello from voice',
      final: true,
      talkEvent: { turnId: 'talk-turn-1' },
    });
    client?.options.onEvent('talk.event', {
      relaySessionId: session.sessionId,
      type: 'audio',
      audioBase64: 'AAAA',
      talkEvent: { turnId: 'talk-turn-1' },
    });
    client?.options.onEvent('talk.event', {
      relaySessionId: session.sessionId,
      type: 'mark',
      markName: 'played-1',
      talkEvent: { turnId: 'talk-turn-1' },
    });
    expect(await host.cancelVoiceConversationOutput(
      session.sessionId,
      'talk-turn-1',
      'barge-in',
    )).toBe('applied');
    await host.acknowledgeVoiceConversationMark(session.sessionId, 'played-1');
    await host.stopVoiceConversation(session.sessionId);

    expect(client?.calls).toEqual(expect.arrayContaining([
      {
        method: 'talk.session.create',
        params: {
          sessionKey: 'agent:main:desky',
          mode: 'realtime',
          transport: 'gateway-relay',
          brain: 'agent-consult',
        },
      },
      {
        method: 'talk.session.appendAudio',
        params: { sessionId: session.sessionId, audioBase64: '////', timestamp: 123 },
      },
      {
        method: 'talk.session.cancelOutput',
        params: {
          sessionId: session.sessionId,
          turnId: 'talk-turn-1',
          reason: 'deskiii-barge-in',
        },
      },
      {
        method: 'talk.session.acknowledgeMark',
        params: { sessionId: session.sessionId, markName: 'played-1' },
      },
      { method: 'talk.session.close', params: { sessionId: session.sessionId } },
    ]));
    expect(events).toEqual([
      {
        type: 'transcript',
        sessionId: session.sessionId,
        role: 'assistant',
        text: 'Hello from voice',
        final: true,
        turnId: 'talk-turn-1',
      },
      {
        type: 'audio',
        sessionId: session.sessionId,
        audioBase64: 'AAAA',
        turnId: 'talk-turn-1',
      },
      {
        type: 'mark',
        sessionId: session.sessionId,
        markName: 'played-1',
        turnId: 'talk-turn-1',
      },
      { type: 'closed', sessionId: session.sessionId, reason: 'complete' },
    ]);
  });

  it('fails realtime voice closed after a provider account rejection', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    let client: FixtureClient | undefined;
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => {
        client = new FixtureClient(options);
        return client;
      },
    );
    const events: unknown[] = [];
    host.onVoiceConversationEvent((event) => events.push(event));
    await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });
    await host.selectSession('agent:main:desky');
    const session = await host.startVoiceConversation();

    client?.options.onEvent('talk.event', {
      relaySessionId: session.sessionId,
      type: 'session.error',
      message: 'GPT-Live rejected the session (403). account access unavailable token=private',
    });

    expect(host.getState().capabilities.voiceConversation).toEqual({
      availability: 'setup-required',
      transport: 'none',
      inputFormats: [],
      outputFormats: [],
      supportsBargeIn: false,
      setupHint: 'OpenClaw realtime voice was rejected. Verify the selected OAuth account has GPT-Live access, then reconnect.',
    });
    expect(host.getState().message).not.toContain('private');
    expect(events).toEqual([{
      type: 'error',
      sessionId: session.sessionId,
      message: 'GPT-Live rejected the session (403). account access unavailable token=[redacted]',
    }]);
    await host.stopVoiceConversation(session.sessionId);
  });

  it('downgrades advertised voice input when OpenClaw has no configured transcription provider', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => new MissingTranscriptionProviderClient(options),
    );
    await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });

    await expect(host.startVoiceInput()).rejects.toThrow(
      'Configure an OpenClaw realtime transcription provider',
    );
    expect(host.getState().capabilities.voiceInput).toEqual({
      availability: 'setup-required',
      transport: 'none',
      setupHint: 'Configure an OpenClaw realtime transcription provider and credentials, then reconnect.',
    });
  });

  it('stops reconnecting after a terminal remote certificate failure', async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const clients: FixtureClient[] = [];
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => {
        const client = clients.length === 0
          ? new FixtureClient(options)
          : new TlsRejectingClient(options);
        clients.push(client);
        return client;
      },
    );
    await host.connect({
      gatewayUrl: 'wss://gateway.example/',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });

    clients[0].options.onClose('network unavailable', false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clients).toHaveLength(2);
    expect(host.getState()).toMatchObject({
      status: 'error',
      message: 'OpenClaw TLS certificate is expired.',
    });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(clients).toHaveLength(2);
  });

  it('fails closed when an approval acknowledgement is malformed', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const vault = new SecureVault(join(directory, 'vault.json'), encryption);
    const host = new OpenClawAdapterHost(
      vault,
      '0.1.0',
      'win32',
      (options) => new FixtureClient(options, { ok: true }),
    );
    await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });

    await expect(host.resolveApproval({
      requestId: 'approval-1',
      kind: 'exec',
      decision: 'deny',
    })).rejects.toThrow('Gateway returned an invalid approval acknowledgement.');
  });

  it('fails closed when a cancellation acknowledgement is malformed', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => new FixtureClient(options, undefined, { ok: true }),
    );
    await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });
    await host.selectSession('agent:main:desky');
    await host.send('Start a turn');

    await expect(host.cancel()).rejects.toThrow('Gateway returned an invalid cancellation acknowledgement.');
    expect(host.getState().activeRunId).toBe('run-1');
  });

  it('closes a run whose terminal event was missed before a no-active-run acknowledgement', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => new FixtureClient(options, undefined, {
        ok: true,
        abortedRunId: null,
        status: 'no-active-run',
      }),
    );
    const terminalEvents: string[] = [];
    host.onEvent((event) => {
      if (event.type === 'turn.failed') terminalEvents.push(event.payload.safeError);
    });
    await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });
    await host.selectSession('agent:main:desky');
    await host.send('Start a turn');
    await host.cancel();

    expect(terminalEvents).toEqual(['Turn ended while Desky was reconnecting; refresh the transcript.']);
    expect(host.getState().activeRunId).toBeUndefined();
  });

  it('does not reactivate a run after a native terminal event', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    let client: FixtureClient | undefined;
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => {
        client = new FixtureClient(options);
        return client;
      },
    );
    await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });
    await host.selectSession('agent:main:desky');
    await host.send('Complete a turn');
    client?.options.onEvent('chat', {
      sessionKey: 'agent:main:desky',
      runId: 'run-1',
      seq: 1,
      state: 'final',
      stopReason: 'complete',
    });

    expect(host.getState().activeRunId).toBeUndefined();
  });

  it('ignores late tool events after a cancelled turn', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-host-test-'));
    temporaryDirectories.push(directory);
    let client: FixtureClient | undefined;
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), encryption),
      '0.1.0',
      'win32',
      (options) => {
        client = new FixtureClient(options);
        return client;
      },
    );
    const events: Array<{ type: string; kind?: string }> = [];
    host.onEvent((event) => events.push({
      type: event.type,
      kind: event.type === 'turn.failed' ? event.payload.kind : undefined,
    }));
    await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });
    await host.selectSession('agent:main:desky');
    await host.send('Start a tool and wait');
    client?.options.onEvent('agent', {
      sessionKey: 'agent:main:desky',
      runId: 'run-1',
      stream: 'tool',
      data: { phase: 'start', name: 'bash' },
    });

    await host.cancel();
    const terminalEventCount = events.length;
    client?.options.onEvent('agent', {
      sessionKey: 'agent:main:desky',
      runId: 'run-1',
      stream: 'tool',
      data: { phase: 'result', name: 'bash' },
    });

    expect(host.getState().activeRunId).toBeUndefined();
    expect(events).toHaveLength(terminalEventCount);
    expect(events.filter((event) => event.type === 'turn.failed')).toEqual([
      { type: 'turn.failed', kind: 'cancelled' },
    ]);
    expect(events.filter((event) => event.type === 'tool.completed')).toHaveLength(0);
  });
});
