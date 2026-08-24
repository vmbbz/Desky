import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AvatarCache } from '../src/main/avatar-cache';
import {
  admitVrm1CompatibilityFixture,
  vrm1CompatibilityRevision,
} from '../src/main/vrm1-compatibility-fixture';

const fixturePath = process.env.DESKY_VRM1_COMPATIBILITY_FILE;

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function expectPinnedBytes(value: ArrayBuffer): void {
  const bytes = new Uint8Array(value);
  expect(bytes.byteLength).toBe(vrm1CompatibilityRevision.modelBytes);
  expect(createHash('sha256').update(bytes).digest('hex'))
    .toBe(vrm1CompatibilityRevision.avatar.modelSha256);
}

describe.runIf(Boolean(fixturePath))('real VRM 1.0 compatibility fixture', () => {
  it('passes pinned identity, VRM 1.0 cache admission, offline restart, and repair', async () => {
    if (!fixturePath) throw new Error('DESKY_VRM1_COMPATIBILITY_FILE is required.');
    const bytes = await readFile(fixturePath);
    const selected = admitVrm1CompatibilityFixture(bytes);
    expect(selected.avatar).toMatchObject({
      name: 'Seed-san',
      licenseId: 'VRM-Public-License-1.0',
    });

    const directory = await mkdtemp(join(tmpdir(), 'desky-vrm1-cache-'));
    try {
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        expect(String(input)).toBe(vrm1CompatibilityRevision.modelUrl);
        return new Response(responseBody(bytes), { status: 200 });
      });
      const cache = new AvatarCache(directory, fetcher);
      expectPinnedBytes(await cache.get(vrm1CompatibilityRevision));
      expect(fetcher).toHaveBeenCalledTimes(1);

      const offline = new AvatarCache(directory, async () => {
        throw new Error('Network must not be used for a verified restart.');
      });
      expectPinnedBytes(await offline.get(vrm1CompatibilityRevision));
      const inventory = await offline.inspect([vrm1CompatibilityRevision]);
      expect(inventory.entries[0]).toMatchObject({
        avatarId: 'compatibility.seed-san',
        modelStatus: 'verified',
      });
      expect(inventory.entries[0].modelBytes).toBeGreaterThan(
        vrm1CompatibilityRevision.modelBytes,
      );

      await writeFile(
        join(directory, 'records', `${vrm1CompatibilityRevision.avatar.revisionId}.json`),
        '{"schemaVersion":99}',
      );
      expectPinnedBytes(await cache.get(vrm1CompatibilityRevision));
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
