import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { basename, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import type { AdapterEvent } from '../src/shared/adapter-events';
import { HermesRuntime } from '../src/main/hermes/runtime';

const liveEnabled = process.env.DESKY_HERMES_LIVE === '1'
  || process.env.npm_lifecycle_event === 'test:hermes:live';
const modelLiveEnabled = process.env.DESKY_HERMES_MODEL_LIVE === '1';
const approvalLiveEnabled = process.env.DESKY_HERMES_APPROVAL_LIVE === '1';
const processRestartLiveEnabled = process.env.DESKY_HERMES_PROCESS_RESTART_LIVE === '1';
const restartExecutable = process.env.DESKY_HERMES_RESTART_EXECUTABLE;
const endpoint = process.env.DESKY_HERMES_LIVE_URL ?? 'http://127.0.0.1:8642';
const token = process.env.DESKY_HERMES_LIVE_TOKEN;
const turnTimeoutMs = 180_000;

function waitForEvent(
  runtime: HermesRuntime,
  predicate: (event: AdapterEvent) => boolean,
  description: string,
  timeoutMs = turnTimeoutMs,
): Promise<AdapterEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for Hermes ${description}.`));
    }, timeoutMs);
    const unsubscribe = runtime.onEvent((event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

function waitForState(
  runtime: HermesRuntime,
  predicate: (state: ReturnType<HermesRuntime['getState']>) => boolean,
  description: string,
  timeoutMs = 15_000,
): Promise<ReturnType<HermesRuntime['getState']>> {
  const current = runtime.getState();
  if (predicate(current)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for Hermes ${description}.`));
    }, timeoutMs);
    const unsubscribe = runtime.onState((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    });
  });
}

class HermesLoopbackRelay {
  readonly requests: Array<{ method: string; path: string }> = [];
  private readonly active = new Set<{ controller: AbortController; response: ServerResponse }>();
  private server?: Server;
  private online = true;
  private relayUrl?: string;

  constructor(private readonly upstream: string) {}

  async start(): Promise<string> {
    this.server = createServer((request, response) => { void this.forward(request, response); });
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Hermes relay did not bind TCP.');
    this.relayUrl = `http://127.0.0.1:${address.port}`;
    return this.relayUrl;
  }

  setOnline(online: boolean): void {
    this.online = online;
    if (online) return;
    for (const active of this.active) {
      active.controller.abort();
      active.response.destroy();
    }
    this.active.clear();
  }

  async close(): Promise<void> {
    this.setOnline(false);
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async forward(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const method = request.method ?? 'GET';
    const path = request.url ?? '/';
    this.requests.push({ method, path });
    if (!this.online) {
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end('{"error":"relay offline"}');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const controller = new AbortController();
    const active = { controller, response };
    this.active.add(active);
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value !== undefined && name.toLowerCase() !== 'host') {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
      }
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const upstreamResponse = await fetch(new URL(path, this.upstream), {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        signal: controller.signal,
      });
      const responseHeaders: Record<string, string> = {};
      upstreamResponse.headers.forEach((value, name) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())) {
          responseHeaders[name] = value;
        }
      });
      response.writeHead(upstreamResponse.status, responseHeaders);
      const reader = upstreamResponse.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          response.write(Buffer.from(value));
        }
      }
      response.end();
    } catch {
      if (!response.destroyed) {
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end('{"error":"upstream unavailable"}');
      }
    } finally {
      this.active.delete(active);
    }
  }
}

async function restartHermesGateway(executable: string): Promise<void> {
  if (!isAbsolute(executable)
    || !/^hermes(?:\.exe)?$/i.test(basename(executable))
    || executable.length > 2_048) {
    throw new Error('DESKY_HERMES_RESTART_EXECUTABLE must be an absolute Hermes executable path.');
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['gateway', 'restart'], {
      env: process.env,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-16_384);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out restarting the Hermes gateway.'));
    }, 60_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !signal) resolve();
      else reject(new Error(`Hermes gateway restart failed (${code ?? signal}): ${stderr}`.slice(0, 240)));
    });
  });
}

async function deleteSession(sessionId: string): Promise<void> {
  if (!token) return;
  const response = await fetch(`${endpoint.replace(/\/+$/, '')}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Hermes live session cleanup failed with HTTP ${response.status}.`);
  }
}

