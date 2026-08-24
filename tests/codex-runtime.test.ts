import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';

import {
  CodexRuntime,
  readCodexRuntimeConfiguration,
  type CodexClientPort,
  type CodexRuntimeDependencies,
} from '../src/main/codex/runtime';
import {
  codexFoundationCapabilities,
  codexTypedActionPolicy,
} from '../src/shared/codex';
import type {
  CodexClientClose,
  CodexServerNotification,
  CodexServerRequest,
} from '../src/main/codex/app-server-client';

class FixtureClient implements CodexClientPort {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  readonly responses: Array<{ id: string | number; result: unknown }> = [];
  readonly responseErrors: Array<{ id: string | number; error: { code: number; message: string } }> = [];
  account: unknown = {
    account: { type: 'chatgpt', email: null, planType: 'plus' },
    requiresOpenaiAuth: true,
  };
  threads = [
    { id: 'thread-1', name: 'Existing', preview: 'Existing', updatedAt: 10 },
  ];
  private readonly notifications = new Set<(value: CodexServerNotification) => void>();
  private readonly requests = new Set<(value: CodexServerRequest) => void>();
  private readonly closes = new Set<(value: CodexClientClose) => void>();
  closed = false;

  async connect() {
    return {
      userAgent: 'codex-cli/0.146.0-alpha.3',
      codexHome: 'C:\\codex-home',
      platformFamily: 'windows',
      platformOs: 'windows',
    };
  }

  async request(method: string, params: unknown = {}) {
    this.calls.push({ method, params });
    if (method === 'account/read') return this.account;
    if (method === 'thread/list') {
      return { data: this.threads, nextCursor: null, backwardsCursor: null };
    }
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
  respondError(id: string | number, error: { code: number; message: string }) {
    this.responseErrors.push({ id, error });
  }
  onNotification(listener: (value: CodexServerNotification) => void) { this.notifications.add(listener); return () => this.notifications.delete(listener); }
  onRequest(listener: (value: CodexServerRequest) => void) { this.requests.add(listener); return () => this.requests.delete(listener); }
  onClose(listener: (value: CodexClientClose) => void) { this.closes.add(listener); return () => this.closes.delete(listener); }
  async close() { this.closed = true; }
  getStderrPreview() { return ''; }
  emitNotification(value: CodexServerNotification) { for (const listener of this.notifications) listener(value); }
  emitRequest(value: CodexServerRequest) { for (const listener of this.requests) listener(value); }
  emitClose(reason: string, reconnectable = true) {
    for (const listener of this.closes) listener({ reason, reconnectable });
  }
}

function fixtureRuntime(
  client = new FixtureClient(),
  overrides: Partial<CodexRuntimeDependencies> = {},
) {
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
    resolveWorkspaceGrant: async (grantId, sandbox) => {
      expect(grantId).toBe(workspaceGrantId);
      expect(sandbox).toBe('read-only');
      return workspaceDirectory;
    },
    ...overrides,
  });
  return { runtime, client };
}

const workspaceDirectory = resolve('workspace');
const workspaceGrantId = 'codex-workspace:test-grant';
const configuration = { workspaceGrantId, sandbox: 'read-only' as const };

