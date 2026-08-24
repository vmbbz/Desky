import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn } from 'node:child_process';

import { describe, expect, it, vi } from 'vitest';

import { createCodexProcessTreeTerminator } from '../src/main/codex/process-tree';

class FixtureCommand extends EventEmitter {
  kill = vi.fn(() => true);
}

describe('Codex process-tree termination', () => {
  it('uses bounded shell-free Windows tree termination', async () => {
    const command = new FixtureCommand();
    const spawnCommand = vi.fn(() => command as unknown as ChildProcess);
    const root = { pid: 4_321, kill: vi.fn(() => true) };
    const terminate = createCodexProcessTreeTerminator({
      platform: 'win32',
      systemRoot: 'C:\\Windows',
      spawnCommand: spawnCommand as unknown as typeof spawn,
    });
    const terminating = terminate(root);
    expect(spawnCommand).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/pid', '4321', '/t', '/f'],
      { shell: false, stdio: 'ignore', windowsHide: true },
    );
    command.emit('exit', 0, null);
    await expect(terminating).resolves.toBeUndefined();
    expect(root.kill).not.toHaveBeenCalled();
  });

  it('signals the complete detached Unix process group with bounded escalation', async () => {
    const signalProcessGroup = vi.fn();
    const wait = vi.fn(async () => undefined);
    const terminate = createCodexProcessTreeTerminator({
      platform: 'linux',
      signalProcessGroup,
      wait,
    });
    await terminate({ pid: 7_654, kill: vi.fn(() => true) });
    expect(signalProcessGroup.mock.calls).toEqual([
      [7_654, 'SIGTERM'],
      [7_654, 0],
      [7_654, 'SIGKILL'],
    ]);
    expect(wait).toHaveBeenCalledWith(500);
  });

  it('rejects missing process identity and unbounded policy values', async () => {
    const terminate = createCodexProcessTreeTerminator({ platform: 'linux' });
    await expect(terminate({ kill: vi.fn(() => true) })).rejects.toThrow('process id');
    expect(() => createCodexProcessTreeTerminator({ commandTimeoutMs: 60_000 }))
      .toThrow('Invalid Codex process-tree termination policy');
  });
});
