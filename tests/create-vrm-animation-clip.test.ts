import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { Group } from 'three';
import { describe, expect, it } from 'vitest';

import { createVrmAnimationClip } from '../src/renderer/avatar/create-vrm-animation-clip';
import type { CanonicalAnimationClip } from '../src/shared/canonical-animation';

function expectValuesClose(actual: ArrayLike<number> | undefined, expected: number[]): void {
  const values = Array.from(actual ?? []);
  expect(values).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(values[index]).toBeCloseTo(value, 6));
}

function canonicalFixture(): CanonicalAnimationClip {
  return {
    schemaVersion: 1,
    clipId: 'runtime-test-v1',
    durationSeconds: 1,
    sampleRate: 1,
    coordinateSpace: 'vrm1-normalized-humanoid',
    hipsTranslation: 'source-hips-height-normalized',
    tracks: [
      {
        bone: VRMHumanBoneName.Hips,
        property: 'position',
        times: [0, 1],
        values: [0.2, 1, -0.3, 0.4, 1.1, -0.5],
      },
      {
        bone: VRMHumanBoneName.Head,
        property: 'quaternion',
        times: [0, 1],
        values: [0.5, 0.5, 0.5, 0.5, 0, 0, 0, 1],
      },
    ],
  };
}

function vrmFixture(version: '0' | '1'): VRM {
  const hips = new Group();
  hips.name = 'normalizedHips';
  const head = new Group();
  head.name = 'normalizedHead';
  return {
    meta: { metaVersion: version },
    humanoid: {
      normalizedRestPose: { hips: { position: [0, 1.5, 0] } },
      getNormalizedBoneNode: (boneName: string) =>
        boneName === VRMHumanBoneName.Hips
          ? hips
          : boneName === VRMHumanBoneName.Head
            ? head
            : null,
    },
  } as VRM;
}

describe('canonical clip VRM binding', () => {
  it('scales hips translation for a VRM 1.0 target', () => {
    const clip = createVrmAnimationClip(canonicalFixture(), vrmFixture('1'));
    const hips = clip.tracks.find((track) => track.name === 'normalizedHips.position');
    expectValuesClose(hips?.values, [
      0.3, 1.5, -0.45, 0.6, 1.65, -0.75,
    ]);
  });

  it('applies the upstream VRM 0.x X/Z conversion at binding time', () => {
    const clip = createVrmAnimationClip(canonicalFixture(), vrmFixture('0'));
    const hips = clip.tracks.find((track) => track.name === 'normalizedHips.position');
    const head = clip.tracks.find((track) => track.name === 'normalizedHead.quaternion');
    expectValuesClose(hips?.values, [
      -0.3, 1.5, 0.45, -0.6, 1.65, 0.75,
    ]);
    expectValuesClose(head?.values, [
      -0.5, 0.5, -0.5, 0.5, 0, 0, 0, 1,
    ]);
  });
});
