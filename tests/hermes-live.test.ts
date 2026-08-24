import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { AdapterEvent } from '../src/shared/adapter-events';
import { HermesRuntime } from '../src/main/hermes/runtime';

const liveEnabled = process.env.DESKY_HERMES_LIVE === '1'
  || process.env.npm_lifecycle_event === 'test:hermes:live';
const modelLiveEnabled = process.env.DESKY_HERMES_MODEL_LIVE === '1';
const approvalLiveEnabled = process.env.DESKY_HERMES_APPROVAL_LIVE === '1';
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
        'Use the terminal tool exactly once to run: printf DESKY_HERMES_DENY_PROBE.',
        'Do not substitute another tool and do not answer before attempting the command.',
      ].join(' '));
      const deniedRequest = await deniedApproval;
      if (deniedRequest.type !== 'approval.requested') throw new Error('Expected Hermes approval request.');
      await runtime.resolveApproval({
        requestId: deniedRequest.payload.requestId,
        kind: 'exec',
        decision: 'deny',
      });
      await deniedTerminal;
      expect(events.some((event) => event.type === 'approval.resolved'
        && event.payload.requestId === deniedRequest.payload.requestId
        && event.payload.status === 'denied')).toBe(true);

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
        'Use the terminal tool exactly once to run: python -c "import time; time.sleep(30)".',
        'After it exits, reply with exactly DESKY_HERMES_SLEEP_DONE.',
      ].join(' '));
      const executionRequest = await executionApproval;
      if (executionRequest.type !== 'approval.requested') throw new Error('Expected Hermes approval request.');
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
});
