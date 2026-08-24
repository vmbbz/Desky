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

function minimalVrm(marker = 'test'): Uint8Array {
  const source = JSON.stringify({ asset: { version: '2.0', generator: marker }, extensions: { VRM: {} } });
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

function revision(bytes: Uint8Array, avatarId = 'test-avatar'): AdmittedAvatarRevision {
  const hash = createHash('sha256').update(bytes).digest('hex');
  return {
    avatar: {
      avatarId,
      productId: `avatar.${avatarId}`,
      revisionId: `test-${avatarId}-${hash.slice(0, 8)}-v1`,
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
    modelUrl: `https://arweave.net/${avatarId}-model`,
    thumbnailUrl: `https://arweave.net/${avatarId}-thumbnail`,
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

  it('evicts the least-recently-used catalog revision without touching a protected revision', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'desky-avatar-cache-'));
    temporaryDirectories.push(directory);
    const protectedBytes = minimalVrm('protected');
    const removableBytes = minimalVrm('removable');
    const protectedRevision = revision(protectedBytes, 'protected-avatar');
    const removableRevision = revision(removableBytes, 'removable-avatar');
    const bodies = new Map([
      [protectedRevision.modelUrl, protectedBytes],
      [removableRevision.modelUrl, removableBytes],
    ]);
    const cache = new AvatarCache(directory, async (url) => {
      const body = bodies.get(String(url));
      if (!body) return new Response('Not found', { status: 404 });
      return new Response(responseBody(body), { status: 200 });
    });
    await cache.get(removableRevision);
    await cache.get(protectedRevision);

    const result = await cache.prune(
      [protectedRevision, removableRevision],
      new Set([protectedRevision.avatar.revisionId]),
      0,
    );

    expect(result.evictedRevisionIds).toEqual([removableRevision.avatar.revisionId]);
    await expect(readFile(join(
      directory,
      'objects',
      `${protectedRevision.avatar.modelSha256}.vrm`,
    ))).resolves.toBeTruthy();
    await expect(readFile(join(
      directory,
      'objects',
      `${removableRevision.avatar.modelSha256}.vrm`,
    ))).rejects.toThrow();
  });

  it('reports verified, corrupt, and missing model storage without downloading', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'desky-avatar-cache-'));
    temporaryDirectories.push(directory);
    const verifiedBytes = minimalVrm('verified');
    const corruptBytes = minimalVrm('corrupt');
    const missingBytes = minimalVrm('missing');
    const verified = revision(verifiedBytes, 'verified-avatar');
    const corrupt = revision(corruptBytes, 'corrupt-avatar');
    const missing = revision(missingBytes, 'missing-avatar');
    const bodies = new Map([
      [verified.modelUrl, verifiedBytes],
      [corrupt.modelUrl, corruptBytes],
    ]);
    const fetcher = vi.fn(async (url) => new Response(responseBody(bodies.get(String(url))!), {
      status: 200,
    }));
    const cache = new AvatarCache(directory, fetcher);
    await cache.get(verified);
    await cache.get(corrupt);
    await writeFile(
      join(directory, 'records', `${corrupt.avatar.revisionId}.json`),
      '{"schemaVersion":99}',
    );

    const inventory = await cache.inspect([verified, corrupt, missing]);

    expect(inventory.entries.map((entry) => [entry.avatarId, entry.modelStatus])).toEqual([
      ['verified-avatar', 'verified'],
      ['corrupt-avatar', 'corrupt'],
      ['missing-avatar', 'missing'],
    ]);
    expect(inventory.totalBytes).toBeGreaterThan(verified.modelBytes + corrupt.modelBytes);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('removes only an unprotected model and retains a shared content object', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'desky-avatar-cache-'));
    temporaryDirectories.push(directory);
    const bytes = minimalVrm('shared');
    const first = revision(bytes, 'first-avatar');
    const second = revision(bytes, 'second-avatar');
    const cache = new AvatarCache(
      directory,
      async () => new Response(responseBody(bytes), { status: 200 }),
    );
    await cache.get(first);
    await cache.get(second);

    await expect(cache.removeModel(
      first,
      [first, second],
      new Set([first.avatar.revisionId]),
    )).rejects.toThrow('cannot be removed');
    await cache.removeModel(first, [first, second], new Set());

    const inventory = await cache.inspect([first, second]);
    expect(inventory.entries.map((entry) => [entry.avatarId, entry.modelStatus])).toEqual([
      ['first-avatar', 'missing'],
      ['second-avatar', 'verified'],
    ]);
    await expect(readFile(join(
      directory,
      'objects',
      `${second.avatar.modelSha256}.vrm`,
    ))).resolves.toBeTruthy();
  });
});
