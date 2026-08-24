import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

import {
  CodexRuntime,
  readCodexRuntimeConfiguration,
  type CodexClientPort,
} from '../src/main/codex/runtime';
import type {
  CodexServerNotification,
  CodexServerRequest,
} from '../src/main/codex/app-server-client';

class FixtureClient implements CodexClientPort {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: string | number; result: unknown }> = [];
  account: unknown = { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
  threads = [
    { id: 'thread-1', name: 'Existing', preview: 'Existing', updatedAt: 10 },
  ];
  private readonly notifications = new Set<(value: CodexServerNotification) => void>();
  private readonly requests = new Set<(value: CodexServerRequest) => void>();
  private readonly closes = new Set<(reason: string) => void>();

  async connect() { return { userAgent: 'codex-cli/0.146.0-alpha.3' }; }

  async request(method: string, params: unknown = {}) {
    this.calls.push({ method, params });
    if (method === 'account/read') return this.account;
    if (method === 'thread/list') return { data: this.threads, nextCursor: null };
    if (method === 'thread/start') {
      this.threads = [...this.threads, { id: 'thread-new', name: null as unknown as string, preview: '', updatedAt: 11 }];
      return { thread: { id: 'thread-new' } };
    }
    if (method === 'thread/name/set') {
      this.threads = this.threads.map((thread) => thread.id === 'thread-new' ? { ...thread, name: 'Desky' } : thread);
      return {};
    }
    if (method === 'thread/resume') return { thread: { id: (params as { threadId: string }).threadId } };
    if (method === 'turn/start') return { turn: { id: 'turn-1', status: 'inProgress' } };
    if (method === 'turn/interrupt') return {};
    throw new Error(`Unexpected fixture request: ${method}`);
  }

  respond(id: string | number, result: unknown) { this.responses.push({ id, result }); }
  onNotification(listener: (value: CodexServerNotification) => void) { this.notifications.add(listener); return () => this.notifications.delete(listener); }
  onRequest(listener: (value: CodexServerRequest) => void) { this.requests.add(listener); return () => this.requests.delete(listener); }
  onClose(listener: (reason: string) => void) { this.closes.add(listener); return () => this.closes.delete(listener); }
  close() {}
  getStderrPreview() { return ''; }
  emitNotification(value: CodexServerNotification) { for (const listener of this.notifications) listener(value); }
  emitRequest(value: CodexServerRequest) { for (const listener of this.requests) listener(value); }
  emitClose(reason: string) { for (const listener of this.closes) listener(reason); }
}

function fixtureRuntime(client = new FixtureClient()) {
  const runtime = new CodexRuntime({
    appVersion: '0.1.0',
    discover: async () => ({
      executablePath: 'C:\\tools\\codex.exe',
      cliVersion: '0.146.0-alpha.3',
      schemaVersion: '0.146.0-alpha.3',
      source: 'path',
    }),
    createClient: () => client,
    createConnectionId: () => 'connection-1',
  });
  return { runtime, client };
}

const workspaceDirectory = resolve('workspace');
const configuration = { workspaceDirectory, sandbox: 'read-only' as const };

