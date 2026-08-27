import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';

const require = createRequire(import.meta.url);
const profileId = process.argv[2];
const development = process.argv.includes('--development');
const platforms = {
  'windows-store-free': 'win32',
  'windows-direct': 'win32',
  'macos-store': 'darwin',
  'macos-direct': 'darwin',
};
const target = platforms[profileId];

if (!target) throw new Error(`Unknown release make profile: ${profileId ?? '<missing>'}`);
if (process.platform !== target) {
  throw new Error(`Release profile ${profileId} must be made on ${target}, not ${process.platform}.`);
}

const forgeCli = require.resolve('@electron-forge/cli/dist/electron-forge.js');
const packageMetadata = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const releaseMode = development ? 'development' : 'production';
if (target === 'win32') {
  const makeRoot = resolve('out', 'make');
  const generatedTarget = profileId === 'windows-store-free'
    ? resolve(makeRoot, 'msix', 'x64')
    : resolve(makeRoot, 'squirrel.windows', 'x64');
  if (!generatedTarget.startsWith(`${makeRoot}${sep}`)) {
    throw new Error(`Refusing to clear maker output outside ${makeRoot}.`);
  }
  rmSync(generatedTarget, { recursive: true, force: true });
}
const made = spawnSync(process.execPath, [forgeCli, 'make'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DESKY_RELEASE_PROFILE: profileId,
    DESKY_RELEASE_MODE: releaseMode,
  },
  stdio: 'inherit',
});

if (made.status !== 0) process.exit(made.status ?? 1);

if (target === 'win32') {
  const artifactDirectory = profileId === 'windows-store-free'
    ? resolve('out', 'make', 'msix', 'x64')
    : resolve('out', 'make', 'squirrel.windows', 'x64');
  const artifactName = profileId === 'windows-store-free'
    ? 'Desky.msix'
    : development
      ? `Desky-${packageMetadata.version}-Development-Setup.exe`
      : `Desky-${packageMetadata.version}-Setup.exe`;
  const artifactPath = resolve(artifactDirectory, artifactName);
  const verificationPath = resolve('out', 'release-evidence', profileId, 'artifact-verification.json');
  const verification = spawnSync('pwsh.exe', [
    '-NoProfile',
    '-File', resolve('scripts', 'verify-windows-distributable.ps1'),
    '-ProfileId', profileId,
    '-ArtifactPath', artifactPath,
    '-ReleaseMode', releaseMode,
    '-OutputPath', verificationPath,
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (verification.status !== 0) process.exit(verification.status ?? 1);

  const evidenceArtifacts = profileId === 'windows-store-free'
    ? [artifactPath]
    : readdirSync(artifactDirectory)
        .filter((name) => name.endsWith('.exe') || name.endsWith('-full.nupkg'))
        .map((name) => resolve(artifactDirectory, name));
  const evidence = spawnSync(process.execPath, [
    resolve('scripts', 'generate-release-evidence.mjs'),
    profileId,
    releaseMode,
    ...evidenceArtifacts,
  ], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  process.exit(evidence.status ?? 1);
}

process.exit(0);
