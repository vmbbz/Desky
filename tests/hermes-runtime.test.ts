import { describe, expect, it, vi } from 'vitest';

import { HermesApiError, type HermesApiClientPort } from '../src/main/hermes/api-client';
import {
  HermesRuntime,
  hermesCredentialVaultKey,
  readHermesConfiguration,
  type HermesCredentialVault,
  type HermesRuntimeDependencies,
} from '../src/main/hermes/runtime';

class FixtureHermesClient implements HermesApiClientPort {
  readonly approvals: Array<{ runId: string; choice: string }> = [];
  readonly stops: string[] = [];
  readonly starts: Array<{ sessionId: string; input: string }> = [];
  private streamListener?: (event: unknown) => void;
  private streamResolve?: () => void;
  private streamReject?: (error: unknown) => void;
  streamSignal?: AbortSignal;
  admission = { model: 'hermes-agent', version: '0.9.0' };
  sessions = [{ id: 'session-1', label: 'Existing', updatedAt: 1 }];
  admitError?: Error;
  listError?: Error;

  async admit() {
    if (this.admitError) throw this.admitError;
    return this.admission;
  }
  async listSessions() {
    if (this.listError) throw this.listError;
    return this.sessions;
  }
  async createSession(label?: string) {
    return { id: 'session-new', label: label || 'Hermes session' };
  }
  async startRun(sessionId: string, input: string) {
    this.starts.push({ sessionId, input });
    return 'run-1';
  }
  streamRun(_runId: string, onEvent: (event: unknown) => void, signal: AbortSignal) {
    this.streamListener = onEvent;
    this.streamSignal = signal;
    return new Promise<void>((resolve, reject) => {
      this.streamResolve = resolve;
      this.streamReject = reject;
    });
  }
  async resolveApproval(runId: string, choice: string) { this.approvals.push({ runId, choice }); }
  async stopRun(runId: string) { this.stops.push(runId); }
  emit(event: unknown) {
    try { this.streamListener?.(event); } catch (error) { this.streamReject?.(error); }
  }
  endStream() { this.streamResolve?.(); }
  failStream(error: unknown) { this.streamReject?.(error); }
}

const configuration = { endpoint: 'http://127.0.0.1:8642/', token: 'secret-token' };

class FixtureVault implements HermesCredentialVault {
  readonly entries = new Map<string, unknown>();
  readonly sets: Array<{ key: string; value: unknown }> = [];
  readonly deletes: string[] = [];

  get<T>(key: string): T | undefined { return this.entries.get(key) as T | undefined; }
  set(key: string, value: unknown) {
    this.sets.push({ key, value });
    this.entries.set(key, value);
  }
  delete(key: string) {
    this.deletes.push(key);
    this.entries.delete(key);
  }
}

function fixtureRuntime(
  client = new FixtureHermesClient(),
  dependencies: HermesRuntimeDependencies = {},
) {
  return {
    client,
    runtime: new HermesRuntime({
      createClient: () => client,
      createConnectionId: () => 'connection-1',
      healthCheckIntervalMs: 0,
      ...dependencies,
    }),
  };
}

