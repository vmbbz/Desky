import type { VRMHumanBoneName as VRMHumanBoneNameType } from '@pixiv/three-vrm';
import {
  Quaternion,
  Vector3,
  type AnimationClip,
  type Group,
  type Object3D,
} from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

import {
  normalizeMixamoNodeName,
  resolveSourceBone,
  type SourceRigProfile,
} from './mixamo-rig';

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
  sourceClipName: string;
  sourceRigProfile: SourceRigProfile;
  durationSeconds: number;
  sourceHipsHeight: number;
  tracks: MixamoSourceTrack[];
  ignoredTrackCount: number;
}

export interface ParseHumanoidFbxOptions {
  sourceClip?: string;
  sourceRigProfile?: SourceRigProfile;
}

export interface SourceAnimationClipSummary {
  name: string;
  durationSeconds: number;
  trackCount: number;
}

function selectClip(animations: AnimationClip[], requestedName?: string): AnimationClip {
  if (requestedName) {
    const selected = animations.find((clip) => clip.name === requestedName);
    if (selected) return selected;
    throw new Error(`FBX does not contain requested animation clip ${requestedName}`);
  }
  const named = animations.find((clip) => clip.name === 'mixamo.com');
  if (named) return named;
  if (animations.length === 1) return animations[0];
  if (animations.length === 0) throw new Error('FBX contains no animation clips');
  throw new Error('FBX contains multiple clips and no mixamo.com clip');
}

function indexRigNodes(root: Group, sourceRigProfile: SourceRigProfile): Map<string, Object3D> {
  const candidates = new Map<string, Object3D[]>();
  root.traverse((node) => {
    const normalized = normalizeMixamoNodeName(node.name);
    if (!resolveSourceBone(node.name, sourceRigProfile)) return;
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

export function extractMixamoAnimationSource(
  asset: Group,
  options: ParseHumanoidFbxOptions = {},
): MixamoAnimationSource {
  const sourceRigProfile = options.sourceRigProfile ?? 'mixamo';
  asset.updateMatrixWorld(true);
  const nodes = indexRigNodes(asset, sourceRigProfile);
  const hips = [...nodes.values()].find(
    (node) => resolveSourceBone(node.name, sourceRigProfile) === 'hips',
  );
  const hipsWorldHeight = hips?.getWorldPosition(new Vector3()).y;
  if (!hips || !Number.isFinite(hipsWorldHeight) || Math.abs(hipsWorldHeight ?? 0) < 1e-6) {
    throw new Error('FBX Mixamo hips height is missing or zero');
  }

  const clip = selectClip(asset.animations, options.sourceClip);
  if (!Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 120) {
    throw new Error('FBX animation duration is outside the 120-second limit');
  }

  const tracks: MixamoSourceTrack[] = [];
  let ignoredTrackCount = 0;
  for (const track of clip.tracks) {
    const { nodeName, property } = splitTrackName(track.name);
    const bone = resolveSourceBone(nodeName, sourceRigProfile);
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
    let values = Array.from(track.values);
    if (property === 'position') {
      const converted: number[] = [];
      const sourcePosition = new Vector3();
      for (let index = 0; index < values.length; index += 3) {
        sourcePosition
          .set(values[index], values[index + 1], values[index + 2])
          .applyQuaternion(parentRestWorldRotation);
        converted.push(...sourcePosition.toArray());
      }
      values = converted;
    }
    tracks.push({
      bone,
      property: property as 'quaternion' | 'position',
      times: Array.from(track.times),
      values,
      parentRestWorldRotation: parentRestWorldRotation.toArray() as QuaternionTuple,
      boneRestWorldRotation: boneRestWorldRotation.toArray() as QuaternionTuple,
    });
  }
  if (tracks.length === 0) {
    const observed = clip.tracks.slice(0, 8).map((track) => track.name).join(', ');
    throw new Error(`FBX contains no supported Mixamo tracks${observed ? ` (observed: ${observed})` : ''}`);
  }

  return {
    sourceClipName: clip.name,
    sourceRigProfile,
    durationSeconds: clip.duration,
    sourceHipsHeight: Math.abs(hipsWorldHeight as number),
    tracks,
    ignoredTrackCount,
  };
}

export function listFbxAnimationClips(bytes: ArrayBuffer): SourceAnimationClipSummary[] {
  const asset = parseFbxAsset(bytes);
  return listFbxAssetAnimationClips(asset);
}

export function listFbxAssetAnimationClips(asset: Group): SourceAnimationClipSummary[] {
  return asset.animations.map((clip) => ({
    name: clip.name,
    durationSeconds: clip.duration,
    trackCount: clip.tracks.length,
  }));
}

export function parseFbxAsset(bytes: ArrayBuffer): Group {
  const loader = new FBXLoader();
  return loader.parse(bytes, '');
}

export function parseMixamoFbx(
  bytes: ArrayBuffer,
  options: ParseHumanoidFbxOptions = {},
): MixamoAnimationSource {
  const asset = parseFbxAsset(bytes);
  return extractMixamoAnimationSource(asset, options);
}
