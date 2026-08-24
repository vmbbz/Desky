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

export interface AnimationProgramCycle {
  id: string;
  length: number;
  slots: number[];
}

export type AnimationProgramTrigger =
  | {
      kind: 'ambient';
      modes: CompanionMode[];
      weight: number;
      minimumQuietSeconds: number;
      maximumQuietSeconds: number;
      cooldownSeconds: number;
      cycle?: AnimationProgramCycle;
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
  hipsTranslation: 'authored' | 'preserve-target';
}

export interface AnimationLibrary {
  schemaVersion: 1;
  libraryId: string;
  label: string;
  creator: string;
  licenseId: 'CC0-1.0' | 'MIXED';
  sourceUrl: string;
  generatedAt: string;
  sourceArchives: Array<{
    sourceId: string;
    label: string;
    sourceUrl: string;
    archiveSha256: string;
    animationSourceSha256: string;
    clipCount: number;
    creator: string;
    licenseId: string;
    attribution: string;
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
  let cycle: AnimationProgramCycle | undefined;
  if (value.cycle !== undefined) {
    if (!isRecord(value.cycle) || !Array.isArray(value.cycle.slots)) {
      throw new Error('Invalid animation library ambient cycle');
    }
    const length = readNumber(value.cycle.length, 'ambient cycle length', 2, 32, true);
    const slots = value.cycle.slots.map((slot) =>
      readNumber(slot, 'ambient cycle slot', 0, length - 1, true));
    if (slots.length === 0 || new Set(slots).size !== slots.length) {
      throw new Error('Invalid animation library ambient cycle slots');
    }
    cycle = {
      id: readId(value.cycle.id, 'ambient cycle id'),
      length,
      slots,
    };
  }
  return {
    kind: 'ambient',
    modes,
    weight: readNumber(value.weight, 'ambient weight', 0.01, 1_000),
    minimumQuietSeconds,
    maximumQuietSeconds,
    cooldownSeconds: readNumber(value.cooldownSeconds, 'ambient cooldown', 0, 3_600),
    cycle,
  };
}

function validateAmbientCycles(programs: readonly AnimationProgram[]): void {
  const allAmbient = programs.filter(
    (program): program is AnimationProgram & { trigger: Extract<AnimationProgramTrigger, { kind: 'ambient' }> } =>
      program.trigger.kind === 'ambient',
  );
  const ambient = allAmbient.filter(
    (program): program is AnimationProgram & { trigger: Extract<AnimationProgramTrigger, { kind: 'ambient' }> } =>
      program.trigger.kind === 'ambient' && program.trigger.cycle !== undefined,
  );
  const cycleIdsByMode = new Map<CompanionMode, Set<string>>();
  for (const program of ambient) {
    const cycle = program.trigger.cycle!;
    for (const mode of program.trigger.modes) {
      const ids = cycleIdsByMode.get(mode) ?? new Set<string>();
      ids.add(cycle.id);
      cycleIdsByMode.set(mode, ids);
    }
  }
  for (const [mode, ids] of cycleIdsByMode) {
    if (ids.size > 1) throw new Error(`Animation library ambient mode ${mode} has competing cycles`);
    if (allAmbient.some((program) => program.trigger.modes.includes(mode) && !program.trigger.cycle)) {
      throw new Error(`Animation library ambient mode ${mode} mixes cycled and weighted programs`);
    }
    const cycleId = [...ids][0];
    const members = ambient.filter(
      (program) => program.trigger.cycle?.id === cycleId && program.trigger.modes.includes(mode),
    );
    const lengths = new Set(members.map((program) => program.trigger.cycle!.length));
    if (lengths.size !== 1) throw new Error(`Animation library ambient cycle ${cycleId} has inconsistent length`);
    const length = [...lengths][0];
    for (let slot = 0; slot < length; slot += 1) {
      const owners = members.filter((program) => program.trigger.cycle!.slots.includes(slot));
      if (owners.length !== 1) {
        throw new Error(`Animation library ambient cycle ${cycleId} must own slot ${slot} exactly once`);
      }
    }
  }
}

export function parseAnimationLibrary(value: unknown): AnimationLibrary {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Unsupported animation library schema');
  }
  if (value.licenseId !== 'CC0-1.0' && value.licenseId !== 'MIXED') {
    throw new Error('Built-in animation libraries must use an admitted library licence');
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
    const creator = source.creator ?? value.creator;
    const licenseId = source.licenseId ?? value.licenseId;
    const attribution = source.attribution ?? `${creator}; ${source.label}; ${licenseId}`;
    return {
      sourceId: readId(source.sourceId, `sourceArchives[${index}].sourceId`),
      label: readString(source.label, `sourceArchives[${index}].label`),
      sourceUrl: readUrl(source.sourceUrl, `sourceArchives[${index}].sourceUrl`),
      archiveSha256,
      animationSourceSha256,
      clipCount: readNumber(source.clipCount, 'source clip count', 1, 10_000, true),
      creator: readString(creator, 'source creator'),
      licenseId: readString(licenseId, 'source license', 120),
      attribution: readString(attribution, 'source attribution', 2_000),
    };
  });
  if (new Set(sourceArchives.map((source) => source.sourceId)).size !== sourceArchives.length) {
    throw new Error('Animation library source IDs must be unique');
  }
  const sourceLicenses = new Set(sourceArchives.map((source) => source.licenseId));
  if (value.licenseId === 'CC0-1.0' && [...sourceLicenses].some((license) => license !== 'CC0-1.0')) {
    throw new Error('CC0 animation libraries cannot contain a differently licensed source');
  }
  if (value.licenseId === 'MIXED' && sourceLicenses.size < 2) {
    throw new Error('Mixed animation libraries require multiple source licences');
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
    const hipsTranslation = state.hipsTranslation ?? 'authored';
    if (hipsTranslation !== 'authored' && hipsTranslation !== 'preserve-target') {
      throw new Error('Invalid animation state hips translation policy');
    }
    const admittedHipsTranslation = hipsTranslation as AnimationStateBinding['hipsTranslation'];
    return {
      mode: readMode(state.mode, 'state mode'),
      clipId,
      order: readNumber(state.order, 'state order', 0, 10_000, true),
      crossFadeMs: readNumber(state.crossFadeMs, 'state cross-fade', 0, 1_000, true),
      hipsTranslation: admittedHipsTranslation,
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
  validateAmbientCycles(programs);

  return {
    schemaVersion: 1,
    libraryId: readId(value.libraryId, 'libraryId'),
    label: readString(value.label, 'label'),
    creator: readString(value.creator, 'creator'),
    licenseId: value.licenseId,
    sourceUrl: readUrl(value.sourceUrl, 'sourceUrl'),
    generatedAt: readTimestamp(value.generatedAt, 'generatedAt'),
    sourceArchives,
    clips,
    states,
    programs,
  };
}
