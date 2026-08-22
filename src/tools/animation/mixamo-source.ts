import type { VRMHumanBoneName as VRMHumanBoneNameType } from '@pixiv/three-vrm';
import {
  Quaternion,
  type AnimationClip,
  type Group,
  type Object3D,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

import { normalizeMixamoNodeName, resolveMixamoBone } from './mixamo-rig';

export type QuaternionTuple = [number, number, number, number];

export interface MixamoSourceTrack {
  bone: VRMHumanBoneNameType;
  property: 'quaternion' | 'position';
  times: number[];
  values: number[];
  parentRestWorldRotation: QuaternionTuple;
  boneRestWorldRotation: QuaternionTuple;
}

export interface MixamoAnimationSource {
  durationSeconds: number;
  sourceHipsHeight: number;
  tracks: MixamoSourceTrack[];
  ignoredTrackCount: number;
}

function selectClip(animations: AnimationClip[]): AnimationClip {
  const named = animations.find((clip) => clip.name === 'mixamo.com');
  if (named) return named;
  if (animations.length === 1) return animations[0];
  if (animations.length === 0) throw new Error('FBX contains no animation clips');
  throw new Error('FBX contains multiple clips and no mixamo.com clip');
}

function indexRigNodes(root: Group): Map<string, Object3D> {
  const candidates = new Map<string, Object3D[]>();
  root.traverse((node) => {
    const normalized = normalizeMixamoNodeName(node.name);
    if (!resolveMixamoBone(node.name)) return;
    const entries = candidates.get(normalized) ?? [];
    entries.push(node);
    candidates.set(normalized, entries);
  });
  const nodes = new Map<string, Object3D>();
  const duplicates = new Set<string>();
  for (const [name, entries] of candidates) {
    const bones = entries.filter((entry) => entry.type === 'Bone');
    const eligible = bones.length > 0 ? bones : entries;
    const selected = eligible[0];
    const hasConflictingRestTransform = eligible.slice(1).some((entry) =>
      entry.matrixWorld.elements.some(
        (value, index) => Math.abs(value - selected.matrixWorld.elements[index]) > 1e-5,
      ));
    if (hasConflictingRestTransform) duplicates.add(name);
    else nodes.set(name, selected);
  }
  if (duplicates.size > 0) {
    throw new Error(`FBX contains duplicate Mixamo rig nodes: ${[...duplicates].sort().join(', ')}`);
  }
  return nodes;
}

function splitTrackName(name: string): { nodeName: string; property: string } {
  const separator = name.lastIndexOf('.');
  if (separator <= 0 || separator === name.length - 1) {
    return { nodeName: '', property: '' };
  }
  return { nodeName: name.slice(0, separator), property: name.slice(separator + 1) };
}

export function extractMixamoAnimationSource(asset: Group): MixamoAnimationSource {
  asset.updateMatrixWorld(true);
  const nodes = indexRigNodes(asset);
  const hips = [...nodes.values()].find((node) => resolveMixamoBone(node.name) === 'hips');
  if (!hips || !Number.isFinite(hips.position.y) || Math.abs(hips.position.y) < 1e-6) {
    throw new Error('FBX Mixamo hips height is missing or zero');
  }

  const clip = selectClip(asset.animations);
  if (!Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 120) {
    throw new Error('FBX animation duration is outside the 120-second limit');
  }

  const tracks: MixamoSourceTrack[] = [];
  let ignoredTrackCount = 0;
  for (const track of clip.tracks) {
    const { nodeName, property } = splitTrackName(track.name);
    const bone = resolveMixamoBone(nodeName);
    const node = nodes.get(normalizeMixamoNodeName(nodeName));
    const tupleSize = property === 'quaternion' ? 4 : property === 'position' ? 3 : 0;
    const supportedTrack = tupleSize > 0 && track.values.length === track.times.length * tupleSize;
    if (!bone || !node || !supportedTrack) {
      ignoredTrackCount += 1;
      continue;
    }
    if (property === 'position' && bone !== 'hips') {
      ignoredTrackCount += 1;
      continue;
    }
    if (!node.parent) throw new Error(`FBX rig node ${node.name} has no parent`);

    const parentRestWorldRotation = node.parent.getWorldQuaternion(new Quaternion());
    const boneRestWorldRotation = node.getWorldQuaternion(new Quaternion());
    tracks.push({
      bone,
      property: property as 'quaternion' | 'position',
      times: Array.from(track.times),
      values: Array.from(track.values),
      parentRestWorldRotation: parentRestWorldRotation.toArray() as QuaternionTuple,
      boneRestWorldRotation: boneRestWorldRotation.toArray() as QuaternionTuple,
    });
  }
  if (tracks.length === 0) {
    const observed = clip.tracks.slice(0, 8).map((track) => track.name).join(', ');
    throw new Error(`FBX contains no supported Mixamo tracks${observed ? ` (observed: ${observed})` : ''}`);
  }

  return {
    durationSeconds: clip.duration,
    sourceHipsHeight: Math.abs(hips.position.y),
    tracks,
    ignoredTrackCount,
  };
}

export function parseMixamoFbx(bytes: ArrayBuffer): MixamoAnimationSource {
  const loader = new FBXLoader();
  const asset = loader.parse(bytes, '');
  return extractMixamoAnimationSource(asset);
}
