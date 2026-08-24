import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type {
  ClaudeSdkClientPort,
  ClaudeSdkQueryHandle,
  ClaudeSdkStartInput,
} from '../src/main/claude/sdk-client';
import { ClaudeRuntime, readClaudeConfiguration } from '../src/main/claude/runtime';

class MessageQueue implements AsyncIterable<SDKMessage> {
  private readonly values: SDKMessage[] = [];
  private readonly waiters: Array<(value: IteratorResult<SDKMessage>) => void> = [];
  private ended = false;

  emit(value: unknown) {
    const message = value as SDKMessage;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.values.push(message);
  }

  end() {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolveNext) => this.waiters.push(resolveNext));
      },
    };
  }
}

class FixtureClaudeClient implements ClaudeSdkClientPort {
  readonly queue = new MessageQueue();
  readonly abort = vi.fn();
  readonly close = vi.fn(() => this.queue.end());
  readonly starts: ClaudeSdkStartInput[] = [];

  async listSessions() {
    return [{ id: 'session-1', label: 'Existing', updatedAt: 1 }];
  }

  async start(input: ClaudeSdkStartInput): Promise<ClaudeSdkQueryHandle> {
    this.starts.push(input);
    return { messages: this.queue, abort: this.abort, close: this.close };
  }
}

const workspaceDirectory = resolve('claude-workspace');
const configuration = {
  workspaceGrantId: 'codex-workspace:claude-test',
  apiKey: 'secret-anthropic-key',
  permissionMode: 'plan' as const,
};

function fixtureRuntime(client = new FixtureClaudeClient()) {
  const resolveWorkspaceGrant = vi.fn(async () => workspaceDirectory);
  return {
    client,
    resolveWorkspaceGrant,
    runtime: new ClaudeRuntime({
      appVersion: '0.1.0',
      createClient: () => client,
      createConnectionId: () => 'connection-1',
      createTurnId: () => 'turn-1',
      resolveWorkspaceGrant,
    }),
  };
}

const initMessage = {
  type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY',
  session_id: 'session-1', claude_code_version: '2.1.241', model: 'claude-sonnet-4-6',
  tools: ['Read', 'Bash'], capabilities: ['interrupt_receipt_v1'],
};

describe('ClaudeRuntime foundation', () => {
  it('requires an opaque workspace grant and maps permission mode to grant scope', async () => {
    expect(readClaudeConfiguration(configuration)).toEqual(configuration);
    expect(() => readClaudeConfiguration({ ...configuration, apiKey: '' }))
      .toThrow('Invalid Claude');
    const { runtime, resolveWorkspaceGrant } = fixtureRuntime();
    const state = await runtime.connect(configuration);
    expect(resolveWorkspaceGrant).toHaveBeenCalledWith(configuration.workspaceGrantId, 'read-only');
    expect(state).toMatchObject({
      adapterId: 'claude', status: 'connected', selectedSessionId: 'session-1',
      runtimeVersion: 'Agent SDK 0.3.241',
    });
  });

  it('streams a session, resolves SDK permission callbacks, and completes exactly once', async () => {
    const { runtime, client } = fixtureRuntime();
    const events: Array<{ type: string; payload: unknown }> = [];
    runtime.onEvent((event) => events.push({ type: event.type, payload: event.payload }));
    await runtime.connect(configuration);
    await runtime.send('Inspect this project');
    expect(client.starts[0]).toMatchObject({
      prompt: 'Inspect this project', cwd: workspaceDirectory,
      apiKey: 'secret-anthropic-key', resumeSessionId: 'session-1', permissionMode: 'plan',
    });
    client.queue.emit(initMessage);
    client.queue.emit({
      type: 'stream_event', session_id: 'session-1',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Working' } },
    });
    const permissionController = new AbortController();
    const permission = client.starts[0].onPermission({
      toolName: 'Bash', input: { command: 'npm test' },
      signal: permissionController.signal, toolUseId: 'tool-1', requestId: 'request-1',
      title: 'Run tests', suggestions: [],
    });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'approval.requested')).toBe(true));
    await runtime.resolveApproval({ requestId: 'request-1', kind: 'exec', decision: 'allow-once' });
    await expect(permission).resolves.toEqual({ behavior: 'allow', updatedInput: { command: 'npm test' } });
    client.queue.emit({
      type: 'result', subtype: 'success', session_id: 'session-1', is_error: false, result: 'Done',
    });
    await vi.waitFor(() => expect(runtime.getState().activeTurnId).toBeUndefined());
    expect(runtime.getState().runtimeVersion).toBe('Claude Code 2.1.241 / SDK 0.3.241');
    expect(events.filter((event) => event.type === 'turn.completed')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'approval.resolved')).toHaveLength(1);
  });

  it('starts a fresh session implicitly and cancels with one local terminal event', async () => {
    const { runtime, client } = fixtureRuntime();
    const events: string[] = [];
    runtime.onEvent((event) => events.push(event.type));
    await runtime.connect(configuration);
    const fresh = await runtime.createSession({ label: 'Desky' });
    expect(fresh.selectedSessionId).toBeUndefined();
    await runtime.send('Start fresh');
    expect(client.starts[0].resumeSessionId).toBeUndefined();
    await runtime.cancel();
    expect(client.abort).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalled();
    expect(events.filter((event) => event === 'turn.failed')).toHaveLength(1);
    expect(runtime.getState().activeTurnId).toBeUndefined();
  });

  it('fails closed when consumer login is reported instead of API-key auth', async () => {
    const { runtime, client } = fixtureRuntime();
    const failures: unknown[] = [];
    runtime.onEvent((event) => {
      if (event.type === 'turn.failed') failures.push(event.payload);
    });
    await runtime.connect(configuration);
    await runtime.send('Hello');
    client.queue.emit({ ...initMessage, apiKeySource: 'none' });
    await vi.waitFor(() => expect(runtime.getState().activeTurnId).toBeUndefined());
    expect(failures).toEqual([expect.objectContaining({ kind: 'error' })]);
  });

  it('redacts API keys and resolved workspace paths from renderer errors', () => {
    const { runtime } = fixtureRuntime();
    expect(runtime.rendererSafeError(
      new Error(`api_key=secret-anthropic-key at ${workspaceDirectory}`),
      configuration,
    )).not.toContain('secret-anthropic-key');
  });
});
