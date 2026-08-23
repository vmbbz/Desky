import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { describe, expect, it } from 'vitest';

import { serializeCanonicalAnimationClip } from '../src/shared/canonical-animation';
import { convertMixamoAnimation } from '../src/tools/animation/convert-mixamo';
import type { MixamoAnimationSource } from '../src/tools/animation/mixamo-source';

const halfSqrt = Math.SQRT1_2;

function sourceFixture(): MixamoAnimationSource {
  return {
    sourceClipName: 'mixamo.com',
    sourceRigProfile: 'mixamo',
    durationSeconds: 1,
    sourceHipsHeight: 2,
    ignoredTrackCount: 0,
    tracks: [
      {
        bone: VRMHumanBoneName.Hips,
        property: 'position',
        times: [0, 1],
        values: [0, 2, 0, 2, 4, -2],
        parentRestWorldRotation: [0, 0, 0, 1],
        boneRestWorldRotation: [0, 0, 0, 1],
      },
      {
        bone: VRMHumanBoneName.Head,
        property: 'quaternion',
        times: [0, 1],
        values: [0, 0, 0, 1, halfSqrt, 0, 0, halfSqrt],
        parentRestWorldRotation: [0, 0, halfSqrt, halfSqrt],
        boneRestWorldRotation: [0, 0, halfSqrt, halfSqrt],
      },
    ],
  };
}

describe('Mixamo canonical converter', () => {
  it('resamples, applies rest-world rotation, and strips horizontal root motion', () => {
    const clip = convertMixamoAnimation(sourceFixture(), {
      clipId: 'test-action-v1',
      sampleRate: 2,
      includeRootMotion: false,
    });

    const hips = clip.tracks.find((track) => track.property === 'position');
    const head = clip.tracks.find((track) => track.bone === VRMHumanBoneName.Head);
    expect(hips).toEqual({
      bone: 'hips',
      property: 'position',
      times: [0, 0.5, 1],
      values: [0, 1, 0, 0, 1.5, 0, 0, 2, 0],
    });
    expect(head?.times).toEqual([0, 0.5, 1]);
    expect(head?.values.slice(-4)).toEqual([0, 0.7071068, 0, 0.7071068]);
  });

  it('preserves dimensionless horizontal hips motion only when requested', () => {
    const clip = convertMixamoAnimation(sourceFixture(), {
      clipId: 'test-root-motion-v1',
      sampleRate: 1,
      includeRootMotion: true,
    });
    const hips = clip.tracks.find((track) => track.property === 'position');
    expect(hips?.values).toEqual([0, 1, 0, 1, 2, -1]);
  });

  it('emits byte-identical canonical output from identical inputs', () => {
    const options = {
      clipId: 'test-determinism-v1',
      sampleRate: 30,
      includeRootMotion: false,
    };
    const first = serializeCanonicalAnimationClip(
      convertMixamoAnimation(sourceFixture(), options),
    );
    const second = serializeCanonicalAnimationClip(
      convertMixamoAnimation(sourceFixture(), options),
    );
    expect(first).toEqual(second);
  });

  it('rejects source keys outside the declared clip duration', () => {
    const source = sourceFixture();
    source.tracks[0].times = [0, 2];
    expect(() => convertMixamoAnimation(source, {
      clipId: 'invalid-v1',
      sampleRate: 30,
      includeRootMotion: false,
    })).toThrow('Invalid Mixamo source track hips.position');
  });
});
