import {
  VRMHumanBoneName,
  type VRMHumanBoneName as VRMHumanBoneNameType,
} from '@pixiv/three-vrm';
import { Quaternion } from 'three';

import {
  parseCanonicalAnimationClip,
  type CanonicalAnimationClip,
  type CanonicalAnimationTrack,
} from '../../shared/canonical-animation';
import type { MixamoAnimationSource, MixamoSourceTrack } from './mixamo-source';

export interface ConvertMixamoOptions {
  clipId: string;
  sampleRate: number;
  includeRootMotion: boolean;
}

const precision = 10_000_000;
const timePrecision = 100_000;
const boneOrder = new Map(
  (Object.values(VRMHumanBoneName) as VRMHumanBoneNameType[])
    .map((boneName, index) => [boneName, index]),
);

function quantize(value: number): number {
  const result = Math.round(value * precision) / precision;
  return Object.is(result, -0) ? 0 : result;
}

function quantizeTime(value: number): number {
  const result = Math.round(value * timePrecision) / timePrecision;
  return Object.is(result, -0) ? 0 : result;
}

function createSampleTimes(durationSeconds: number, sampleRate: number): number[] {
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 120) {
    throw new Error('Animation sample rate must be an integer from 1 to 120');
  }
  const times: number[] = [];
  const wholeSamples = Math.floor(durationSeconds * sampleRate + 1e-9);
  for (let index = 0; index <= wholeSamples; index += 1) {
    times.push(quantizeTime(index / sampleRate));
  }
  const duration = quantizeTime(durationSeconds);
  if (times.at(-1) !== duration) times.push(duration);
  return times;
}

function findInterval(times: number[], time: number): [number, number, number] {
  if (time <= times[0]) return [0, 0, 0];
  const last = times.length - 1;
  if (time >= times[last]) return [last, last, 0];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (times[middle] <= time) low = middle;
    else high = middle;
  }
  return [low, high, (time - times[low]) / (times[high] - times[low])];
}

function validateSourceTrack(track: MixamoSourceTrack, durationSeconds: number): void {
  const tupleSize = track.property === 'quaternion' ? 4 : 3;
  if (
    track.times.length === 0 ||
    track.values.length !== track.times.length * tupleSize ||
    track.times.some((value, index) =>
      !Number.isFinite(value) ||
      value < 0 ||
      value > durationSeconds ||
      (index > 0 && value <= track.times[index - 1])) ||
    track.values.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`Invalid Mixamo source track ${track.bone}.${track.property}`);
  }
  if (track.property === 'quaternion') {
    for (let index = 0; index < track.values.length; index += 4) {
      if (Math.hypot(...track.values.slice(index, index + 4)) < 1e-6) {
        throw new Error(`Invalid zero quaternion in Mixamo source track ${track.bone}`);
      }
    }
  }
}

function sampleQuaternion(track: MixamoSourceTrack, time: number): Quaternion {
  const [left, right, alpha] = findInterval(track.times, time);
  const leftQuaternion = new Quaternion().fromArray(track.values, left * 4).normalize();
  if (left === right) return leftQuaternion;
  const rightQuaternion = new Quaternion().fromArray(track.values, right * 4).normalize();
  return leftQuaternion.slerp(rightQuaternion, alpha).normalize();
}

function samplePosition(track: MixamoSourceTrack, time: number): [number, number, number] {
  const [left, right, alpha] = findInterval(track.times, time);
  const leftIndex = left * 3;
  const rightIndex = right * 3;
  return [0, 1, 2].map((axis) =>
    track.values[leftIndex + axis] +
    (track.values[rightIndex + axis] - track.values[leftIndex + axis]) * alpha,
  ) as [number, number, number];
}

function convertQuaternionTrack(
  track: MixamoSourceTrack,
  times: number[],
): CanonicalAnimationTrack {
  const parentRest = new Quaternion().fromArray(track.parentRestWorldRotation).normalize();
  const inverseBoneRest = new Quaternion()
    .fromArray(track.boneRestWorldRotation)
    .normalize()
    .invert();
  const values: number[] = [];
  let previous: Quaternion | undefined;
  for (const time of times) {
    const value = sampleQuaternion(track, time)
      .premultiply(parentRest)
      .multiply(inverseBoneRest)
      .normalize();
    if (previous && previous.dot(value) < 0) {
      value.set(-value.x, -value.y, -value.z, -value.w);
    }
    values.push(...value.toArray().map(quantize));
    previous = value;
  }
  return { bone: track.bone, property: 'quaternion', times, values };
}

function convertHipsTrack(
  track: MixamoSourceTrack,
  times: number[],
  sourceHipsHeight: number,
  includeRootMotion: boolean,
): CanonicalAnimationTrack {
  const values = times.flatMap((time) => {
    const [x, y, z] = samplePosition(track, time);
    return [
      includeRootMotion ? quantize(x / sourceHipsHeight) : 0,
      quantize(y / sourceHipsHeight),
      includeRootMotion ? quantize(z / sourceHipsHeight) : 0,
    ];
  });
  return {
    bone: VRMHumanBoneName.Hips,
    property: 'position',
    times,
    values,
  };
}

export function convertMixamoAnimation(
  source: MixamoAnimationSource,
  options: ConvertMixamoOptions,
): CanonicalAnimationClip {
  if (
    !Number.isFinite(source.durationSeconds) ||
    source.durationSeconds <= 0 ||
    source.durationSeconds > 120
  ) {
    throw new Error('Mixamo animation duration is outside the 120-second limit');
  }
  if (!Number.isFinite(source.sourceHipsHeight) || source.sourceHipsHeight <= 0) {
    throw new Error('Mixamo source hips height must be positive');
  }
  source.tracks.forEach((track) => validateSourceTrack(track, source.durationSeconds));

  const times = createSampleTimes(source.durationSeconds, options.sampleRate);
  const tracks = source.tracks.map((track) =>
    track.property === 'quaternion'
      ? convertQuaternionTrack(track, times)
      : convertHipsTrack(
          track,
          times,
          source.sourceHipsHeight,
          options.includeRootMotion,
        ),
  );
  tracks.sort((left, right) =>
    (boneOrder.get(left.bone) ?? Number.MAX_SAFE_INTEGER) -
      (boneOrder.get(right.bone) ?? Number.MAX_SAFE_INTEGER) ||
    left.property.localeCompare(right.property),
  );

  return parseCanonicalAnimationClip({
    schemaVersion: 1,
    clipId: options.clipId,
    durationSeconds: quantizeTime(source.durationSeconds),
    sampleRate: options.sampleRate,
    coordinateSpace: 'vrm1-normalized-humanoid',
    hipsTranslation: 'source-hips-height-normalized',
    tracks,
  });
}
