import type { CompanionMode } from './adapter-events';
import { companionModes } from './adapter-events';
import {
  avatarActionKinds,
  type AvatarActionKind,
} from './agent-actions';
import type { AnimationAssetManifest } from './animation-manifest';
import type { CanonicalAnimationClip } from './canonical-animation';

export const animationProgramTriggerKinds = ['ambient', 'action', 'catalog'] as const;
export type AnimationProgramTriggerKind = (typeof animationProgramTriggerKinds)[number];

export interface AnimationLibraryClip {
  clipId: string;
  label: string;
  tags: string[];
  canonical: CanonicalAnimationClip;
  manifest: AnimationAssetManifest;
}

export interface AnimationProgramStep {
  clipId: string;
  repetitions: number;
  reverse: boolean;
  holdSeconds: number;
}

export type AnimationProgramTrigger =
  | {
      kind: 'ambient';
      modes: CompanionMode[];
      weight: number;
      minimumQuietSeconds: number;
      maximumQuietSeconds: number;
      cooldownSeconds: number;
    }
  | { kind: 'action'; action: AvatarActionKind; order: number }
  | { kind: 'catalog' };

export interface AnimationProgram {
  programId: string;
  label: string;
  tags: string[];
  trigger: AnimationProgramTrigger;
  fallbackCue?: string;
  steps: AnimationProgramStep[];
}

export interface AnimationStateBinding {
  mode: CompanionMode;
  clipId: string;
  order: number;
  crossFadeMs: number;
}

export interface AnimationLibrary {
  schemaVersion: 1;
  libraryId: string;
  label: string;
  creator: string;
  licenseId: 'CC0-1.0';
  sourceUrl: string;
  generatedAt: string;
  sourceArchives: Array<{
    sourceId: string;
    label: string;
    sourceUrl: string;
    archiveSha256: string;
    animationSourceSha256: string;
    clipCount: number;
  }>;
  clips: AnimationLibraryClip[];
  states: AnimationStateBinding[];
  programs: AnimationProgram[];
}

const idPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const tagPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string, maximumLength = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximumLength) {
    throw new Error(`Invalid animation library ${field}`);
  }
  return value;
}

function readId(value: unknown, field: string): string {
  const id = readString(value, field, 80);
  if (!idPattern.test(id)) throw new Error(`Invalid animation library ${field}`);
  return id;
}

function readNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  integer = false,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new Error(`Invalid animation library ${field}`);
  }
  return value;
}

function readTags(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    throw new Error(`Invalid animation library ${field}`);
  }
  const tags = value.map((tag) => readString(tag, field, 40));
  if (tags.some((tag) => !tagPattern.test(tag)) || new Set(tags).size !== tags.length) {
    throw new Error(`Invalid animation library ${field}`);
  }
  return tags;
}

function readTimestamp(value: unknown, field: string): string {
  const timestamp = readString(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)) {
    throw new Error(`Invalid animation library ${field}`);
  }
  return timestamp;
}

