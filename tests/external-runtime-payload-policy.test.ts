import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const verifier = resolve('scripts/verify-external-runtime-payload.mjs');
const temporaryRoots: string[] = [];

function temporaryPackage(): string {
  const root = mkdtempSync(join(tmpdir(), 'deskii-runtime-payload-policy-'));
  temporaryRoots.push(root);
  return root;
}

function verify(root: string) {
  return spawnSync(process.execPath, [verifier, root], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('external runtime payload release policy', () => {
  it('admits an ordinary compiled Electron package tree', () => {
    const root = temporaryPackage();
    mkdirSync(join(root, 'resources'), { recursive: true });
    writeFileSync(join(root, 'Desky.exe'), 'electron');
    writeFileSync(join(root, 'resources', 'app.asar'), 'bundle');

    const result = verify(root);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      verified: true,
      filesInspected: 2,
      signaturesAbsent: 8,
    });
  });

  it('rejects a bundled external provider executable regardless of case', () => {
    const root = temporaryPackage();
    writeFileSync(join(root, 'Claude.EXE'), 'external runtime');

    const result = verify(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('forbidden external runtime payload');
  });

  it('rejects a bundled Hermes or local speech-runtime directory', () => {
    const root = temporaryPackage();
    mkdirSync(join(root, 'resources', 'faster_whisper'), { recursive: true });
    writeFileSync(join(root, 'resources', 'faster_whisper', 'model.bin'), 'model');

    const result = verify(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('forbidden external runtime payload');
  });
});
