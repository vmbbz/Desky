import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const vitest = resolve('node_modules/vitest/vitest.mjs');

const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(process.execPath, [vitest, 'run', 'tests/hermes-live.test.ts'], {
    env: {
      ...process.env,
      DESKY_HERMES_LIVE: '1',
      DESKY_HERMES_MODEL_LIVE: '1',
      DESKY_HERMES_APPROVAL_LIVE: '1',
    },
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (signal) reject(new Error(`Hermes matrix runner exited after signal ${signal}.`));
    else resolveExit(code ?? 1);
  });
});

process.exitCode = exitCode;
