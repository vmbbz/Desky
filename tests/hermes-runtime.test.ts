import { describe, expect, it, vi } from 'vitest';

import type { HermesApiClientPort } from '../src/main/hermes/api-client';
import { HermesRuntime, readHermesConfiguration } from '../src/main/hermes/runtime';

class FixtureHermesClient implements HermesApiClientPort {
  readonly approvals: Array<{ runId: string; choice: string }> = [];
  readonly stops: string[] = [];
  readonly starts: Array<{ sessionId: string; input: string }> = [];
  private streamListener?: (event: unknown) => void;
  private streamResolve?: () => void;
  streamSignal?: AbortSignal;

  async admit() { return { model: 'hermes-agent', version: '0.9.0' }; }
  async listSessions() {
    return [{ id: 'session-1', label: 'Existing', updatedAt: 1 }];
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
    return new Promise<void>((resolve) => { this.streamResolve = resolve; });
  }
  async resolveApproval(runId: string, choice: string) { this.approvals.push({ runId, choice }); }
  async stopRun(runId: string) { this.stops.push(runId); }
  emit(event: unknown) { this.streamListener?.(event); }
  endStream() { this.streamResolve?.(); }
}

const configuration = { endpoint: 'http://127.0.0.1:8642/', token: 'secret-token' };

function fixtureRuntime(client = new FixtureHermesClient()) {
  return {
    client,
    runtime: new HermesRuntime({
      createClient: () => client,
      createConnectionId: () => 'connection-1',
    }),
  };
}

describe('HermesRuntime foundation', () => {
  it('validates configuration and admits the authenticated API server', async () => {
    expect(readHermesConfiguration(configuration)).toEqual(configuration);
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
});