describe('CodexRuntime', () => {
  it('validates configuration and connects through account and thread discovery', async () => {
    expect(readCodexRuntimeConfiguration(configuration)).toEqual(configuration);
    expect(() => readCodexRuntimeConfiguration({ workspaceDirectory: 'relative', sandbox: 'read-only' }))
      .toThrow('Invalid Codex runtime configuration');
    const { runtime, client } = fixtureRuntime();
    const events: string[] = [];
    runtime.onEvent((event) => events.push(event.type));
    const state = await runtime.connect(configuration);
    expect(state).toMatchObject({
      adapterId: 'codex', status: 'connected', runtimeVersion: '0.146.0-alpha.3',
      sessions: [{ id: 'thread-1', label: 'Existing' }],
    });
    expect(events).toEqual(['connection.ready']);
    expect(client.calls.slice(0, 2)).toEqual([
      { method: 'account/read', params: { refreshToken: false } },
      { method: 'thread/list', params: expect.objectContaining({ limit: 100 }) },
    ]);
  });

  it('creates/selects threads and streams one normalized turn to completion', async () => {
    const { runtime, client } = fixtureRuntime();
    const events: Array<{ type: string; payload: unknown }> = [];
    runtime.onEvent((event) => events.push({ type: event.type, payload: event.payload }));
    await runtime.connect(configuration);
    const created = await runtime.createSession({ label: 'Desky' });
    expect(created.selectedSessionId).toBe('thread-new');
    expect(client.calls).toContainEqual({
      method: 'thread/start',
      params: { cwd: workspaceDirectory, approvalPolicy: 'on-request', sandbox: 'read-only', ephemeral: false },
    });
    await runtime.selectSession('thread-1');
    await runtime.send('Explain this repository');
    expect(runtime.getState().activeTurnId).toBe('turn-1');
    client.emitNotification({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: 'Hello' },
    });
    client.emitNotification({
      method: 'item/started',
      params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'tool-1', type: 'commandExecution', command: 'private' } },
    });
    client.emitNotification({
      method: 'item/completed',
      params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'tool-1', type: 'commandExecution', aggregatedOutput: 'private' } },
    });
    client.emitNotification({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
    });
    expect(events.map((event) => event.type)).toEqual([
      'connection.ready', 'user.input.accepted', 'agent.thinking',
      'assistant.delta', 'tool.started', 'tool.completed', 'turn.completed',
    ]);
    expect(JSON.stringify(events)).not.toContain('private');
    expect(runtime.getState().activeTurnId).toBeUndefined();
  });

  it('routes scoped command/file approvals and denies wrong-session requests', async () => {
    const { runtime, client } = fixtureRuntime();
    const events: string[] = [];
    runtime.onEvent((event) => events.push(event.type));
    await runtime.connect(configuration);
    await runtime.selectSession('thread-1');
    await runtime.send('Update a file');
    client.emitRequest({
      id: 7,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'tool-1', reason: 'Run tests' },
    });
    await runtime.resolveApproval({ requestId: 'codex:7', kind: 'exec', decision: 'allow-once' });
    expect(client.responses).toContainEqual({ id: 7, result: { decision: 'accept' } });
    expect(events.slice(-2)).toEqual(['approval.requested', 'approval.resolved']);
    await expect(runtime.resolveApproval({ requestId: 'codex:7', kind: 'exec', decision: 'deny' }))
      .rejects.toThrow('Unknown or expired');

    client.emitRequest({
      id: 8,
      method: 'item/fileChange/requestApproval',
      params: { threadId: 'wrong-thread', turnId: 'turn-1', itemId: 'file-1' },
    });
    expect(client.responses).toContainEqual({ id: 8, result: { decision: 'decline' } });
  });

  it('interrupts active work and classifies the terminal notification as cancelled', async () => {
    const { runtime, client } = fixtureRuntime();
    const events: string[] = [];
    runtime.onEvent((event) => events.push(event.type));
    await runtime.connect(configuration);
    await runtime.selectSession('thread-1');
    await runtime.send('Long task');
    await runtime.cancel();
    expect(client.calls.at(-1)).toEqual({
      method: 'turn/interrupt', params: { threadId: 'thread-1', turnId: 'turn-1' },
    });
    client.emitNotification({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } },
    });
    expect(events.at(-1)).toBe('turn.failed');
    expect(runtime.getState().activeTurnId).toBeUndefined();
  });

  it('fails closed for missing auth and unexpected process exit', async () => {
    const authClient = new FixtureClient();
    authClient.account = { account: null, requiresOpenaiAuth: true };
    const auth = fixtureRuntime(authClient).runtime;
    await expect(auth.connect(configuration)).rejects.toThrow('Sign in with the Codex CLI');
    expect(auth.getState().status).toBe('error');

    const { runtime, client } = fixtureRuntime();
    const events = vi.fn();
    runtime.onEvent(events);
    await runtime.connect(configuration);
    client.emitClose('token=secret process crashed');
    expect(runtime.getState()).toMatchObject({ status: 'error', message: 'token=[redacted] process crashed' });
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'connection.closed' }));
  });
});
