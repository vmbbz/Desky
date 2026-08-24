import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AdapterEvent } from '../src/shared/adapter-events';
import {
  CodexAppServerClient,
  createCodexProcessFactory,
} from '../src/main/codex/app-server-client';
import { buildCodexEnvironment } from '../src/main/codex/executable-discovery';
import { CodexRuntime } from '../src/main/codex/runtime';
import { CodexWorkspaceGrantBroker } from '../src/main/codex/workspace-grants';

const runLive = process.env.DESKY_CODEX_MODEL_LIVE === '1'
  || process.env.npm_lifecycle_event === 'test:codex:matrix:live';
const matrixTimeoutMs = 360_000;
const turnTimeoutMs = 120_000;

async function waitUntil<T>(
  read: () => T | undefined,
  description: string,
  timeoutMs = turnTimeoutMs,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function terminalFor(events: readonly AdapterEvent[], turnId: string): AdapterEvent | undefined {
  return events.find((event) => event.turnId === turnId
    && (event.type === 'turn.completed' || event.type === 'turn.failed'));
}

async function sendAndWait(
  runtime: CodexRuntime,
  events: AdapterEvent[],
  message: string,
): Promise<{ turnId: string; events: AdapterEvent[]; terminal: AdapterEvent }> {
  const start = events.length;
  await runtime.send(message);
  const turnId = runtime.getState().activeTurnId;
  if (!turnId) throw new Error('Codex did not expose an active turn after accepting input.');
  const terminal = await waitUntil(
    () => terminalFor(events.slice(start), turnId),
    `terminal event for ${turnId}`,
  );
  return { turnId, events: events.slice(start), terminal };
}

function promptPath(path: string): string {
  return path.replaceAll('\\', '/').replaceAll("'", "''");
}

function eventDiagnostic(events: readonly AdapterEvent[]): string {
  const types = events.map((event) => event.type).join(',');
  const assistant = events
    .filter((event) => event.type === 'assistant.delta')
    .map((event) => event.type === 'assistant.delta' ? event.payload.text : '')
    .join('')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
  return `events=${types}; assistant=${assistant}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!runLive).sequential('Codex authenticated model matrix', () => {
  it('streams, enforces approvals, cancels a real tool, and recovers from a process crash', async () => {
    const providedWorkspace = process.env.DESKY_CODEX_MATRIX_WORKSPACE;
    const workspace = providedWorkspace ?? await mkdtemp(join(tmpdir(), 'desky-codex-live-'));
    const ownsWorkspace = !providedWorkspace;
    const denyMarker = join(workspace, 'deny-marker.txt');
    const allowMarker = join(workspace, 'allow-marker.txt');
    const cancellationMarker = join(workspace, 'cancellation-marker.txt');
    const workspaceGrants = new CodexWorkspaceGrantBroker();
    const grant = await workspaceGrants.issue(workspace, 'read-only');
    const events: AdapterEvent[] = [];
    const states: Array<ReturnType<CodexRuntime['getState']>> = [];
    const processes: ChildProcessWithoutNullStreams[] = [];
    const clients: CodexAppServerClient[] = [];
    const environment = buildCodexEnvironment(process.env);
    const runtime = new CodexRuntime({
      appVersion: '0.1.0',
      resolveWorkspaceGrant: (grantId, sandbox) => workspaceGrants.resolve(grantId, sandbox),
      createClient: (admission) => {
        const factory = createCodexProcessFactory(admission.executablePath, environment);
        const client = new CodexAppServerClient(() => {
          const child = factory() as ChildProcessWithoutNullStreams;
          processes.push(child);
          return child;
        }, '0.1.0', 30_000);
        clients.push(client);
        return client;
      },
    });
    const unsubscribeEvents = runtime.onEvent((event) => events.push(event));
    const unsubscribeStates = runtime.onState((state) => states.push(state));

    try {
      await runtime.connect({ workspaceGrantId: grant.grantId, sandbox: 'read-only' });
      const oldConformanceThreads = runtime.getState().sessions
        .filter((session) => session.label.startsWith('Desky conformance '));
      for (const session of oldConformanceThreads) {
        await clients.at(-1)?.request('thread/archive', { threadId: session.id });
      }
      if (oldConformanceThreads.length > 0) await runtime.refreshSessions();
      await runtime.createSession({ label: `Desky conformance ${new Date().toISOString()}` });

      const stream = await sendAndWait(
        runtime,
        events,
        'Reply with exactly DESKY_CODEX_STREAM_OK and no other text. Do not use tools.',
      );
      expect(stream.terminal.type).toBe('turn.completed');
      expect(stream.events
        .filter((event) => event.type === 'assistant.delta')
        .map((event) => event.type === 'assistant.delta' ? event.payload.text : '')
        .join(''))
        .toContain('DESKY_CODEX_STREAM_OK');

      let approvalFailure: unknown;
      const denyApprovals = runtime.onEvent((event) => {
        if (event.type !== 'approval.requested') return;
        void runtime.resolveApproval({
          requestId: event.payload.requestId,
          kind: event.payload.kind,
          decision: 'deny',
        }).catch((error) => { approvalFailure = error; });
      });
      const denied = await sendAndWait(runtime, events, [
        'Use the shell tool to create the following file with exact contents DESKY_DENY_BAD.',
        `File: ${promptPath(denyMarker)}`,
        'You must attempt the real command once. If sandbox permission is required, request user approval.',
        'Do not merely describe the command and do not stop before the approval is answered.',
      ].join('\n'));
      denyApprovals();
      expect(approvalFailure).toBeUndefined();
      expect(
        denied.events.some((event) => event.type === 'approval.requested'),
        eventDiagnostic(denied.events),
      ).toBe(true);
      expect(denied.events.some((event) => event.type === 'approval.resolved'
        && event.payload.status === 'denied')).toBe(true);
      expect(await fileExists(denyMarker)).toBe(false);

      const allowApprovals = runtime.onEvent((event) => {
        if (event.type !== 'approval.requested') return;
        void runtime.resolveApproval({
          requestId: event.payload.requestId,
          kind: event.payload.kind,
          decision: 'allow-once',
        }).catch((error) => { approvalFailure = error; });
      });
      const allowed = await sendAndWait(runtime, events, [
        'Use the shell tool to create the following file with exact contents DESKY_ALLOW_OK.',
        `File: ${promptPath(allowMarker)}`,
        'You must execute the real command. If sandbox permission is required, request user approval.',
        'Do not merely describe the command and do not stop before the approval is answered.',
      ].join('\n'));
      allowApprovals();
      expect(approvalFailure).toBeUndefined();
      expect(
        allowed.events.some((event) => event.type === 'approval.requested'),
        eventDiagnostic(allowed.events),
      ).toBe(true);
      expect(allowed.events.some((event) => event.type === 'approval.resolved'
        && event.payload.status === 'allowed')).toBe(true);
      expect(await readFile(allowMarker, 'utf8')).toBe('DESKY_ALLOW_OK');

      const allowCancellationCommand = runtime.onEvent((event) => {
        if (event.type !== 'approval.requested') return;
        void runtime.resolveApproval({
          requestId: event.payload.requestId,
          kind: event.payload.kind,
          decision: 'allow-once',
        }).catch((error) => { approvalFailure = error; });
      });
      const cancellationStart = events.length;
      await runtime.send([
        'Run this exact command and wait for it to finish:',
        `node -e "setTimeout(() => require('node:fs').writeFileSync('${promptPath(cancellationMarker)}', 'DESKY_CANCEL_BAD'), 10000)"`,
        'You must execute the command now. Request sandbox approval if needed. Do not explain it instead.',
      ].join('\n'));
      const cancellationTurnId = runtime.getState().activeTurnId;
      if (!cancellationTurnId) throw new Error('Codex did not expose the cancellable turn.');
      await waitUntil(
        () => events.slice(cancellationStart).find((event) => (
          event.turnId === cancellationTurnId && event.type === 'tool.started'
        )),
        'a real Codex tool start before cancellation',
      );
      await waitUntil(
        () => events.slice(cancellationStart).find((event) => (
          event.turnId === cancellationTurnId
          && event.type === 'approval.resolved'
          && event.payload.status === 'allowed'
        )),
        'approval of the cancellable command',
      );
      await runtime.cancel();
      const cancelled = await waitUntil(
        () => terminalFor(events.slice(cancellationStart), cancellationTurnId),
        'cancelled Codex terminal event',
      );
      expect(cancelled).toMatchObject({
        type: 'turn.failed',
        payload: { kind: 'cancelled' },
      });
      allowCancellationCommand();
      expect(approvalFailure).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      expect(await fileExists(cancellationMarker), 'cancelled tool continued after terminal event').toBe(false);

      const recovered = await sendAndWait(
        runtime,
        events,
        'Reply with exactly DESKY_CODEX_CANCEL_RECOVERY_OK and no other text. Do not use tools.',
      );
      expect(recovered.terminal.type).toBe('turn.completed');

      const readyBeforeCrash = events.filter((event) => event.type === 'connection.ready').length;
      const processBeforeCrash = processes.at(-1);
      expect(processBeforeCrash?.kill()).toBe(true);
      await waitUntil(
        () => states.some((state) => state.status === 'reconnecting') ? true : undefined,
        'Codex reconnecting state after process exit',
        30_000,
      );
      await waitUntil(
        () => events.filter((event) => event.type === 'connection.ready').length > readyBeforeCrash
          && runtime.getState().status === 'connected'
          ? true
          : undefined,
        'Codex connection replacement',
        60_000,
      );
      expect(processes.length).toBeGreaterThanOrEqual(2);

      const crashRecovered = await sendAndWait(
        runtime,
        events,
        'Reply with exactly DESKY_CODEX_CRASH_RECOVERY_OK and no other text. Do not use tools.',
      );
      expect(crashRecovered.terminal.type).toBe('turn.completed');
      expect(crashRecovered.events
        .filter((event) => event.type === 'assistant.delta')
        .map((event) => event.type === 'assistant.delta' ? event.payload.text : '')
        .join(''))
        .toContain('DESKY_CODEX_CRASH_RECOVERY_OK');
    } finally {
      unsubscribeStates();
      unsubscribeEvents();
      const selectedSessionId = runtime.getState().selectedSessionId;
      if (selectedSessionId && runtime.getState().status === 'connected') {
        await clients.at(-1)?.request('thread/archive', { threadId: selectedSessionId }).catch(() => undefined);
      }
      await runtime.disconnect().catch(() => undefined);
      workspaceGrants.clear();
      if (ownsWorkspace) {
        await rm(workspace, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 500,
        });
      }
    }
  }, matrixTimeoutMs);
});
