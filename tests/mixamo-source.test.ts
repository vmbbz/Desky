import { VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  AnimationClip,
  Bone,
  Group,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';

import {
  extractMixamoAnimationSource,
} from '../src/tools/animation/mixamo-source';
import {
  normalizeMixamoNodeName,
  resolveMixamoBone,
} from '../src/tools/animation/mixamo-rig';

function syntheticAsset(): Group {
  const asset = new Group();
  const skeletonRoot = new Bone();
  skeletonRoot.name = 'Armature';
  const hips = new Bone();
  hips.name = 'mixamorig:Hips';
  hips.position.y = 100;
  const head = new Bone();
  head.name = 'mixamorig:Head';
  head.position.y = 60;
  asset.add(skeletonRoot);
  skeletonRoot.add(hips);
  hips.add(head);
  asset.animations = [new AnimationClip('mixamo.com', 1, [
    new VectorKeyframeTrack('mixamorig:Hips.position', [0, 1], [0, 100, 0, 0, 105, 0]),
    new QuaternionKeyframeTrack(
      'mixamorig:Head.quaternion',
      [0, 1],
      [0, 0, 0, 1, ...new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2).toArray()],
    ),
  ])];
  return asset;
}

describe('Mixamo FBX extraction', () => {
  it('normalizes common namespaces and maps the official humanoid names', () => {
    expect(normalizeMixamoNodeName('Armature|mixamorig:LeftForeArm')).toBe(
      'mixamorigleftforearm',
    );
    expect(resolveMixamoBone('Armature|mixamorig:LeftForeArm')).toBe(
      VRMHumanBoneName.LeftLowerArm,
    );
  });

  it('extracts source rest transforms and tracks without a target avatar', () => {
    const source = extractMixamoAnimationSource(syntheticAsset());

    expect(source).toMatchObject({
      durationSeconds: 1,
      sourceHipsHeight: 100,
      ignoredTrackCount: 0,
    });
    expect(source.tracks.map((track) => `${track.bone}.${track.property}`)).toEqual([
      'hips.position',
      'head.quaternion',
    ]);
    expect(source.tracks[1].parentRestWorldRotation).toHaveLength(4);
    expect(source.tracks[1].boneRestWorldRotation).toHaveLength(4);
  });

  it('fails closed when the source hips height is unusable', () => {
    const asset = syntheticAsset();
    const hips = asset.getObjectByName('mixamorig:Hips');
    if (hips) hips.position.y = 0;
    expect(() => extractMixamoAnimationSource(asset)).toThrow(
      'FBX Mixamo hips height is missing or zero',
    );
  });
});
