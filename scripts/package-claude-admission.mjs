import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const forge = resolve('node_modules/@electron-forge/cli/dist/electron-forge.js');

const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(process.execPath, [forge, 'package'], {
    env: {
      ...process.env,
      DESKY_CLAUDE_ADMISSION_PACKAGE: '1',
    },
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (signal) reject(new Error(`Claude admission packaging exited after signal ${signal}.`));
    else resolveExit(code ?? 1);
  });
});

process.exitCode = exitCode;
