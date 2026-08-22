import {
  VRMHumanBoneName,
  type VRMHumanBoneName as VRMHumanBoneNameType,
} from '@pixiv/three-vrm';

export interface CanonicalQuaternionTrack {
  bone: VRMHumanBoneNameType;
  property: 'quaternion';
  times: number[];
  values: number[];
}

export interface CanonicalPositionTrack {
  bone: typeof VRMHumanBoneName.Hips;
  property: 'position';
  times: number[];
  values: number[];
}

export type CanonicalAnimationTrack =
  | CanonicalQuaternionTrack
  | CanonicalPositionTrack;

export interface CanonicalAnimationClip {
  schemaVersion: 1;
  clipId: string;
  durationSeconds: number;
  sampleRate: number;
  coordinateSpace: 'vrm1-normalized-humanoid';
  hipsTranslation: 'source-hips-height-normalized';
  tracks: CanonicalAnimationTrack[];
}

const clipIdPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const maximumClipDurationSeconds = 120;
const humanBoneNames = Object.values(VRMHumanBoneName) as VRMHumanBoneNameType[];
const humanBoneSet = new Set<string>(humanBoneNames);
const humanBoneOrder = new Map(humanBoneNames.map((boneName, index) => [boneName, index]));
const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readFiniteNumbers(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new Error(`Invalid canonical animation ${field}`);
  }
  return value.map(Number);
}

function parseTrack(
  value: unknown,
  durationSeconds: number,
): CanonicalAnimationTrack {
  if (!isRecord(value) || typeof value.bone !== 'string' || !humanBoneSet.has(value.bone)) {
    throw new Error('Invalid canonical animation track bone');
  }
  if (value.property !== 'quaternion' && value.property !== 'position') {
    throw new Error('Invalid canonical animation track property');
  }
  if (value.property === 'position' && value.bone !== VRMHumanBoneName.Hips) {
    throw new Error('Canonical position tracks are restricted to hips');
  }

  const times = readFiniteNumbers(value.times, 'track times');
  const values = readFiniteNumbers(value.values, 'track values');
  if (times.length === 0) throw new Error('Canonical animation tracks cannot be empty');
  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    if (time < 0 || time > durationSeconds || (index > 0 && time <= times[index - 1])) {
      throw new Error('Canonical animation track times must be ordered and in range');
    }
  }

  const tupleSize = value.property === 'quaternion' ? 4 : 3;
  if (values.length !== times.length * tupleSize) {
    throw new Error('Canonical animation track value count does not match its times');
  }
  if (value.property === 'quaternion') {
    for (let index = 0; index < values.length; index += 4) {
      const norm = Math.hypot(
        values[index],
        values[index + 1],
        values[index + 2],
        values[index + 3],
      );
      if (norm < 0.999 || norm > 1.001) {
        throw new Error('Canonical animation quaternions must be normalized');
      }
    }
  }

  if (value.property === 'position') {
    return {
      bone: VRMHumanBoneName.Hips,
      property: 'position',
      times,
      values,
    };
  }
  return {
    bone: value.bone as VRMHumanBoneNameType,
    property: 'quaternion',
    times,
    values,
  };
}

export function parseCanonicalAnimationClip(value: unknown): CanonicalAnimationClip {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Unsupported canonical animation schema');
  }
  if (typeof value.clipId !== 'string' || !clipIdPattern.test(value.clipId)) {
    throw new Error('Invalid canonical animation clipId');
  }
  if (
    typeof value.durationSeconds !== 'number' ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds <= 0 ||
    value.durationSeconds > maximumClipDurationSeconds
  ) {
    throw new Error('Invalid canonical animation duration');
  }
  if (
    !Number.isInteger(value.sampleRate) ||
    Number(value.sampleRate) < 1 ||
    Number(value.sampleRate) > 120
  ) {
    throw new Error('Invalid canonical animation sample rate');
  }
  if (
    value.coordinateSpace !== 'vrm1-normalized-humanoid' ||
    value.hipsTranslation !== 'source-hips-height-normalized'
  ) {
    throw new Error('Unsupported canonical animation coordinate contract');
  }
  if (!Array.isArray(value.tracks) || value.tracks.length === 0 || value.tracks.length > 64) {
    throw new Error('Invalid canonical animation tracks');
  }

  const tracks = value.tracks.map((track) => parseTrack(track, value.durationSeconds as number));
  const identities = new Set<string>();
  for (const track of tracks) {
    const identity = `${track.bone}.${track.property}`;
    if (identities.has(identity)) throw new Error(`Duplicate canonical animation track ${identity}`);
    identities.add(identity);
  }
  tracks.sort((left, right) =>
    (humanBoneOrder.get(left.bone) ?? Number.MAX_SAFE_INTEGER) -
      (humanBoneOrder.get(right.bone) ?? Number.MAX_SAFE_INTEGER) ||
    left.property.localeCompare(right.property),
  );

  return {
    schemaVersion: 1,
    clipId: value.clipId,
    durationSeconds: value.durationSeconds,
    sampleRate: Number(value.sampleRate),
    coordinateSpace: 'vrm1-normalized-humanoid',
    hipsTranslation: 'source-hips-height-normalized',
    tracks,
  };
}

export function serializeCanonicalAnimationClip(clip: CanonicalAnimationClip): Uint8Array {
  const parsed = parseCanonicalAnimationClip(clip);
  return textEncoder.encode(`${JSON.stringify(parsed)}\n`);
}
