import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workspace = await mkdtemp(join(tmpdir(), 'desky-codex-live-'));
const vitest = resolve('node_modules/vitest/vitest.mjs');
let exitCode = 1;

try {
  exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [vitest, 'run', 'tests/codex-model-live.test.ts'], {
      env: {
        ...process.env,
        DESKY_CODEX_MODEL_LIVE: '1',
        DESKY_CODEX_MATRIX_WORKSPACE: workspace,
      },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Codex matrix runner exited after signal ${signal}.`));
      else resolveExit(code ?? 1);
    });
  });
} finally {
  await rm(workspace, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 500,
  });
}

process.exitCode = exitCode;
