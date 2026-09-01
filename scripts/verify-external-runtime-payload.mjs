import { readdirSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const forbiddenExternalRuntimeNames = Object.freeze([
  'claude.exe',
  'openclaw.mjs',
  'python.exe',
  'pythonw.exe',
  'whisper-cli.exe',
]);

export const forbiddenExternalRuntimePathSegments = Object.freeze([
  'hermes_cli',
  'faster_whisper',
  'ctranslate2',
]);

function normalizedRelativePath(root, path) {
  return relative(root, path).split(sep).join('/').toLowerCase();
}

function walk(root, directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const relativePath = normalizedRelativePath(root, path);
    if (entry.isSymbolicLink()) {
      throw new Error(`Release artifact contains an unsupported symbolic link '${relativePath}'.`);
    }
    if (entry.isDirectory()) {
      const segments = relativePath.split('/');
      const forbiddenSegment = segments.find((segment) => forbiddenExternalRuntimePathSegments.includes(segment));
      if (forbiddenSegment) {
        throw new Error(`Release artifact contains forbidden external runtime payload '${relativePath}/'.`);
      }
      walk(root, path, files);
      continue;
    }
    if (entry.isFile()) files.push({ name: entry.name.toLowerCase(), relativePath });
  }
}

export function inspectExternalRuntimePayload(packageRoot) {
  if (typeof packageRoot !== 'string' || packageRoot.trim() === '') {
    throw new Error('A package root is required.');
  }
  const root = resolve(packageRoot);
  if (!isAbsolute(root) || !statSync(root).isDirectory()) {
    throw new Error(`Package root is not a directory: ${root}`);
  }

  const files = [];
  walk(root, root, files);
  const forbiddenFile = files.find((file) => forbiddenExternalRuntimeNames.includes(file.name));
  if (forbiddenFile) {
    throw new Error(`Release artifact contains forbidden external runtime payload '${forbiddenFile.relativePath}'.`);
  }

  return Object.freeze({
    schemaVersion: 1,
    verified: true,
    filesInspected: files.length,
    signaturesAbsent: forbiddenExternalRuntimeNames.length + forbiddenExternalRuntimePathSegments.length,
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const report = inspectExternalRuntimePayload(process.argv[2]);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