function readUrl(value: unknown, field: string): string {
  const url = readString(value, field, 1_024);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid animation library ${field}`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`Invalid animation library ${field}`);
  }
  return parsed.href;
}

function readMode(value: unknown, field: string): CompanionMode {
  if (typeof value !== 'string' || !companionModes.includes(value as CompanionMode)) {
    throw new Error(`Invalid animation library ${field}`);
  }
  return value as CompanionMode;
}

function parseTrigger(value: unknown): AnimationProgramTrigger {
  if (!isRecord(value) || !animationProgramTriggerKinds.includes(value.kind as AnimationProgramTriggerKind)) {
    throw new Error('Invalid animation library program trigger');
  }
  if (value.kind === 'catalog') return { kind: 'catalog' };
  if (value.kind === 'action') {
    if (!avatarActionKinds.includes(value.action as AvatarActionKind)) {
      throw new Error('Invalid animation library program action');
    }
    return {
      kind: 'action',
      action: value.action as AvatarActionKind,
      order: readNumber(value.order, 'program action order', 0, 10_000, true),
    };
  }
  if (!Array.isArray(value.modes) || value.modes.length === 0) {
    throw new Error('Invalid animation library ambient modes');
  }
  const modes = value.modes.map((mode) => readMode(mode, 'ambient mode'));
  if (new Set(modes).size !== modes.length) {
    throw new Error('Invalid animation library ambient modes');
  }
  const minimumQuietSeconds = readNumber(
    value.minimumQuietSeconds,
    'minimum quiet seconds',
    1,
    300,
  );
  const maximumQuietSeconds = readNumber(
    value.maximumQuietSeconds,
    'maximum quiet seconds',
    minimumQuietSeconds,
    600,
  );
  return {
    kind: 'ambient',
    modes,
    weight: readNumber(value.weight, 'ambient weight', 0.01, 1_000),
    minimumQuietSeconds,
    maximumQuietSeconds,
    cooldownSeconds: readNumber(value.cooldownSeconds, 'ambient cooldown', 0, 3_600),
  };
}

export function parseAnimationLibrary(value: unknown): AnimationLibrary {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Unsupported animation library schema');
  }
  if (value.licenseId !== 'CC0-1.0') {
    throw new Error('Built-in animation libraries must be CC0-1.0');
  }
  if (!Array.isArray(value.sourceArchives) || value.sourceArchives.length === 0) {
    throw new Error('Animation library source archives are required');
  }
  const sourceArchives = value.sourceArchives.map((source, index) => {
    if (!isRecord(source)) throw new Error('Invalid animation library source archive');
    const archiveSha256 = readString(source.archiveSha256, 'archive SHA-256', 64);
    const animationSourceSha256 = readString(source.animationSourceSha256, 'source SHA-256', 64);
    if (!sha256Pattern.test(archiveSha256) || !sha256Pattern.test(animationSourceSha256)) {
      throw new Error('Invalid animation library source archive hash');
    }
    return {
      sourceId: readId(source.sourceId, `sourceArchives[${index}].sourceId`),
      label: readString(source.label, `sourceArchives[${index}].label`),
      sourceUrl: readUrl(source.sourceUrl, `sourceArchives[${index}].sourceUrl`),
      archiveSha256,
      animationSourceSha256,
      clipCount: readNumber(source.clipCount, 'source clip count', 1, 10_000, true),
    };
  });
  if (new Set(sourceArchives.map((source) => source.sourceId)).size !== sourceArchives.length) {
    throw new Error('Animation library source IDs must be unique');
  }

  if (!Array.isArray(value.clips) || value.clips.length === 0 || value.clips.length > 1_000) {
    throw new Error('Invalid animation library clips');
  }
  const clips = value.clips.map((clip, index) => {
    if (!isRecord(clip)) throw new Error('Invalid animation library clip');
    const clipId = readId(clip.clipId, `clips[${index}].clipId`);
    if (!isRecord(clip.canonical) || clip.canonical.clipId !== clipId) {
      throw new Error('Animation library canonical clip identity does not match');
    }
    if (!isRecord(clip.manifest) || clip.manifest.clipId !== clipId) {
      throw new Error('Animation library manifest clip identity does not match');
    }
    return {
      clipId,
      label: readString(clip.label, `clips[${index}].label`),
      tags: readTags(clip.tags, `clips[${index}].tags`),
      canonical: clip.canonical as unknown as CanonicalAnimationClip,
      manifest: clip.manifest as unknown as AnimationAssetManifest,
    };
  });
  const clipIds = new Set(clips.map((clip) => clip.clipId));
  if (clipIds.size !== clips.length) throw new Error('Animation library clip IDs must be unique');

  if (!Array.isArray(value.states) || value.states.length > companionModes.length * 8) {
    throw new Error('Invalid animation library state bindings');
  }
  const states = value.states.map((state) => {
    if (!isRecord(state)) throw new Error('Invalid animation library state binding');
    const clipId = readId(state.clipId, 'state clipId');
    if (!clipIds.has(clipId)) throw new Error(`Animation library state references missing clip ${clipId}`);
    return {
      mode: readMode(state.mode, 'state mode'),
      clipId,
      order: readNumber(state.order, 'state order', 0, 10_000, true),
      crossFadeMs: readNumber(state.crossFadeMs, 'state cross-fade', 0, 1_000, true),
    };
  });

  if (!Array.isArray(value.programs) || value.programs.length === 0 || value.programs.length > 500) {
    throw new Error('Invalid animation library programs');
  }
  const programs = value.programs.map((program, index) => {
    if (!isRecord(program) || !Array.isArray(program.steps) || program.steps.length === 0 || program.steps.length > 16) {
      throw new Error('Invalid animation library program');
    }
    const steps = program.steps.map((step) => {
      if (!isRecord(step)) throw new Error('Invalid animation library program step');
      const clipId = readId(step.clipId, 'program step clipId');
      if (!clipIds.has(clipId)) throw new Error(`Animation library program references missing clip ${clipId}`);
      if (typeof step.reverse !== 'boolean') throw new Error('Invalid animation library step direction');
      return {
        clipId,
        repetitions: readNumber(step.repetitions, 'program step repetitions', 1, 12, true),
        reverse: step.reverse,
        holdSeconds: readNumber(step.holdSeconds, 'program step hold', 0, 30),
      };
    });
    const fallbackCue = program.fallbackCue;
    if (fallbackCue !== undefined && !tagPattern.test(readString(fallbackCue, 'fallback cue', 40))) {
      throw new Error('Invalid animation library fallback cue');
    }
    return {
      programId: readId(program.programId, `programs[${index}].programId`),
      label: readString(program.label, `programs[${index}].label`),
      tags: readTags(program.tags, `programs[${index}].tags`),
      trigger: parseTrigger(program.trigger),
      fallbackCue: fallbackCue as string | undefined,
      steps,
    };
  });
  if (new Set(programs.map((program) => program.programId)).size !== programs.length) {
    throw new Error('Animation library program IDs must be unique');
  }

  return {
    schemaVersion: 1,
    libraryId: readId(value.libraryId, 'libraryId'),
    label: readString(value.label, 'label'),
    creator: readString(value.creator, 'creator'),
    licenseId: 'CC0-1.0',
    sourceUrl: readUrl(value.sourceUrl, 'sourceUrl'),
    generatedAt: readTimestamp(value.generatedAt, 'generatedAt'),
    sourceArchives,
    clips,
    states,
    programs,
  };
}
