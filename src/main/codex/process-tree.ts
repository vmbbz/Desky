import { spawn, type ChildProcess } from 'node:child_process';
import { basename, isAbsolute, join } from 'node:path';

export interface CodexProcessTreeRoot {
  readonly pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
}

export type CodexProcessTreeTerminator = (
  root: CodexProcessTreeRoot,
  rootAlreadyExited?: boolean,
) => Promise<void>;

interface CodexProcessTreeTerminatorOptions {
  platform?: NodeJS.Platform;
  systemRoot?: string;
  commandTimeoutMs?: number;
  spawnCommand?: typeof spawn;
  signalProcessGroup?: (pid: number, signal: NodeJS.Signals | 0) => void;
  wait?: (milliseconds: number) => Promise<void>;
}

const defaultCommandTimeoutMs = 5_000;
const unixGraceMs = 500;

function validPid(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0;
}

function boundedCommand(
  child: ChildProcess,
  timeoutMs: number,
  acceptedExitCodes: ReadonlySet<number>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Codex process-tree termination timed out.'));
    }, timeoutMs);
    child.once('error', () => finish(new Error('Codex process-tree termination could not start.')));
    child.once('exit', (code) => {
      if (code !== null && acceptedExitCodes.has(code)) finish();
      else finish(new Error('Codex process-tree termination failed.'));
    });
  });
}

function signalMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH';
}

/**
 * Creates a bounded, shell-free process-tree terminator. Windows uses the OS
 * tree primitive; Unix launches app-server as its own process group and signals
 * that group. Callers must not accept renderer-controlled paths or commands.
 */
export function createCodexProcessTreeTerminator(
  options: CodexProcessTreeTerminatorOptions = {},
): CodexProcessTreeTerminator {
  const platform = options.platform ?? process.platform;
  const commandTimeoutMs = options.commandTimeoutMs ?? defaultCommandTimeoutMs;
  const spawnCommand = options.spawnCommand ?? spawn;
  const signalProcessGroup = options.signalProcessGroup
    ?? ((pid, signal) => process.kill(-pid, signal));
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (!Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 100 || commandTimeoutMs > 15_000) {
    throw new Error('Invalid Codex process-tree termination policy.');
  }

  if (platform === 'win32') {
    const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
    const taskkillPath = join(systemRoot, 'System32', 'taskkill.exe');
    if (!isAbsolute(taskkillPath) || basename(taskkillPath).toLowerCase() !== 'taskkill.exe') {
      throw new Error('Windows process-tree termination is unavailable.');
    }
    return async (root, rootAlreadyExited = false) => {
      if (!validPid(root.pid)) throw new Error('Codex process id is unavailable.');
      const command = spawnCommand(taskkillPath, ['/pid', String(root.pid), '/t', '/f'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      try {
        await boundedCommand(command, commandTimeoutMs, new Set(rootAlreadyExited ? [0, 128] : [0]));
      } catch (error) {
        if (!rootAlreadyExited) root.kill('SIGKILL');
        throw error;
      }
    };
  }

  return async (root) => {
    if (!validPid(root.pid)) throw new Error('Codex process id is unavailable.');
    try {
      signalProcessGroup(root.pid, 'SIGTERM');
    } catch (error) {
      if (signalMissing(error)) return;
      throw new Error('Codex process-tree termination failed.');
    }
    await wait(unixGraceMs);
    try {
      signalProcessGroup(root.pid, 0);
      signalProcessGroup(root.pid, 'SIGKILL');
    } catch (error) {
      if (!signalMissing(error)) throw new Error('Codex process-tree termination failed.');
    }
  };
}
