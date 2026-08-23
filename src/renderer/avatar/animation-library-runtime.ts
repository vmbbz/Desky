import type { AvatarActionKind } from '../../shared/agent-actions';
import {
  parseAnimationLibrary,
  type AnimationLibrary,
  type AnimationProgram,
  type AnimationProgramStep,
} from '../../shared/animation-library';
import { parseAnimationAssetManifest } from '../../shared/animation-manifest';
import {
  parseCanonicalAnimationClip,
  serializeCanonicalAnimationClip,
  type CanonicalAnimationClip,
} from '../../shared/canonical-animation';
import { sha256Hex } from '../../shared/asset-provenance';
import {
  admitMotionClip,
  type MotionClipRegistration,
} from './motion-arbiter';
import { motionCueKinds, type MotionCueKind } from './motion-cue-queue';

const admittedAnimationLibrary = Symbol('admittedAnimationLibrary');

export interface AdmittedAnimationLibraryClip {
  clipId: string;
  label: string;
  tags: readonly string[];
  canonical: CanonicalAnimationClip;
}

export interface AdmittedAnimationProgramStep extends AnimationProgramStep {
  clip: AdmittedAnimationLibraryClip;
}

export interface AdmittedAnimationProgram extends Omit<AnimationProgram, 'steps' | 'fallbackCue'> {
  fallbackCue?: MotionCueKind;
  steps: readonly AdmittedAnimationProgramStep[];
}

export interface AdmittedAnimationLibrary {
  readonly [admittedAnimationLibrary]: true;
  libraryId: string;
  label: string;
  creator: string;
  licenseId: 'CC0-1.0';
  clipCount: number;
  clips: ReadonlyMap<string, AdmittedAnimationLibraryClip>;
  stateRegistrations: readonly MotionClipRegistration[];
  programs: readonly AdmittedAnimationProgram[];
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  if (value instanceof Map) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function validateProgramLayer(program: AnimationProgram, library: AnimationLibrary): void {
  const clips = new Map(library.clips.map((clip) => [clip.clipId, clip]));
  for (const step of program.steps) {
    const clip = clips.get(step.clipId);
    if (!clip) throw new Error(`Animation program ${program.programId} references a missing clip`);
    const manifest = parseAnimationAssetManifest(clip.manifest);
    if (program.trigger.kind === 'ambient' && manifest.layer !== 'gesture') {
      throw new Error(`Ambient program ${program.programId} requires gesture-layer clips`);
    }
    if (program.trigger.kind === 'action' && manifest.layer !== 'action') {
      throw new Error(`Action program ${program.programId} requires action-layer clips`);
    }
    if (program.trigger.kind !== 'catalog' && manifest.intent !== 'action') {
      throw new Error(`Animation program ${program.programId} requires action-intent clips`);
    }
  }
}

export async function admitAnimationLibrary(value: unknown): Promise<AdmittedAnimationLibrary> {
  const library = parseAnimationLibrary(value);
  const clips = new Map<string, AdmittedAnimationLibraryClip>();

  await Promise.all(library.clips.map(async (definition) => {
    const canonical = parseCanonicalAnimationClip(definition.canonical);
    const manifest = parseAnimationAssetManifest(definition.manifest);
    if (canonical.clipId !== definition.clipId || manifest.clipId !== definition.clipId) {
      throw new Error(`Animation library clip ${definition.clipId} has inconsistent identity`);
    }
    if (canonical.sampleRate !== manifest.conversion.sampleRate) {
      throw new Error(`Animation library clip ${definition.clipId} has inconsistent sample rate`);
    }
    if (manifest.source.licenseId !== library.licenseId || manifest.output.licenseId !== library.licenseId) {
      throw new Error(`Animation library clip ${definition.clipId} has inconsistent rights metadata`);
    }
    const bytes = serializeCanonicalAnimationClip(canonical);
    const digest = await sha256Hex(exactArrayBuffer(bytes));
    if (digest !== manifest.output.sha256) {
      throw new Error(`Animation library clip ${definition.clipId} failed output verification`);
    }
    clips.set(definition.clipId, deepFreeze({
      clipId: definition.clipId,
      label: definition.label,
      tags: [...definition.tags],
      canonical,
    }));
  }));

  const stateRegistrations = await Promise.all(library.states.map(async (binding) => {
    const definition = library.clips.find((clip) => clip.clipId === binding.clipId);
    if (!definition) throw new Error(`Animation state references missing clip ${binding.clipId}`);
    return admitMotionClip({
      mode: binding.mode,
      canonical: definition.canonical,
      manifest: definition.manifest,
      crossFadeMs: binding.crossFadeMs,
      order: binding.order,
    });
  }));

  const programs = library.programs.map((program): AdmittedAnimationProgram => {
    validateProgramLayer(program, library);
    const fallbackCue = program.fallbackCue;
    if (fallbackCue !== undefined && !motionCueKinds.includes(fallbackCue as MotionCueKind)) {
      throw new Error(`Animation program ${program.programId} has an unsupported fallback cue`);
    }
    if (program.trigger.kind !== 'catalog' && fallbackCue === undefined) {
      throw new Error(`Runnable animation program ${program.programId} requires a procedural fallback`);
    }
    return deepFreeze({
      ...program,
      fallbackCue: fallbackCue as MotionCueKind | undefined,
      steps: program.steps.map((step) => {
        const clip = clips.get(step.clipId);
        if (!clip) throw new Error(`Animation program ${program.programId} references missing clip ${step.clipId}`);
        return { ...step, clip };
      }),
    });
  });

  return Object.freeze({
    [admittedAnimationLibrary]: true as const,
    libraryId: library.libraryId,
    label: library.label,
    creator: library.creator,
    licenseId: library.licenseId,
    clipCount: clips.size,
    clips,
    stateRegistrations: Object.freeze(stateRegistrations),
    programs: Object.freeze(programs),
  });
}

export function selectActionProgram(
  library: AdmittedAnimationLibrary | undefined,
  action: AvatarActionKind,
): AdmittedAnimationProgram | undefined {
  return library?.programs
    .filter((program) => program.trigger.kind === 'action' && program.trigger.action === action)
    .sort((left, right) => {
      const leftOrder = left.trigger.kind === 'action' ? left.trigger.order : Number.MAX_SAFE_INTEGER;
      const rightOrder = right.trigger.kind === 'action' ? right.trigger.order : Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.programId.localeCompare(right.programId);
    })[0];
}
