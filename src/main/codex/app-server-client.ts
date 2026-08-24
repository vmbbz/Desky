import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute, basename } from 'node:path';

import {
  createCodexProcessTreeTerminator,
  type CodexProcessTreeTerminator,
} from './process-tree';

type RpcId = number | string;

interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface CodexServerNotification {
  method: string;
  params: unknown;
}

export interface CodexServerRequest extends CodexServerNotification {
  id: RpcId;
}

export interface CodexClientClose {
  reason: string;
  reconnectable: boolean;
}

export interface CodexProcessPort {
  readonly pid?: number;
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export type CodexProcessFactory = () => CodexProcessPort;

interface PendingRequest {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

const maximumLineBytes = 1_048_576;
const maximumStderrBytes = 65_536;
const defaultRequestTimeoutMs = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rpcError(value: unknown): RpcError | undefined {
  if (!isRecord(value)
    || typeof value.code !== 'number'
    || typeof value.message !== 'string') return undefined;
  return { code: value.code, message: value.message.slice(0, 240), data: value.data };
}

function safeExitMessage(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `Codex app-server exited after signal ${signal}.`;
  return `Codex app-server exited with code ${code ?? 'unknown'}.`;
}

export function createCodexProcessFactory(
  executablePath: string,
  environment: NodeJS.ProcessEnv,
): CodexProcessFactory {
  if (!isAbsolute(executablePath)
    || !['codex', 'codex.exe'].includes(basename(executablePath).toLowerCase())) {
    throw new Error('Codex executable must be an absolute path with the expected filename.');
  }
  return () => spawn(executablePath, ['app-server', '--listen', 'stdio://'], {
    env: environment,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  }) as ChildProcessWithoutNullStreams;
}

/**
 * Bounded JSONL JSON-RPC peer for a supervised Codex app-server process.
 * It owns framing, correlation, initialization, server requests, and teardown;
 * Codex semantic normalization belongs to the runtime above it.
 */
export class CodexAppServerClient {
  private process?: CodexProcessPort;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrBuffer = Buffer.alloc(0);
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationListeners = new Set<(value: CodexServerNotification) => void>();
  private readonly requestListeners = new Set<(value: CodexServerRequest) => void>();
  private readonly closeListeners = new Set<(value: CodexClientClose) => void>();
  private closing = false;
  private termination?: Promise<void>;

  constructor(
    private readonly processFactory: CodexProcessFactory,
    private readonly clientVersion: string,
    private readonly requestTimeoutMs = defaultRequestTimeoutMs,
    private readonly terminateProcessTree: CodexProcessTreeTerminator = createCodexProcessTreeTerminator(),
  ) {}

  async connect(): Promise<unknown> {
    if (this.process) throw new Error('Codex app-server is already connected.');
    this.closing = false;
    const child = this.processFactory();
    this.process = child;
    child.stdout.on('data', (chunk: Buffer | string) => this.acceptStdout(chunk));
    child.stderr.on('data', (chunk: Buffer | string) => this.acceptStderr(chunk));
    child.once('exit', (code, signal) => this.handleExit(code, signal));
    const initialized = await this.request('initialize', {
      clientInfo: {
        name: 'desky',
        title: 'Desky',
        version: this.clientVersion,
      },
    });
    this.notify('initialized', {});
    return initialized;
  }

