import { VRMHumanBoneName } from '@pixiv/three-vrm';
import { describe, expect, it } from 'vitest';

import {
  parseCanonicalAnimationClip,
  serializeCanonicalAnimationClip,
  type CanonicalAnimationClip,
} from '../src/shared/canonical-animation';

function validClip(): CanonicalAnimationClip {
  return {
    schemaVersion: 1 as const,
    clipId: 'test-wave-v1',
    durationSeconds: 1,
    sampleRate: 30,
    coordinateSpace: 'vrm1-normalized-humanoid' as const,
    hipsTranslation: 'source-hips-height-normalized' as const,
    tracks: [
      {
        bone: VRMHumanBoneName.Head,
        property: 'quaternion' as const,
        times: [0, 1],
        values: [0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068],
      },
    ],
  };
}

describe('canonical animation format', () => {
  it('round-trips to stable newline-terminated JSON bytes', () => {
    const parsed = parseCanonicalAnimationClip(validClip());
    const first = serializeCanonicalAnimationClip(parsed);
    const second = serializeCanonicalAnimationClip(parsed);

    expect(first).toEqual(second);
    expect(new TextDecoder().decode(first)).toMatch(/}\n$/);
  });

  it('rejects unnormalized quaternion payloads', () => {
    const clip = validClip();
    clip.tracks[0].values = [0, 0, 0, 2, 0, 0, 0, 2];
    expect(() => parseCanonicalAnimationClip(clip)).toThrow(
      'Canonical animation quaternions must be normalized',
    );
  });

  it('rejects duplicate bone/property bindings', () => {
    const clip = validClip();
    clip.tracks.push({ ...clip.tracks[0] });
    expect(() => parseCanonicalAnimationClip(clip)).toThrow(
      'Duplicate canonical animation track head.quaternion',
    );
  });

  it('serializes tracks in canonical humanoid order', () => {
    const clip = validClip();
    clip.tracks.unshift({
      bone: VRMHumanBoneName.RightHand,
      property: 'quaternion',
      times: [0, 1],
      values: [0, 0, 0, 1, 0, 0, 0, 1],
    });
    const parsed = parseCanonicalAnimationClip(clip);
    expect(parsed.tracks.map((track) => track.bone)).toEqual([
      VRMHumanBoneName.Head,
      VRMHumanBoneName.RightHand,
    ]);
  });
});
