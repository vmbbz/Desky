import type { CompanionMode } from './adapter-events';
import { companionModes } from './adapter-events';

export const animationProfileProgramKinds = ['ambient', 'action'] as const;
export type AnimationProfileProgramKind = (typeof animationProfileProgramKinds)[number];

export interface AvatarAnimationProfileProgram {
  programId: string;
  kind: AnimationProfileProgramKind;
  intensity: 1 | 2 | 3;
}

export interface AvatarAnimationProfile {
  schemaVersion: 1;
  profileId: string;
  libraryId: string;
  requiredBones: string[];
  stateModes: CompanionMode[];
  programs: AvatarAnimationProfileProgram[];
  rootMotion: 'forbidden';
  review: {
    status: 'approved';
    reviewer: string;
    reviewedAt: string;
  };
}

const idPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const bonePattern = /^[a-z][a-zA-Z0-9]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`Invalid avatar animation profile ${field}`);
  }
  return value;
}

function readId(value: unknown, field: string): string {
  const id = readString(value, field, 80);
  if (!idPattern.test(id)) throw new Error(`Invalid avatar animation profile ${field}`);
  return id;
}

function readTimestamp(value: unknown, field: string): string {
  const timestamp = readString(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`Invalid avatar animation profile ${field}`);
  }
  return timestamp;
}

export function parseAvatarAnimationProfile(value: unknown): AvatarAnimationProfile {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.rootMotion !== 'forbidden') {
    throw new Error('Unsupported avatar animation profile');
  }
  if (!Array.isArray(value.requiredBones) || value.requiredBones.length === 0
    || value.requiredBones.length > 64) {
    throw new Error('Invalid avatar animation profile required bones');
  }
  const requiredBones = value.requiredBones.map((bone) => readString(bone, 'required bone', 64));
  if (requiredBones.some((bone) => !bonePattern.test(bone))
    || new Set(requiredBones).size !== requiredBones.length) {
    throw new Error('Invalid avatar animation profile required bones');
  }
  if (!Array.isArray(value.stateModes) || value.stateModes.length > companionModes.length) {
    throw new Error('Invalid avatar animation profile state modes');
  }
  const stateModes = value.stateModes.map((mode) => {
    if (typeof mode !== 'string' || !companionModes.includes(mode as CompanionMode)) {
      throw new Error('Invalid avatar animation profile state mode');
    }
    return mode as CompanionMode;
  });
  if (new Set(stateModes).size !== stateModes.length) {
    throw new Error('Invalid avatar animation profile state modes');
  }
  if (!Array.isArray(value.programs) || value.programs.length === 0 || value.programs.length > 500) {
    throw new Error('Invalid avatar animation profile programs');
  }
  const programs = value.programs.map((program) => {
    if (!isRecord(program)
      || !animationProfileProgramKinds.includes(program.kind as AnimationProfileProgramKind)
      || !Number.isSafeInteger(program.intensity)
      || Number(program.intensity) < 1
      || Number(program.intensity) > 3) {
      throw new Error('Invalid avatar animation profile program');
    }
    return {
      programId: readId(program.programId, 'program ID'),
      kind: program.kind as AnimationProfileProgramKind,
      intensity: Number(program.intensity) as 1 | 2 | 3,
    };
  });
  if (new Set(programs.map((program) => program.programId)).size !== programs.length) {
    throw new Error('Avatar animation profile program IDs must be unique');
  }
  if (!isRecord(value.review)
    || value.review.status !== 'approved') {
    throw new Error('Avatar animation profile review is not approved');
  }
  return {
    schemaVersion: 1,
    profileId: readId(value.profileId, 'profile ID'),
    libraryId: readId(value.libraryId, 'library ID'),
    requiredBones,
    stateModes,
    programs,
    rootMotion: 'forbidden',
    review: {
      status: 'approved',
      reviewer: readString(value.review.reviewer, 'reviewer'),
      reviewedAt: readTimestamp(value.review.reviewedAt, 'review timestamp'),
    },
  };
}

export function assertAnimationProfileBones(
  profile: AvatarAnimationProfile,
  availableBones: readonly string[],
): void {
  const available = new Set(availableBones);
  const missing = profile.requiredBones.filter((bone) => !available.has(bone));
  if (missing.length > 0) {
    throw new Error(`Avatar is incompatible with motion profile ${profile.profileId}: missing ${missing.join(', ')}`);
  }
}