  request(method: string, params: unknown = {}): Promise<unknown> {
    if (!this.process || this.closing) return Promise.reject(new Error('Codex app-server is not connected.'));
    if (!method || method.length > 160) return Promise.reject(new Error('Invalid Codex app-server method.'));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { method, resolve, reject, timeout });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error('Failed to write Codex request.'));
      }
    });
  }

  notify(method: string, params: unknown = {}): void {
    if (!this.process || this.closing) throw new Error('Codex app-server is not connected.');
    this.write({ method, params });
  }

  respond(id: RpcId, result: unknown): void {
    if (!this.process || this.closing) throw new Error('Codex app-server is not connected.');
    this.write({ id, result });
  }

  respondError(id: RpcId, error: RpcError): void {
    if (!this.process || this.closing) throw new Error('Codex app-server is not connected.');
    this.write({ id, error });
  }

  onNotification(listener: (value: CodexServerNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onRequest(listener: (value: CodexServerRequest) => void): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onClose(listener: (value: CodexClientClose) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  getStderrPreview(secrets: Array<string | undefined> = []): string {
    let preview = this.stderrBuffer.toString('utf8').replace(/[\r\n]+/g, ' ').trim();
    for (const secret of secrets) {
      if (secret) preview = preview.replaceAll(secret, '[redacted]');
    }
    return preview
      .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
      .replace(/(token|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
      .slice(-240);
  }

  async close(): Promise<void> {
    if (!this.process) {
      await this.termination;
      return;
    }
    this.closing = true;
    const child = this.process;
    this.process = undefined;
    this.rejectPending(new Error('Codex app-server connection closed.'));
    this.stdoutBuffer = Buffer.alloc(0);
    this.stderrBuffer = Buffer.alloc(0);
    this.termination = this.terminateProcessTree(child);
    await this.termination;
  }

  private write(message: object): void {
    const encoded = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
    if (encoded.byteLength > maximumLineBytes) throw new Error('Codex app-server request exceeds the JSONL limit.');
    this.process?.stdin.write(encoded);
  }

  private acceptStdout(chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, bytes]);
    if (this.stdoutBuffer.byteLength > maximumLineBytes && !this.stdoutBuffer.includes(0x0a)) {
      this.failProtocol('Codex app-server emitted an oversized JSONL message.');
      return;
    }
    let newline = this.stdoutBuffer.indexOf(0x0a);
    while (newline >= 0) {
      const line = this.stdoutBuffer.subarray(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (line.byteLength > maximumLineBytes) {
        this.failProtocol('Codex app-server emitted an oversized JSONL message.');
        return;
      }
      if (line.byteLength > 0) this.acceptLine(line.toString('utf8').replace(/\r$/, ''));
      newline = this.stdoutBuffer.indexOf(0x0a);
    }
  }

  private acceptStderr(chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    this.stderrBuffer = Buffer.concat([this.stderrBuffer, bytes]).subarray(-maximumStderrBytes);
  }

  private acceptLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.failProtocol('Codex app-server emitted invalid JSON.');
      return;
    }
    if (!isRecord(value)) {
      this.failProtocol('Codex app-server emitted an invalid message envelope.');
      return;
    }
    const id = typeof value.id === 'number' || typeof value.id === 'string' ? value.id : undefined;
    if (id !== undefined && typeof value.method === 'string') {
      for (const listener of this.requestListeners) listener({ id, method: value.method, params: value.params });
      return;
    }
    if (typeof id === 'number' && ('result' in value || 'error' in value)) {
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      const error = rpcError(value.error);
      if (error) pending.reject(new Error(`Codex ${pending.method} failed (${error.code}): ${error.message}`));
      else pending.resolve(value.result);
      return;
    }
    if (id === undefined && typeof value.method === 'string') {
      for (const listener of this.notificationListeners) listener({ method: value.method, params: value.params });
      return;
    }
    this.failProtocol('Codex app-server emitted an invalid message envelope.');
  }

  private failProtocol(message: string): void {
    const error = new Error(message);
    this.rejectPending(error);
    const child = this.process;
    this.process = undefined;
    this.closing = true;
    this.termination = child
      ? this.terminateProcessTree(child)
      : Promise.resolve();
    void this.termination.then(
      () => {
        for (const listener of this.closeListeners) listener({ reason: message, reconnectable: false });
      },
      () => {
        for (const listener of this.closeListeners) {
          listener({
            reason: `${message} Codex process-tree termination failed.`,
            reconnectable: false,
          });
        }
      },
    );
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (!this.process && this.closing) return;
    const reason = this.closing ? 'Codex app-server connection closed.' : safeExitMessage(code, signal);
    const child = this.process;
    this.process = undefined;
    this.rejectPending(new Error(reason));
    this.termination = child ? this.terminateProcessTree(child, true) : Promise.resolve();
    void this.termination.then(
      () => {
        for (const listener of this.closeListeners) listener({ reason, reconnectable: true });
      },
      () => {
        for (const listener of this.closeListeners) {
          listener({
            reason: `${reason} Codex process-tree termination failed.`,
            reconnectable: false,
          });
        }
      },
    );
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
