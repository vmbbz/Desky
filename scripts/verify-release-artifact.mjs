import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { extractFile } from '@electron/asar';

const profileId = process.argv[2];
const archivePath = resolve(process.argv[3] ?? 'out/Deskii-win32-x64/resources/app.asar');
const policies = {
  'windows-store-free': { distribution: 'store', platform: 'win32' },
  'windows-direct': { distribution: 'direct', platform: 'win32' },
  'macos-store': { distribution: 'store', platform: 'darwin' },
  'macos-direct': { distribution: 'direct', platform: 'darwin' },
};
const policy = policies[profileId];
if (!policy) throw new Error(`Unsupported artifact-policy profile: ${profileId ?? '<missing>'}`);
if (!existsSync(archivePath)) throw new Error(`Packaged app archive not found: ${archivePath}`);

const read = (path) => extractFile(archivePath, path).toString('utf8');
const main = read('.webpack\\main\\index.js');
const renderer = read('.webpack\\renderer\\main_window\\index.js');
const preload = read('.webpack\\renderer\\main_window\\preload.js');
const packageJson = JSON.parse(read('package.json'));
const combined = `${main}\n${renderer}\n${preload}`;

const requireText = (text, label) => {
  if (!text.includes(label)) throw new Error(`Release artifact is missing ${label}.`);
};
const forbidText = (text, label) => {
  if (text.includes(label)) throw new Error(`Release artifact contains forbidden ${label}.`);
};

requireText(main, `desky-release-profile:${profileId}`);
if (packageJson.main !== '.webpack/main') throw new Error('Packaged application main entry is invalid.');

const commerceSignatures = [
  '/v1/x402/',
  'x402Version',
  '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  'PAYMENT-SIGNATURE',
];
for (const signature of commerceSignatures) forbidText(combined, signature);

if (policy.distribution === 'store') {
  for (const signature of [
    'stdio://',
    '/v1/capabilities',
    '@anthropic-ai/claude-agent-sdk',
    'CLAUDE_AGENT_SDK_VERSION',
  ]) forbidText(main, signature);
} else {
  requireText(main, 'stdio://');
  requireText(main, '/v1/capabilities');
  forbidText(main, '@anthropic-ai/claude-agent-sdk');
  forbidText(main, 'CLAUDE_AGENT_SDK_VERSION');
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  verified: true,
  profileId,
  platform: policy.platform,
  archivePath,
  bytesInspected: Buffer.byteLength(combined),
  commerceSignaturesAbsent: commerceSignatures.length,
})}\n`);
