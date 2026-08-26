import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

const profileId = process.argv[2];
const platforms = {
  'windows-store-free': 'win32',
  'windows-direct': 'win32',
  'macos-store': 'darwin',
  'macos-direct': 'darwin',
};
const target = platforms[profileId];
if (!target) throw new Error(`Unknown release packaging profile: ${profileId ?? '<missing>'}`);
if (process.platform !== target) {
  throw new Error(`Release profile ${profileId} must be packaged on ${target}, not ${process.platform}.`);
}

const forgeCli = require.resolve('@electron-forge/cli/dist/electron-forge.js');
const packaged = spawnSync(process.execPath, [forgeCli, 'package'], {
  cwd: process.cwd(),
  env: { ...process.env, DESKY_RELEASE_PROFILE: profileId },
  stdio: 'inherit',
});
if (packaged.status !== 0) process.exit(packaged.status ?? 1);

const platformDirectory = target === 'win32'
  ? 'Desky-win32-x64'
  : `Desky-darwin-${process.arch}`;
const archivePath = target === 'win32'
  ? resolve('out', platformDirectory, 'resources', 'app.asar')
  : resolve('out', platformDirectory, 'Desky.app', 'Contents', 'Resources', 'app.asar');
const verifier = resolve('scripts', 'verify-release-artifact.mjs');
const verified = spawnSync(process.execPath, [verifier, profileId, archivePath], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
process.exit(verified.status ?? 1);