describe.runIf(liveEnabled)('Hermes authenticated live admission', () => {
  it('rejects the wrong bearer without disclosure, admits capabilities, and manages a session', async () => {
    expect(token, 'DESKY_HERMES_LIVE_TOKEN is required for live verification').toBeTruthy();
    if (!token) return;

    const invalidToken = `desky-invalid-${randomUUID()}`;
    const invalidRuntime = new HermesRuntime();
    const invalidFailure = await invalidRuntime.connect({ endpoint, token: invalidToken })
      .catch((error: unknown) => error as Error);
    expect(invalidFailure).toBeInstanceOf(Error);
    expect(invalidFailure.message).not.toContain(invalidToken);
    expect(invalidRuntime.getState().status).toBe('error');
    await invalidRuntime.disconnect();

    const runtime = new HermesRuntime();
    let createdSessionId: string | undefined;
    try {
      const connected = await runtime.connect({ endpoint, token });
      expect(connected).toMatchObject({
        adapterId: 'hermes',
        status: 'connected',
        insecureLocal: endpoint.startsWith('http://'),
      });
      expect(connected.runtimeVersion).toMatch(/^\S.{0,118}\S$|^\S$/);

      const created = await runtime.createSession({
        label: `Desky Hermes admission ${new Date().toISOString()}`,
      });
      createdSessionId = created.selectedSessionId;
      expect(createdSessionId).toBeTruthy();
      expect(created.sessions.some((session) => session.id === createdSessionId)).toBe(true);
      process.stdout.write(
        `[desky-hermes-live] authenticated admission and sessions passed on Hermes ${connected.runtimeVersion}\n`,
      );
    } finally {
      await runtime.disconnect();
      if (createdSessionId) await deleteSession(createdSessionId);
    }
  }, 60_000);
});

