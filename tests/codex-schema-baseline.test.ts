import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const verifier = resolve('scripts/verify-codex-schema.mjs');

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'desky-schema-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function runVerifier(arguments_: string[]) {
  return spawnSync(process.execPath, [verifier, ...arguments_], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('Codex schema baseline verifier', () => {
  it('writes a reviewable baseline, ignores object-key order, and detects semantic drift', async () => {
    const root = await temporaryDirectory();
    const schemas = join(root, 'schemas');
    const nested = join(schemas, 'v2');
    const manifest = join(root, 'baseline.json');
    await mkdir(nested, { recursive: true });
    await writeFile(join(schemas, 'Envelope.json'), '{"z":2,"a":1}\n');
    await writeFile(join(nested, 'Consumed.json'), '{"type":"object"}\n');
    await writeFile(manifest, `${JSON.stringify({
      schemaVersion: 1,
      codexCliVersion: '1.2.3',
      generator: { command: 'fixture', experimental: false },
      canonicalization: 'fixture',
      fileCount: 1,
      totalCanonicalBytes: 1,
      bundleSha256: '0'.repeat(64),
      consumedSchemas: {
        'v2/Consumed.json': { canonicalBytes: 1, sha256: '0'.repeat(64) },
      },
    }, null, 2)}\n`);

    const refreshed = runVerifier([
      '--manifest', manifest,
      '--schema-dir', schemas,
      '--write-baseline',
    ]);
    expect(refreshed.status).toBe(0);
    const baseline = JSON.parse(await readFile(manifest, 'utf8')) as Record<string, unknown>;
    expect(baseline).toMatchObject({ fileCount: 2 });
    expect(baseline.bundleSha256).toMatch(/^[a-f0-9]{64}$/);

    await writeFile(join(schemas, 'Envelope.json'), '{"a":1,"z":2}\n');
    const reordered = runVerifier(['--manifest', manifest, '--schema-dir', schemas]);
    expect(reordered.status).toBe(0);
    expect(reordered.stdout).toContain('Verified Codex 1.2.3');

    await writeFile(join(schemas, 'Envelope.json'), '{"a":1,"z":3}\n');
    const drifted = runVerifier(['--manifest', manifest, '--schema-dir', schemas]);
    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toContain('Codex schema baseline drift');
  });

  it('rejects non-JSON output before hashing', async () => {
    const root = await temporaryDirectory();
    const schemas = join(root, 'schemas');
    const manifest = join(root, 'baseline.json');
    await mkdir(schemas);
    await writeFile(join(schemas, 'unexpected.txt'), 'not a schema');
    await writeFile(manifest, `${JSON.stringify({
      schemaVersion: 1,
      codexCliVersion: '1.2.3',
      generator: { command: 'fixture', experimental: false },
      canonicalization: 'fixture',
      fileCount: 1,
      totalCanonicalBytes: 1,
      bundleSha256: '0'.repeat(64),
      consumedSchemas: {
        'Consumed.json': { canonicalBytes: 1, sha256: '0'.repeat(64) },
      },
    })}\n`);

    const result = runVerifier(['--manifest', manifest, '--schema-dir', schemas]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('non-JSON file');
  });
});
