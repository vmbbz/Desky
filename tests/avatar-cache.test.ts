import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvatarCache } from '../src/main/avatar-cache';
import type { AdmittedAvatarRevision } from '../src/main/marketplace-catalog';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true }),
  ));
});

function minimalVrm(): Uint8Array {
  const source = JSON.stringify({ asset: { version: '2.0' }, extensions: { VRM: {} } });
  const padded = source.padEnd(Math.ceil(source.length / 4) * 4, ' ');
  const json = new TextEncoder().encode(padded);
  const bytes = new Uint8Array(20 + json.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, json.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  return bytes;
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function revision(bytes: Uint8Array): AdmittedAvatarRevision {
  const hash = createHash('sha256').update(bytes).digest('hex');
  return {
    avatar: {
      avatarId: 'test-avatar',
      productId: 'avatar.test',
      revisionId: `test-${hash.slice(0, 8)}-v1`,
      name: 'Test',
      description: 'A test avatar.',
      creator: 'Test Creator',
      projectId: 'test-project',
      projectName: 'Test Project',
      sourceUrl: 'https://example.com/source',
      licenseId: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: 'Test · CC0-1.0',
      modelSha256: hash,
      vrmVersion: '0.x',
      performanceClass: 'light',
      admissionStatus: 'admitted',
      availability: 'free',
    },
    registryCommit: '0123456789012345678901234567890123456789',
    sourceRecordSha256: 'a'.repeat(64),
    modelUrl: 'https://arweave.net/test-model',
    thumbnailUrl: 'https://arweave.net/test-thumbnail',
    thumbnailSha256: hash,
    thumbnailBytes: bytes.byteLength,
    modelBytes: bytes.byteLength,
    sourceUpdatedAt: '2026-08-24T00:00:00.000Z',
  };
}

describe('content-addressed avatar cache', () => {
  it('downloads once, writes provenance, and restores offline from verified bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'desky-avatar-cache-'));
    temporaryDirectories.push(directory);
    const bytes = minimalVrm();
    const admitted = revision(bytes);
    const fetcher = vi.fn(async () => new Response(responseBody(bytes), { status: 200 }));
    const cache = new AvatarCache(directory, fetcher);

    expect(new Uint8Array(await cache.get(admitted))).toEqual(bytes);
    expect(new Uint8Array(await cache.get(admitted))).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledTimes(1);

    const sidecar = JSON.parse(await readFile(
      join(directory, 'records', `${admitted.avatar.revisionId}.json`),
      'utf8',
    )) as Record<string, unknown>;
    expect(sidecar).toMatchObject({
      registryCommit: admitted.registryCommit,
      sourceRecordSha256: admitted.sourceRecordSha256,
      bytes: admitted.modelBytes,
    });
  });

  it('repairs a corrupt cached object from the exact admitted source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'desky-avatar-cache-'));
    temporaryDirectories.push(directory);
    const bytes = minimalVrm();
    const admitted = revision(bytes);
    const fetcher = vi.fn(async () => new Response(responseBody(bytes), { status: 200 }));
    const cache = new AvatarCache(directory, fetcher);
    await cache.get(admitted);
    await writeFile(
      join(directory, 'objects', `${admitted.avatar.modelSha256}.vrm`),
      new Uint8Array(admitted.modelBytes),
    );

    expect(new Uint8Array(await cache.get(admitted))).toEqual(bytes);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects a download whose checksum differs from the admission record', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'desky-avatar-cache-'));
    temporaryDirectories.push(directory);
    const bytes = minimalVrm();
    const admitted = revision(bytes);
    const corrupt = bytes.slice();
    corrupt[corrupt.length - 1] ^= 1;
    const cache = new AvatarCache(
      directory,
      async () => new Response(responseBody(corrupt), { status: 200 }),
    );

    await expect(cache.get(admitted)).rejects.toThrow('checksum');
  });

  it('caches only the exact admitted PNG thumbnail bytes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'desky-avatar-cache-'));
    temporaryDirectories.push(directory);
    const admitted = revision(minimalVrm());
    const thumbnail = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    admitted.thumbnailBytes = thumbnail.byteLength;
    admitted.thumbnailSha256 = createHash('sha256').update(thumbnail).digest('hex');
    const fetcher = vi.fn(async () => new Response(responseBody(thumbnail), { status: 200 }));
    const cache = new AvatarCache(directory, fetcher);

    expect(new Uint8Array(await cache.getThumbnail(admitted))).toEqual(thumbnail);
    expect(new Uint8Array(await cache.getThumbnail(admitted))).toEqual(thumbnail);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
