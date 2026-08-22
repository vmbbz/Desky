import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OpenClawAdapterHost,
  type GatewayClientFactory,
  type GatewayClientPort,
} from '../src/main/openclaw/host';
import { SecureVault, type EncryptionProvider } from '../src/main/openclaw/secure-vault';
import type { GatewayConnectOptions } from '../src/main/openclaw/gateway-client';

const temporaryDirectories: string[] = [];
const requiredMethods = [
  'sessions.list', 'sessions.subscribe', 'sessions.messages.subscribe',
  'sessions.messages.unsubscribe', 'sessions.create', 'chat.send', 'chat.history',
  'sessions.abort', 'approval.resolve',
];

const encryption: EncryptionProvider = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`secured:${value}`),
  decryptString: (value) => value.toString().replace(/^secured:/, ''),
};

class FixtureClient implements GatewayClientPort {
  readonly connectionId = 'fixture-connection';
  readonly features = { methods: requiredMethods, events: ['chat', 'agent', 'session.approval'] };
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

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('OpenClawAdapterHost contract fixture', () => {
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
    host.onEvent((event) => eventTypes.push(event.type));

    const connected = await host.connect({
      gatewayUrl: 'ws://127.0.0.1:18789',
      authKind: 'token',
      credential: 'bootstrap-token',
      rememberCredential: false,
    });
    expect(connected).toMatchObject({ status: 'connected', serverVersion: '2026.8.22' });
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

    clients[0].options.onClose('network unavailable', false);
    expect(host.getState()).toMatchObject({ status: 'reconnecting', reconnectAttempt: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(clients).toHaveLength(2);
    expect(host.getState().status).toBe('connected');
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
});