describe('CodexRuntime', () => {
  it('keeps experimental client tools outside the admitted capability contract', () => {
    expect(codexTypedActionPolicy).toEqual({
      availability: 'unsupported',
      clientRegistration: 'experimental-only',
      experimentalApi: false,
      dynamicTools: false,
      stableAlternative: 'external-mcp',
    });
    expect(codexFoundationCapabilities.agentActions).toMatchObject({
      availability: 'unsupported',
      transport: 'none',
      actions: [],
    });
  });

  it('validates configuration and connects through account and thread discovery', async () => {
    expect(readCodexRuntimeConfiguration(configuration)).toEqual(configuration);
    expect(() => readCodexRuntimeConfiguration({ workspaceDirectory, sandbox: 'read-only' }))
      .toThrow('Invalid Codex runtime configuration');
    const { runtime, client } = fixtureRuntime(new FixtureClient(), { reconnectDelaysMs: [] });
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

  it('requires a main-owned workspace resolver and redacts resolved paths on admission failure', async () => {
    const discoverWithoutGrant = vi.fn();
    const unavailable = new CodexRuntime({
      appVersion: '0.1.0',
      discover: discoverWithoutGrant,
    });
    await expect(unavailable.connect(configuration)).rejects.toThrow('selection is unavailable');
    expect(discoverWithoutGrant).not.toHaveBeenCalled();

    const rejected = new CodexRuntime({
      appVersion: '0.1.0',
      resolveWorkspaceGrant: async () => workspaceDirectory,
      discover: async () => { throw new Error(`Admission failed for ${workspaceDirectory}`); },
    });
    await expect(rejected.connect(configuration)).rejects.not.toThrow(workspaceDirectory);
    expect(rejected.getState().message).not.toContain(workspaceDirectory);
  });

  it('creates/selects threads and streams one normalized turn to completion', async () => {
    const { runtime, client } = fixtureRuntime(new FixtureClient(), { reconnectDelaysMs: [] });
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
      params: {
        threadId: 'thread-1', turnId: 'turn-1', startedAtMs: 1,
        item: { id: 'tool-1', type: 'commandExecution', command: 'private' },
      },
    });
    client.emitNotification({
      method: 'item/completed',
      params: {
        threadId: 'thread-1', turnId: 'turn-1', completedAtMs: 2,
        item: { id: 'tool-1', type: 'commandExecution', aggregatedOutput: 'private' },
      },
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

  it('rejects unadmitted server requests, including experimental dynamic tools', async () => {
    const { runtime, client } = fixtureRuntime(new FixtureClient(), { reconnectDelaysMs: [] });
    await runtime.connect(configuration);
    client.emitRequest({
      id: 'dynamic-tool-1',
      method: 'item/tool/call',
      params: { tool: 'desky_jump', arguments: {} },
    });
    expect(client.responseErrors).toEqual([{
      id: 'dynamic-tool-1',
      error: { code: -32601, message: 'Unsupported Codex server request.' },
    }]);
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
      params: {
        threadId: 'thread-1', turnId: 'turn-1', itemId: 'tool-1',
        startedAtMs: 1, environmentId: null, reason: 'Run tests',
      },
    });
    await runtime.resolveApproval({ requestId: 'codex:number:7', kind: 'exec', decision: 'allow-once' });
    expect(client.responses).toContainEqual({ id: 7, result: { decision: 'accept' } });
    expect(events.slice(-2)).toEqual(['approval.requested', 'approval.resolved']);
    await expect(runtime.resolveApproval({ requestId: 'codex:number:7', kind: 'exec', decision: 'deny' }))
      .rejects.toThrow('Unknown or expired');

    client.emitRequest({
      id: 8,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'wrong-thread', turnId: 'turn-1', itemId: 'file-1', startedAtMs: 2,
      },
    });
    expect(client.responses).toContainEqual({ id: 8, result: { decision: 'decline' } });
  });

  it('interrupts active work, terminates its client tree, and restores the selected thread', async () => {
    const first = new FixtureClient();
    const second = new FixtureClient();
    const clients = [first, second];
    const { runtime } = fixtureRuntime(first, {
      createClient: () => {
        const next = clients.shift();
        if (!next) throw new Error('No fixture client available.');
        return next;
      },
    });
    const events: string[] = [];
    const approvalStatuses: string[] = [];
    runtime.onEvent((event) => {
      events.push(event.type);
      if (event.type === 'approval.resolved') approvalStatuses.push(event.payload.status);
    });
    await runtime.connect(configuration);
    await runtime.selectSession('thread-1');
    await runtime.send('Long task');
    first.emitRequest({
      id: 19,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1', turnId: 'turn-1', itemId: 'tool-1',
        startedAtMs: 1, environmentId: null, reason: 'Run a command',
      },
    });
    await runtime.cancel();
    expect(first.calls.at(-1)).toEqual({
      method: 'turn/interrupt', params: { threadId: 'thread-1', turnId: 'turn-1' },
    });
    expect(first.closed).toBe(true);
    expect(approvalStatuses).toEqual(['cancelled']);
    expect(second.calls).toContainEqual({ method: 'thread/resume', params: { threadId: 'thread-1' } });
    expect(events.filter((event) => event === 'turn.failed')).toHaveLength(1);
    expect(runtime.getState()).toMatchObject({
      status: 'connected',
      reconnectAttempt: 0,
      selectedSessionId: 'thread-1',
      activeTurnId: undefined,
      message: 'Codex app-server reconnected',
    });
    first.emitNotification({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted', error: null } },
    });
    expect(events.filter((event) => event === 'turn.failed')).toHaveLength(1);
  });

  it('fails closed for missing auth and unexpected process exit', async () => {
    const authClient = new FixtureClient();
    authClient.account = { account: null, requiresOpenaiAuth: true };
    const auth = fixtureRuntime(authClient).runtime;
    await expect(auth.connect(configuration)).rejects.toThrow('Sign in with the Codex CLI');
    expect(auth.getState().status).toBe('error');

    const { runtime, client } = fixtureRuntime(
      new FixtureClient(),
      { reconnectDelaysMs: [] },
    );
    const events = vi.fn();
    runtime.onEvent(events);
    await runtime.connect(configuration);
    client.emitClose('token=secret process crashed');
    expect(runtime.getState()).toMatchObject({ status: 'error', message: 'token=[redacted] process crashed' });
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'connection.closed' }));
  });

  it('restarts with bounded admission, resumes the selected thread, and never replays a lost turn', async () => {
    const first = new FixtureClient();
    const second = new FixtureClient();
    const clients = [first, second];
    let connectionSequence = 0;
    const createClient = vi.fn(() => {
      const next = clients.shift();
      if (!next) throw new Error('No fixture client available.');
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
    await runtime.selectSession('thread-1');
    await runtime.send('Do not replay this turn');
    first.emitRequest({
      id: 91,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1', turnId: 'turn-1', itemId: 'tool-1',
        startedAtMs: 1, environmentId: null, reason: 'Run a command',
      },
    });

    first.emitClose('Codex app-server exited with code 7.');
    await vi.waitFor(() => expect(runtime.getState().status).toBe('connected'));

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(second.calls).toContainEqual({ method: 'thread/resume', params: { threadId: 'thread-1' } });
    expect(second.calls.some((call) => call.method === 'turn/start')).toBe(false);
    expect(runtime.getState()).toMatchObject({
      reconnectAttempt: 0,
      selectedSessionId: 'thread-1',
      activeTurnId: undefined,
      message: 'Codex app-server reconnected',
    });
    expect(events.filter((event) => event === 'turn.failed')).toHaveLength(1);
    expect(events.filter((event) => event === 'approval.resolved')).toHaveLength(1);
    expect(events.filter((event) => event === 'connection.closed')).toHaveLength(1);
    expect(events.filter((event) => event === 'connection.ready')).toHaveLength(2);
  });

  it('stops after three failed reconnect admissions', async () => {
    const first = new FixtureClient();
    const createClient = vi.fn(() => {
      if (createClient.mock.calls.length === 1) return first;
      const failed = new FixtureClient();
      failed.connect = async () => {
        failed.emitClose('restart process exited');
        throw new Error('restart failed');
      };
      return failed;
    });
    const { runtime } = fixtureRuntime(first, {
      createClient,
      reconnectDelaysMs: [0, 0, 0],
      wait: async () => undefined,
    });
    await runtime.connect(configuration);
    first.emitClose('process crashed');
    await vi.waitFor(() => expect(runtime.getState().status).toBe('error'));
    expect(createClient).toHaveBeenCalledTimes(4);
    expect(runtime.getState()).toMatchObject({ reconnectAttempt: 3, activeTurnId: undefined });
    expect(runtime.getState().message).toContain('could not reconnect');
  });

  it('does not restart protocol or process-tree failures', async () => {
    const client = new FixtureClient();
    const createClient = vi.fn(() => client);
    const { runtime } = fixtureRuntime(client, {
      createClient,
      reconnectDelaysMs: [0, 0, 0],
      wait: async () => undefined,
    });
    await runtime.connect(configuration);
    client.emitClose('Codex app-server emitted invalid JSON.', false);
    expect(runtime.getState()).toMatchObject({
      status: 'error',
      reconnectAttempt: 0,
      message: 'Codex app-server emitted invalid JSON.',
    });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('closes the supervised runtime on a malformed consumed notification', async () => {
    const { runtime, client } = fixtureRuntime();
    const events = vi.fn();
    runtime.onEvent(events);
    await runtime.connect(configuration);
    await runtime.selectSession('thread-1');
    await runtime.send('Inspect the repository');
    client.emitNotification({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'unknown' } },
    });
    expect(client.closed).toBe(true);
    expect(runtime.getState()).toMatchObject({
      status: 'error',
      message: 'Codex app-server protocol validation failed.',
      activeTurnId: undefined,
    });
    expect(events).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'connection.closed',
      payload: { reason: 'Codex app-server protocol validation failed.' },
    }));
  });
});
