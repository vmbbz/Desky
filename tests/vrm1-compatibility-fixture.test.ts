import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  admitVrm1CompatibilityFixture,
  readScopedVrm1CompatibilityFile,
  vrm1CompatibilityRevision,
} from '../src/main/vrm1-compatibility-fixture';

function input() {
  const testRoot = resolve(tmpdir(), 'desky-vrm1-ui-1234');
  return {
    exercise: 'vrm1-compatibility',
    capturePath: join(testRoot, 'capture.png'),
    userDataPath: join(testRoot, 'profile'),
    avatarPath: join(testRoot, 'Seed-san.vrm'),
    temporaryRoot: tmpdir(),
  };
}

describe('packaged VRM 1.0 compatibility fixture admission', () => {
  it.each(['vrm1-compatibility', 'vrm1-jump', 'vrm1-state-cycle'])(
    'admits a scoped path for %s',
    (exercise) => {
      const candidate = { ...input(), exercise };
      expect(readScopedVrm1CompatibilityFile(candidate)).toBe(candidate.avatarPath);
    },
  );

  it('does not activate without an exact compatibility exercise', () => {
    expect(readScopedVrm1CompatibilityFile({ ...input(), exercise: 'jump' })).toBeUndefined();
  });

  it.each([
    ['ordinary root', { userDataPath: join(tmpdir(), 'ordinary', 'profile') }],
    ['capture traversal', { capturePath: resolve(tmpdir(), '..', 'outside.png') }],
    ['avatar traversal', { avatarPath: resolve(tmpdir(), '..', 'outside.vrm') }],
    ['wrong extension', { avatarPath: join(resolve(tmpdir(), 'desky-vrm1-ui-1234'), 'fixture.glb') }],
  ])('rejects %s', (_label, override) => {
    expect(() => readScopedVrm1CompatibilityFile({ ...input(), ...override }))
      .toThrow('Invalid packaged VRM 1.0 compatibility fixture path.');
  });

  it('pins a complete external revision without adding it to the marketplace', () => {
    expect(vrm1CompatibilityRevision).toMatchObject({
      registryCommit: '821c11b250d8c70d5804ee13431e42bee56ea9c0',
      modelBytes: 10_917_800,
      avatar: {
        name: 'Seed-san',
        vrmVersion: '1.0',
        licenseId: 'VRM-Public-License-1.0',
        admissionStatus: 'candidate',
        availability: 'unavailable',
      },
    });
  });

  it('rejects bytes that do not match the pinned external fixture', () => {
    expect(() => admitVrm1CompatibilityFixture(new Uint8Array([0x67, 0x6c, 0x54, 0x46])))
      .toThrow('does not match its pinned identity');
  });
});
