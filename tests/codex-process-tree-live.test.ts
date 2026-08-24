import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { createCodexProcessTreeTerminator } from '../src/main/codex/process-tree';

const liveEnabled = process.env.DESKY_CODEX_PROCESS_TREE_LIVE === '1';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number): Promise<void> {
  await expect.poll(() => isAlive(pid), { timeout: 5_000, interval: 50 }).toBe(false);
}

describe.skipIf(!liveEnabled)('Codex process-tree live containment', () => {
  it('terminates a real parent and descendant without a shell', async () => {
    const parent = spawn(process.execPath, ['-e', [
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      'console.log(child.pid);',
      'setInterval(() => {}, 1000);',
    ].join(' ')], {
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    if (!parent.pid) throw new Error('Fixture parent did not start.');
    const childPid = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Fixture descendant did not start.')), 5_000);
      parent.stdout.once('data', (chunk: Buffer) => {
        clearTimeout(timeout);
        const value = Number.parseInt(chunk.toString('utf8').trim(), 10);
        if (!Number.isSafeInteger(value) || value < 1) reject(new Error('Fixture descendant pid was invalid.'));
        else resolve(value);
      });
    });
    try {
      await createCodexProcessTreeTerminator()(parent);
      await Promise.all([waitForExit(parent.pid), waitForExit(childPid)]);
    } finally {
      if (isAlive(parent.pid)) parent.kill('SIGKILL');
      if (isAlive(childPid)) process.kill(childPid, 'SIGKILL');
    }
  });
});
