import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  CodexAppServerClient,
  createCodexProcessFactory,
  type CodexProcessPort,
} from '../src/main/codex/app-server-client';

class FixtureProcess extends EventEmitter implements CodexProcessPort {
  readonly pid = 9_001;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly received: Array<Record<string, unknown>> = [];
  killed = false;

  constructor() {
    super();
    let buffer = '';
    this.stdin.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line) this.received.push(JSON.parse(line) as Record<string, unknown>);
        newline = buffer.indexOf('\n');
      }
    });
  }

  kill() {
    this.killed = true;
    return true;
  }

  send(message: unknown) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.emit('exit', code, signal);
  }
}

async function initializedClient() {
  const process = new FixtureProcess();
  const client = new CodexAppServerClient(
    () => process,
    '0.1.0',
    100,
    async (root) => { root.kill('SIGKILL'); },
  );
  const connection = client.connect();
  expect(process.received[0]).toEqual({
    id: 1,
    method: 'initialize',
    params: { clientInfo: { name: 'desky', title: 'Deskii', version: '0.1.0' } },
  });
  process.send({ id: 1, result: { userAgent: 'codex-cli/0.146.0' } });
  await expect(connection).resolves.toEqual({ userAgent: 'codex-cli/0.146.0' });
  expect(process.received[1]).toEqual({ method: 'initialized', params: {} });
  return { client, process };
}

describe('CodexAppServerClient', () => {
  it('initializes once and correlates requests over bounded JSONL', async () => {
    const { client, process } = await initializedClient();
    const result = client.request('thread/list', { limit: 20 });
    expect(process.received[2]).toEqual({ id: 2, method: 'thread/list', params: { limit: 20 } });
    process.send({ id: 2, result: { data: [{ id: 'thread-1' }] } });
    await expect(result).resolves.toEqual({ data: [{ id: 'thread-1' }] });
    await client.close();
    expect(process.killed).toBe(true);
  });

  it('separates notifications and server-initiated approval requests', async () => {
    const { client, process } = await initializedClient();
    const notification = vi.fn();
    const request = vi.fn();
    client.onNotification(notification);
    client.onRequest(request);

    process.send({ method: 'turn/started', params: { turn: { id: 'turn-1' } } });
    process.send({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1' },
    });
    expect(notification).toHaveBeenCalledWith({
      method: 'turn/started',
      params: { turn: { id: 'turn-1' } },
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
    }));
    client.respond('approval-1', { decision: 'decline' });
    expect(process.received.at(-1)).toEqual({ id: 'approval-1', result: { decision: 'decline' } });
  });

  it('bounds RPC errors, stderr diagnostics, and request timeouts', async () => {
    const { client, process } = await initializedClient();
    process.stderr.write(`${'x'.repeat(70_000)}\ntoken=my-secret last diagnostic`);
    expect(client.getStderrPreview()).toContain('last diagnostic');
    expect(client.getStderrPreview()).not.toContain('my-secret');
    expect(client.getStderrPreview().length).toBeLessThanOrEqual(240);

    const failed = client.request('thread/list');
    process.send({ id: 2, error: { code: -32000, message: 'denied'.repeat(100) } });
    await expect(failed).rejects.toThrow(/^Codex thread\/list failed \(-32000\): .{240}$/);
    await expect(client.request('turn/start')).rejects.toThrow('request timed out: turn/start');
  });

  it('fails closed on malformed or oversized stdout and rejects pending work', async () => {
    const { client, process } = await initializedClient();
    const close = vi.fn();
    client.onClose(close);
    const pending = client.request('thread/list');
    process.stdout.write('not-json\n');
    await expect(pending).rejects.toThrow('emitted invalid JSON');
    expect(process.killed).toBe(true);
    expect(close).toHaveBeenCalledWith({
      reason: 'Codex app-server emitted invalid JSON.',
      reconnectable: false,
    });

    const oversizedProcess = new FixtureProcess();
    const oversized = new CodexAppServerClient(
      () => oversizedProcess,
      '0.1.0',
      20_000,
      async (root) => { root.kill('SIGKILL'); },
    );
    const connecting = oversized.connect();
    oversizedProcess.stdout.write('x'.repeat(1_048_577));
    await expect(connecting).rejects.toThrow('oversized JSONL message');
  });

  it('rejects unexpected process exit and arbitrary executable paths', async () => {
    const { client, process } = await initializedClient();
    const pending = client.request('thread/list');
    process.exit(7);
    await expect(pending).rejects.toThrow('exited with code 7');
    expect(() => createCodexProcessFactory('codex', {})).toThrow('absolute path');
    expect(() => createCodexProcessFactory('C:\\tools\\other.exe', {})).toThrow('expected filename');
  });
});