describe.runIf(liveEnabled && modelLiveEnabled)('Hermes real-model live matrix', () => {
  it('streams a real turn and emits exactly one terminal', async () => {
    expect(token, 'DESKY_HERMES_LIVE_TOKEN is required for live verification').toBeTruthy();
    if (!token) return;

    const runtime = new HermesRuntime();
    const events: AdapterEvent[] = [];
    runtime.onEvent((event) => events.push(event));
    let sessionId: string | undefined;
    try {
      await runtime.connect({ endpoint, token });
      const created = await runtime.createSession({
        label: `Desky Hermes model matrix ${new Date().toISOString()}`,
      });
      sessionId = created.selectedSessionId;
      const terminalPromise = waitForEvent(
        runtime,
        (event) => event.type === 'turn.completed' || event.type === 'turn.failed',
        'streaming terminal',
      );
      await runtime.send('Reply with exactly DESKY_HERMES_LIVE_OK and no other text.');
      const runId = runtime.getState().activeTurnId;
      expect(runId).toBeTruthy();
      const terminal = await terminalPromise;
      expect(terminal.type).toBe('turn.completed');
      const streamedText = events
        .filter((event): event is Extract<AdapterEvent, { type: 'assistant.delta' }> => (
          event.turnId === runId && event.type === 'assistant.delta'
        ))
        .map((event) => event.payload.text)
        .join('');
      expect(streamedText).toContain('DESKY_HERMES_LIVE_OK');
      expect(events.filter((event) => event.turnId === runId
        && (event.type === 'turn.completed' || event.type === 'turn.failed'))).toHaveLength(1);
      process.stdout.write('[desky-hermes-live] real model streaming and terminal dedupe passed\n');
    } finally {
      await runtime.disconnect();
      if (sessionId) await deleteSession(sessionId);
    }
  }, turnTimeoutMs + 30_000);

  it.runIf(approvalLiveEnabled)('denies a command approval and cancels during approved execution', async () => {
    expect(token, 'DESKY_HERMES_LIVE_TOKEN is required for live verification').toBeTruthy();
    if (!token) return;

    const runtime = new HermesRuntime();
    const events: AdapterEvent[] = [];
    runtime.onEvent((event) => events.push(event));
    let sessionId: string | undefined;
    try {
      await runtime.connect({ endpoint, token });
      const created = await runtime.createSession({
        label: `Desky Hermes approval matrix ${new Date().toISOString()}`,
      });
      sessionId = created.selectedSessionId;

      // Hermes manual approvals guard commands that match its safety policy;
      // they do not prompt for every terminal call. chmod against a unique,
      // nonexistent /tmp path is deterministic for the detector and has no
      // filesystem effect even if the allow path is exercised accidentally.
      const deniedProbePath = `/tmp/desky-hermes-deny-${randomUUID()}`;

      const deniedApproval = waitForEvent(
        runtime,
        (event) => event.type === 'approval.requested',
        'denied approval request',
      );
      const deniedTerminal = waitForEvent(
        runtime,
        (event) => event.type === 'turn.completed' || event.type === 'turn.failed',
        'denied approval terminal',
      );
      await runtime.send([
        `Use the terminal tool exactly once to run: chmod 777 ${deniedProbePath}.`,
        'Do not substitute another tool and do not answer before attempting the command.',
      ].join(' '));
      const deniedRequest = await deniedApproval;
      if (deniedRequest.type !== 'approval.requested') throw new Error('Expected Hermes approval request.');
      expect(deniedRequest.payload.safeTarget).toMatch(/^chmod 777 /);
      expect(deniedRequest.payload.safeTarget).not.toContain(deniedProbePath);
      await runtime.resolveApproval({
        requestId: deniedRequest.payload.requestId,
        kind: 'exec',
        decision: 'deny',
      });
      await deniedTerminal;
      expect(events.some((event) => event.type === 'approval.resolved'
        && event.payload.requestId === deniedRequest.payload.requestId
        && event.payload.status === 'denied')).toBe(true);

      const executionProbePath = `/tmp/desky-hermes-cancel-${randomUUID()}`;
      const executionCommand = [
        `chmod 777 ${executionProbePath}`,
        'python -c "import time; time.sleep(30)"',
      ].join('; ');
      const executionApproval = waitForEvent(
        runtime,
        (event) => event.type === 'approval.requested',
        'execution approval request',
      );
      const toolStarted = waitForEvent(
        runtime,
        (event) => event.type === 'tool.started',
        'approved tool lifecycle',
      );
      await runtime.send([
        `Use the terminal tool exactly once to run: ${executionCommand}.`,
        'After it exits, reply with exactly DESKY_HERMES_SLEEP_DONE.',
      ].join(' '));
      const executionRequest = await executionApproval;
      if (executionRequest.type !== 'approval.requested') throw new Error('Expected Hermes approval request.');
      expect(executionRequest.payload.safeTarget).toMatch(/^chmod 777 /);
      expect(executionRequest.payload.safeTarget).not.toContain(executionProbePath);
      const cancelledTerminal = waitForEvent(
        runtime,
        (event) => event.turnId === executionRequest.turnId
          && (event.type === 'turn.completed' || event.type === 'turn.failed'),
        'cancelled execution terminal',
      );
      await runtime.resolveApproval({
        requestId: executionRequest.payload.requestId,
        kind: 'exec',
        decision: 'allow-once',
      });
      expect((await toolStarted).turnId).toBe(executionRequest.turnId);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await runtime.cancel();
      const cancelled = await cancelledTerminal;
      expect(cancelled).toMatchObject({ type: 'turn.failed', payload: { kind: 'cancelled' } });
      expect(events.filter((event) => event.turnId === executionRequest.turnId
        && (event.type === 'turn.completed' || event.type === 'turn.failed'))).toHaveLength(1);
      process.stdout.write('[desky-hermes-live] approval deny and cancellation during execution passed\n');
    } finally {
      await runtime.disconnect();
      if (sessionId) await deleteSession(sessionId);
    }
  }, (turnTimeoutMs * 2) + 60_000);

  it('recovers across idle and active transport loss without replaying the lost turn', async () => {
    expect(token, 'DESKY_HERMES_LIVE_TOKEN is required for live verification').toBeTruthy();
    if (!token) return;

    const relay = new HermesLoopbackRelay(endpoint);
    const relayEndpoint = await relay.start();
    const runtime = new HermesRuntime({
      healthCheckIntervalMs: 250,
      reconnectDelaysMs: [100, 250, 500],
    });
    const events: AdapterEvent[] = [];
    runtime.onEvent((event) => events.push(event));
    let sessionId: string | undefined;
    try {
      await runtime.connect({ endpoint: relayEndpoint, token });
      const created = await runtime.createSession({
        label: `Desky Hermes recovery ${new Date().toISOString()}`,
      });
      sessionId = created.selectedSessionId;

      relay.setOnline(false);
      await waitForState(runtime, (state) => state.status === 'reconnecting', 'idle reconnect state');
      relay.setOnline(true);
      await waitForState(runtime, (state) => state.status === 'connected', 'idle recovery');
      expect(runtime.getState().selectedSessionId).toBe(sessionId);

      const lostTerminal = waitForEvent(
        runtime,
        (event) => event.type === 'turn.failed' && event.payload.kind === 'error',
        'lost-turn terminal',
      );
      await runtime.send('Reply with exactly DESKY_HERMES_LOST_TURN and no other text.');
      const lostRunId = runtime.getState().activeTurnId;
      expect(lostRunId).toBeTruthy();
      relay.setOnline(false);
      const lost = await lostTerminal;
      expect(lost.turnId).toBe(lostRunId);
      await waitForState(runtime, (state) => state.status === 'reconnecting', 'active-turn reconnect state');
      relay.setOnline(true);
      await waitForState(runtime, (state) => state.status === 'connected', 'active-turn recovery');

      const recoveredTerminal = waitForEvent(
        runtime,
        (event) => event.type === 'turn.completed' || event.type === 'turn.failed',
        'post-reconnect terminal',
      );
      await runtime.send('Reply with exactly DESKY_HERMES_RECOVERY_OK and no other text.');
      const recoveredRunId = runtime.getState().activeTurnId;
      const recovered = await recoveredTerminal;
      expect(recovered.type).toBe('turn.completed');
      const recoveredText = events
        .filter((event): event is Extract<AdapterEvent, { type: 'assistant.delta' }> => (
          event.turnId === recoveredRunId && event.type === 'assistant.delta'
        ))
        .map((event) => event.payload.text)
        .join('');
      expect(recoveredText).toContain('DESKY_HERMES_RECOVERY_OK');
      expect(relay.requests.filter((request) => request.method === 'POST'
        && request.path === '/v1/runs')).toHaveLength(2);
      expect(events.filter((event) => event.turnId === lostRunId
        && (event.type === 'turn.completed' || event.type === 'turn.failed'))).toHaveLength(1);
      expect(events.filter((event) => event.type === 'connection.closed')).toHaveLength(2);
      expect(events.filter((event) => event.type === 'connection.ready')).toHaveLength(3);
      process.stdout.write('[desky-hermes-live] idle/active transport recovery and no-replay passed\n');
    } finally {
      await runtime.disconnect();
      await relay.close();
      if (sessionId) await deleteSession(sessionId);
    }
  }, (turnTimeoutMs * 2) + 60_000);

  it.runIf(processRestartLiveEnabled)('re-admits after a real Hermes gateway process restart', async () => {
    expect(token, 'DESKY_HERMES_LIVE_TOKEN is required for live verification').toBeTruthy();
    expect(restartExecutable, 'DESKY_HERMES_RESTART_EXECUTABLE is required').toBeTruthy();
    if (!token || !restartExecutable) return;

    const runtime = new HermesRuntime({ healthCheckIntervalMs: 250 });
    const events: AdapterEvent[] = [];
    runtime.onEvent((event) => events.push(event));
    let sessionId: string | undefined;
    try {
      await runtime.connect({ endpoint, token });
      const created = await runtime.createSession({
        label: `Desky Hermes process restart ${new Date().toISOString()}`,
      });
      sessionId = created.selectedSessionId;
      const reconnecting = waitForState(
        runtime,
        (state) => state.status === 'reconnecting',
        'process-restart reconnect state',
        30_000,
      );
      const restart = restartHermesGateway(restartExecutable);
      await reconnecting;
      await restart;
      await waitForState(runtime, (state) => state.status === 'connected', 'process-restart recovery', 30_000);
      expect(runtime.getState().selectedSessionId).toBe(sessionId);

      const terminalPromise = waitForEvent(
        runtime,
        (event) => event.type === 'turn.completed' || event.type === 'turn.failed',
        'process-restart model terminal',
      );
      await runtime.send('Reply with exactly DESKY_HERMES_PROCESS_RECOVERY_OK and no other text.');
      const runId = runtime.getState().activeTurnId;
      const terminal = await terminalPromise;
      expect(terminal.type).toBe('turn.completed');
      const text = events
        .filter((event): event is Extract<AdapterEvent, { type: 'assistant.delta' }> => (
          event.turnId === runId && event.type === 'assistant.delta'
        ))
        .map((event) => event.payload.text)
        .join('');
      expect(text).toContain('DESKY_HERMES_PROCESS_RECOVERY_OK');
      expect(events.some((event) => event.type === 'connection.closed')).toBe(true);
      expect(events.filter((event) => event.type === 'connection.ready').length).toBeGreaterThanOrEqual(2);
      process.stdout.write('[desky-hermes-live] real gateway restart and model recovery passed\n');
    } finally {
      await runtime.disconnect();
      if (sessionId) await deleteSession(sessionId);
    }
  }, (turnTimeoutMs * 2) + 60_000);
});