describe('HermesRuntime foundation', () => {
  it('validates configuration and admits the authenticated API server', async () => {
    expect(readHermesConfiguration(configuration)).toEqual({ ...configuration, rememberToken: false });
    expect(() => readHermesConfiguration({ endpoint: 'http://remote.example', token: 'x' }))
      .toThrow('requires HTTPS');
    expect(() => readHermesConfiguration({ endpoint: 'https://example.com', token: '' }))
      .toThrow('Invalid Hermes');
    const { runtime } = fixtureRuntime();
    const events: string[] = [];
    runtime.onEvent((event) => events.push(event.type));
    const state = await runtime.connect(configuration);
    expect(state).toMatchObject({
      adapterId: 'hermes', status: 'connected', runtimeVersion: '0.9.0',
      insecureLocal: true, endpoint: 'http://127.0.0.1:8642',
      selectedSessionId: 'session-1',
      sessions: [{ id: 'session-1', label: 'Existing' }],
    });
    expect(events).toEqual(['connection.ready']);
  });

  it('persists only an admitted token and reuses it only for the exact canonical endpoint', async () => {
    const vault = new FixtureVault();
    const seenConfigurations: unknown[] = [];
    const first = new FixtureHermesClient();
    const second = new FixtureHermesClient();
    const clients = [first, second];
    const runtime = new HermesRuntime({
      vault,
      createClient: (resolved) => {
        seenConfigurations.push(resolved);
        const client = clients.shift();
        if (!client) throw new Error('No fixture Hermes client available.');
        return client;
      },
      healthCheckIntervalMs: 0,
    });

    await runtime.connect({ ...configuration, rememberToken: true });
    expect(vault.entries.get(hermesCredentialVaultKey)).toEqual({
      version: 1,
      endpoint: 'http://127.0.0.1:8642',
      token: 'secret-token',
    });
    await runtime.connect({ endpoint: 'http://127.0.0.1:8642', rememberToken: true });
    expect(seenConfigurations).toEqual([
      { endpoint: 'http://127.0.0.1:8642', token: 'secret-token' },
      { endpoint: 'http://127.0.0.1:8642', token: 'secret-token' },
    ]);

    await expect(runtime.connect({ endpoint: 'http://localhost:8642', rememberToken: true }))
      .rejects.toThrow('exact endpoint');
  });

  it('rotates or removes saved access only after successful admission', async () => {
    const vault = new FixtureVault();
    vault.entries.set(hermesCredentialVaultKey, {
      version: 1,
      endpoint: 'http://127.0.0.1:8642',
      token: 'old-token',
    });
    const rejected = new FixtureHermesClient();
    rejected.admitError = new Error('authorization=new-token rejected');
    const admitted = new FixtureHermesClient();
    const clients = [rejected, admitted];
    const runtime = new HermesRuntime({
      vault,
      createClient: () => {
        const client = clients.shift();
        if (!client) throw new Error('No fixture Hermes client available.');
        return client;
      },
      healthCheckIntervalMs: 0,
    });

    await expect(runtime.connect({ ...configuration, token: 'new-token', rememberToken: true }))
      .rejects.toThrow('authorization=[redacted] rejected');
    expect(vault.entries.get(hermesCredentialVaultKey)).toMatchObject({ token: 'old-token' });
    expect(vault.sets).toHaveLength(0);

    await runtime.connect({ ...configuration, token: 'new-token', rememberToken: false });
    expect(vault.entries.has(hermesCredentialVaultKey)).toBe(false);
    expect(vault.deletes).toEqual([hermesCredentialVaultKey]);
  });

  it('fails closed when persistence is requested without secure storage', async () => {
    const { runtime } = fixtureRuntime();
    await expect(runtime.connect({ ...configuration, rememberToken: true }))
      .rejects.toThrow('Secure Hermes credential storage is unavailable');
    expect(runtime.getState().status).toBe('error');
  });

  it('streams a turn, routes one approval, and completes exactly once', async () => {
    const { runtime, client } = fixtureRuntime();
    const events: Array<{ type: string; payload: unknown }> = [];
    runtime.onEvent((event) => events.push({ type: event.type, payload: event.payload }));
    await runtime.connect(configuration);
    await runtime.send('Do the work');
    expect(client.starts).toEqual([{ sessionId: 'session-1', input: 'Do the work' }]);
    expect(runtime.getState().activeTurnId).toBe('run-1');
    client.emit({ event: 'message.delta', run_id: 'run-1', delta: 'Working' });
    client.emit({
      event: 'approval.request', run_id: 'run-1', command: 'npm test',
      description: 'Run tests', choices: ['once', 'deny'],
    });
    expect(events.map((event) => event.type)).toEqual([
      'connection.ready', 'user.input.accepted', 'agent.thinking',
      'assistant.delta', 'approval.requested',
    ]);
    await runtime.resolveApproval({
      requestId: 'run-1:approval:1', kind: 'exec', decision: 'allow-once',
    });
    expect(client.approvals).toEqual([{ runId: 'run-1', choice: 'once' }]);
    client.emit({ event: 'run.completed', run_id: 'run-1', output: 'Done' });
    client.emit({ event: 'run.completed', run_id: 'run-1', output: 'Duplicate' });
    client.endStream();
    await vi.waitFor(() => expect(runtime.getState().activeTurnId).toBeUndefined());
    expect(events.filter((event) => event.type === 'turn.completed')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'approval.resolved')).toHaveLength(1);
  });

  it('waits for the server cancellation terminal event and rejects duplicate turns', async () => {
    const { runtime, client } = fixtureRuntime();
    const events: string[] = [];
    runtime.onEvent((event) => events.push(event.type));
    await runtime.connect(configuration);
    await runtime.send('Long work');
    await expect(runtime.send('Overlapping')).rejects.toThrow('already has an active turn');
    await runtime.cancel();
    expect(client.stops).toEqual(['run-1']);
    expect(runtime.getState().activeTurnId).toBe('run-1');
    client.emit({ event: 'run.cancelled', run_id: 'run-1' });
    client.endStream();
    await vi.waitFor(() => expect(runtime.getState().activeTurnId).toBeUndefined());
    expect(events.filter((event) => event === 'turn.failed')).toHaveLength(1);
  });

  it('aborts transport and emits a local cancelled terminal on disconnect', async () => {
    const { runtime, client } = fixtureRuntime();
    const terminals: unknown[] = [];
    runtime.onEvent((event) => {
      if (event.type === 'turn.failed') terminals.push(event.payload);
    });
    await runtime.connect(configuration);
    await runtime.send('Long work');
    const state = await runtime.disconnect();
    expect(state.status).toBe('disconnected');
    expect(client.stops).toEqual(['run-1']);
    expect(client.streamSignal?.aborted).toBe(true);
    expect(terminals).toEqual([expect.objectContaining({ kind: 'cancelled' })]);
  });

  it('redacts the bearer token from renderer-safe failures', () => {
    const { runtime } = fixtureRuntime();
    expect(runtime.rendererSafeError(
      new Error('authorization=secret-token'),
      configuration,
    )).toBe('authorization=[redacted]');
  });

  it('re-admits after transport loss, restores the selected session, and never replays a lost turn', async () => {
    const first = new FixtureHermesClient();
    const second = new FixtureHermesClient();
    const clients = [first, second];
    let connectionSequence = 0;
    const createClient = vi.fn(() => {
      const next = clients.shift();
      if (!next) throw new Error('No fixture Hermes client available.');
      return next;
    });
    const { runtime } = fixtureRuntime(first, {
      createClient,
      createConnectionId: () => `connection-${++connectionSequence}`,
      reconnectDelaysMs: [0],
      wait: async () => undefined,
    });
    const events: string[] = [];
    runtime.onEvent((event) => events.push(event.type));
    await runtime.connect(configuration);
    await runtime.send('Never replay this turn');
    first.emit({
      event: 'approval.request', run_id: 'run-1', command: 'chmod 777 [path]',
      description: 'Protected command', choices: ['once', 'deny'],
    });
    first.failStream(new HermesApiError('Hermes transport is unavailable.', true));

    await vi.waitFor(() => expect(createClient).toHaveBeenCalledTimes(2));
    expect(runtime.getState().status).toBe('connected');
    expect(second.starts).toEqual([]);
    expect(runtime.getState()).toMatchObject({
      reconnectAttempt: 0,
      selectedSessionId: 'session-1',
      activeTurnId: undefined,
      message: 'Hermes API server reconnected',
    });
    expect(events.filter((event) => event === 'turn.failed')).toHaveLength(1);
    expect(events.filter((event) => event === 'approval.resolved')).toHaveLength(1);
    expect(events.filter((event) => event === 'connection.closed')).toHaveLength(1);
    expect(events.filter((event) => event === 'connection.ready')).toHaveLength(2);
  });

  it('stops after three transient reconnect failures', async () => {
    const first = new FixtureHermesClient();
    const clients = [first];
    for (let index = 0; index < 3; index += 1) {
      const failed = new FixtureHermesClient();
      failed.admitError = new HermesApiError('Hermes transport is unavailable.', true);
      clients.push(failed);
    }
    const createClient = vi.fn(() => {
      const next = clients.shift();
      if (!next) throw new Error('No fixture Hermes client available.');
      return next;
    });
    const { runtime } = fixtureRuntime(first, {
      createClient,
      reconnectDelaysMs: [0, 0, 0],
      wait: async () => undefined,
    });
    await runtime.connect(configuration);
    await runtime.send('Lose this turn');
    first.failStream(new HermesApiError('Hermes transport is unavailable.', true));

    await vi.waitFor(() => expect(runtime.getState().status).toBe('error'));
    expect(createClient).toHaveBeenCalledTimes(4);
    expect(runtime.getState()).toMatchObject({ reconnectAttempt: 3, activeTurnId: undefined });
    expect(runtime.getState().message).toContain('could not reconnect');
  });

  it('cancels a pending reconnect when the user disconnects', async () => {
    const first = new FixtureHermesClient();
    const second = new FixtureHermesClient();
    const createClient = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    let releaseWait: (() => void) | undefined;
    const wait = vi.fn(() => new Promise<void>((resolve) => { releaseWait = resolve; }));
    const { runtime } = fixtureRuntime(first, {
      createClient,
      reconnectDelaysMs: [100],
      wait,
    });
    await runtime.connect(configuration);
    await runtime.send('Disconnect while recovering');
    first.failStream(new HermesApiError('Hermes transport is unavailable.', true));
    await vi.waitFor(() => expect(runtime.getState().status).toBe('reconnecting'));
    await runtime.disconnect();
    releaseWait?.();
    await Promise.resolve();
    expect(runtime.getState().status).toBe('disconnected');
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('fails closed without retry for malformed events or reconnect version drift', async () => {
    const malformed = new FixtureHermesClient();
    const malformedFactory = vi.fn(() => malformed);
    const malformedRuntime = fixtureRuntime(malformed, {
      createClient: malformedFactory,
      reconnectDelaysMs: [0, 0, 0],
      wait: async () => undefined,
    }).runtime;
    await malformedRuntime.connect(configuration);
    await malformedRuntime.send('Malformed stream');
    malformed.emit({ event: 'message.delta', run_id: 'wrong-run', delta: 'unsafe' });
    await vi.waitFor(() => expect(malformedRuntime.getState().status).toBe('error'));
    expect(malformedFactory).toHaveBeenCalledTimes(1);
    expect(malformedRuntime.getState().message).toContain('invalid run event');

    const first = new FixtureHermesClient();
    const changed = new FixtureHermesClient();
    changed.admission = { model: 'hermes-agent', version: '1.0.0' };
    const clients = [first, changed];
    const changedFactory = vi.fn(() => {
      const next = clients.shift();
      if (!next) throw new Error('No fixture Hermes client available.');
      return next;
    });
    const changedRuntime = fixtureRuntime(first, {
      createClient: changedFactory,
      reconnectDelaysMs: [0, 0, 0],
      wait: async () => undefined,
    }).runtime;
    await changedRuntime.connect(configuration);
    await changedRuntime.send('Version changes');
    first.failStream(new HermesApiError('Hermes transport is unavailable.', true));
    await vi.waitFor(() => expect(changedRuntime.getState().status).toBe('error'));
    expect(changedFactory).toHaveBeenCalledTimes(2);
    expect(changedRuntime.getState().message).toContain('version or model changed');
  });

  it('uses idle health admission to recover a restarted server', async () => {
    const first = new FixtureHermesClient();
    const initialAdmit = first.admit.bind(first);
    first.admit = vi.fn()
      .mockImplementationOnce(initialAdmit)
      .mockRejectedValueOnce(new HermesApiError('Hermes transport is unavailable.', true));
    const second = new FixtureHermesClient();
    const clients = [first, second];
    const createClient = vi.fn(() => {
      const next = clients.shift();
      if (!next) return second;
      return next;
    });
    const { runtime } = fixtureRuntime(first, {
      createClient,
      createConnectionId: () => randomConnectionId(),
      reconnectDelaysMs: [0],
      healthCheckIntervalMs: 5,
      wait: async () => undefined,
    });
    const ready: string[] = [];
    runtime.onEvent((event) => { if (event.type === 'connection.ready') ready.push(event.connectionId); });
    await runtime.connect(configuration);
    await vi.waitFor(() => expect(ready).toHaveLength(2));
    expect(runtime.getState()).toMatchObject({ status: 'connected', selectedSessionId: 'session-1' });
    expect(new Set(ready).size).toBe(2);
    await runtime.disconnect();
  });
});

let connectionIdSequence = 0;
function randomConnectionId(): string {
  connectionIdSequence += 1;
  return `connection-health-${connectionIdSequence}`;
}
