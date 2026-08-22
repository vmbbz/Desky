import { describe, expect, it } from 'vitest';

import {
  createAssetProvenance,
  parseAssetProvenance,
  sha256Hex,
} from '../src/shared/asset-provenance';

const abcBytes = new Uint8Array([0x61, 0x62, 0x63]).buffer;

describe('asset provenance', () => {
  it('hashes the exact downloaded bytes and emits a validated sidecar', async () => {
    const record = await createAssetProvenance({
      assetId: 'avatar:collection/milk',
      kind: 'avatar',
      sourceUrl: 'https://example.com/milk.vrm',
      sourceProject: 'CC0 Avatars',
      creator: 'Example Artist',
      licenseId: 'CC0',
      bytes: abcBytes,
      fetchedAt: new Date('2026-08-22T12:00:00.000Z'),
    });

    expect(record).toMatchObject({
      schemaVersion: 1,
      assetId: 'avatar:collection/milk',
      kind: 'avatar',
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      fetchedAt: '2026-08-22T12:00:00.000Z',
    });
  });

  it('produces a stable SHA-256 digest', async () => {
    await expect(sha256Hex(abcBytes)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('rejects insecure source URLs and malformed checksums', () => {
    expect(() =>
      parseAssetProvenance({
        schemaVersion: 1,
        assetId: 'avatar:test',
        kind: 'avatar',
        sourceUrl: 'http://example.com/avatar.vrm',
        licenseId: 'CC0',
        sha256: 'not-a-checksum',
        fetchedAt: '2026-08-22T12:00:00.000Z',
      }),
    ).toThrow('Invalid asset provenance sourceUrl');
  });
});
