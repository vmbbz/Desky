import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import {
  AnimationClip,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';

import {
  parseCanonicalAnimationClip,
  type CanonicalAnimationClip,
} from '../../shared/canonical-animation';
import type { HipsTranslationPolicy } from './motion-arbiter';

export function createVrmAnimationClip(
  canonical: CanonicalAnimationClip,
  vrm: VRM,
  options: { hipsTranslation?: HipsTranslationPolicy } = {},
): AnimationClip {
  const parsed = parseCanonicalAnimationClip(canonical);
  const hipsHeight = vrm.humanoid.normalizedRestPose[VRMHumanBoneName.Hips]?.position?.[1];
  if (!Number.isFinite(hipsHeight) || Number(hipsHeight) <= 0) {
    throw new Error('Target VRM normalized hips height is missing or invalid');
  }

  const tracks = parsed.tracks.flatMap((track) => {
    if (track.bone === VRMHumanBoneName.Hips && track.property === 'position'
      && options.hipsTranslation === 'preserve-target') return [];
    const node = vrm.humanoid.getNormalizedBoneNode(track.bone);
    if (!node) return [];
    if (track.property === 'quaternion') {
      const values = track.values.map((value, index) =>
        vrm.meta.metaVersion === '0' && index % 2 === 0 ? -value : value,
      );
      return [new QuaternionKeyframeTrack(
        `${node.name}.quaternion`,
        track.times,
        values,
      )];
    }

    const values = track.values.map((value, index) => {
      const scaled = value * Number(hipsHeight);
      return vrm.meta.metaVersion === '0' && index % 3 !== 1 ? -scaled : scaled;
    });
    return [new VectorKeyframeTrack(`${node.name}.position`, track.times, values)];
  });
  if (tracks.length === 0) throw new Error('Animation has no tracks supported by the target VRM');
  return new AnimationClip(parsed.clipId, parsed.durationSeconds, tracks);
}
