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
  resolveSourceBone,
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
      sourceClipName: 'mixamo.com',
      sourceRigProfile: 'mixamo',
    });
    expect(source.tracks.map((track) => `${track.bone}.${track.property}`)).toEqual([
      'hips.position',
      'head.quaternion',
    ]);
    expect(source.tracks[1].parentRestWorldRotation).toHaveLength(4);
    expect(source.tracks[1].boneRestWorldRotation).toHaveLength(4);
  });

  it('selects one named clip and converts a Z-up universal-rig hips track to Y-up', () => {
    const asset = new Group();
    asset.rotation.x = -Math.PI / 2;
    const root = new Bone();
    root.name = 'root';
    const hips = new Bone();
    hips.name = 'pelvis';
    hips.position.z = 1;
    const head = new Bone();
    head.name = 'Head';
    head.position.z = 0.6;
    asset.add(root);
    root.add(hips);
    hips.add(head);
    asset.animations = [
      new AnimationClip('Armature|Idle_Loop', 1, [
        new VectorKeyframeTrack('pelvis.position', [0, 1], [0, 0, 1, 0, 0, 1.1]),
        new QuaternionKeyframeTrack('Head.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      ]),
      new AnimationClip('Armature|Jump_Start', 1, [
        new VectorKeyframeTrack('pelvis.position', [0, 1], [0, 0, 1, 0, 0, 1.4]),
      ]),
    ];

    const source = extractMixamoAnimationSource(asset, {
      sourceClip: 'Armature|Jump_Start',
      sourceRigProfile: 'quaternius-uam-v1',
    });

    expect(resolveSourceBone('spine_03', 'quaternius-uam-v1')).toBe(
      VRMHumanBoneName.UpperChest,
    );
    expect(source.sourceClipName).toBe('Armature|Jump_Start');
    expect(source.sourceHipsHeight).toBeCloseTo(1, 6);
    expect(source.tracks[0].values[0]).toBeCloseTo(0, 8);
    expect(source.tracks[0].values[1]).toBeCloseTo(1, 8);
    expect(source.tracks[0].values[2]).toBeCloseTo(0, 8);
    expect(source.tracks[0].values[3]).toBeCloseTo(0, 8);
    expect(source.tracks[0].values[4]).toBeCloseTo(1.4, 6);
    expect(source.tracks[0].values[5]).toBeCloseTo(0, 8);
  });

  it('fails closed when a requested clip is absent', () => {
    expect(() => extractMixamoAnimationSource(syntheticAsset(), {
      sourceClip: 'Armature|Missing',
    })).toThrow(/requested animation clip/i);
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
