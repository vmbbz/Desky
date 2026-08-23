import type { CompanionMode } from '../../shared/adapter-events';
import {
  parseCanonicalAnimationClip,
  serializeCanonicalAnimationClip,
  type CanonicalAnimationClip,
} from '../../shared/canonical-animation';
import {
  parseAnimationAssetManifest,
  type AnimationAssetManifest,
} from '../../shared/animation-manifest';
import { sha256Hex } from '../../shared/asset-provenance';

export type MotionPlayback = 'loop' | 'once';

const admittedMotionClip = Symbol('admittedMotionClip');

export type ProceduralMotionPreset =
  | 'offline'
  | 'neutral'
  | 'attentive'
  | 'focus'
  | 'work'
  | 'speak'
  | 'approval'
  | 'success'
  | 'cancelled'
  | 'error';

export interface MotionClipRegistration {
  readonly [admittedMotionClip]: true;
  readonly mode: CompanionMode;
  readonly canonical: CanonicalAnimationClip;
  readonly manifest: AnimationAssetManifest;
  readonly playback: MotionPlayback;
  readonly crossFadeMs?: number;
  /** Lower values win. Ties are resolved by canonical clipId. */
  readonly order?: number;
}

export interface AdmitMotionClipInput {
  mode: CompanionMode;
  canonical: unknown;
  manifest: unknown;
  crossFadeMs?: number;
  order?: number;
}

export interface MotionPlan {
  mode: CompanionMode;
  priority: number;
  procedural: ProceduralMotionPreset;
  playback: MotionPlayback;
  crossFadeMs: number;
  stopImmediately: boolean;
  reducedMotion: boolean;
  clip?: MotionClipRegistration;
}

interface MotionRule {
  priority: number;
  procedural: ProceduralMotionPreset;
  playback: MotionPlayback;
  crossFadeMs: number;
  allowClip: boolean;
}

const rules: Record<CompanionMode, MotionRule> = {
  cancelled: {
    priority: 100,
    procedural: 'cancelled',
    playback: 'once',
    crossFadeMs: 0,
    allowClip: false,
  },
  approval: {
    priority: 95,
    procedural: 'approval',
    playback: 'loop',
    crossFadeMs: 120,
    allowClip: true,
  },
  disconnected: {
    priority: 90,
    procedural: 'offline',
    playback: 'loop',
    crossFadeMs: 120,
    allowClip: true,
  },
  error: {
    priority: 80,
    procedural: 'error',
    playback: 'once',
    crossFadeMs: 160,
    allowClip: true,
  },
  success: {
    priority: 70,
    procedural: 'success',
    playback: 'once',
    crossFadeMs: 160,
    allowClip: true,
  },
  working: {
    priority: 60,
    procedural: 'work',
    playback: 'loop',
    crossFadeMs: 180,
    allowClip: true,
  },
  speaking: {
    priority: 50,
    procedural: 'speak',
    playback: 'loop',
    crossFadeMs: 180,
    allowClip: true,
  },
  thinking: {
    priority: 45,
    procedural: 'focus',
    playback: 'loop',
    crossFadeMs: 180,
    allowClip: true,
  },
  listening: {
    priority: 40,
    procedural: 'attentive',
    playback: 'loop',
    crossFadeMs: 160,
    allowClip: true,
  },
  idle: {
    priority: 10,
    procedural: 'neutral',
    playback: 'loop',
    crossFadeMs: 220,
    allowClip: true,
  },
};

function compareModes(left: CompanionMode, right: CompanionMode): number {
  return rules[right].priority - rules[left].priority || left.localeCompare(right);
}

function selectClip(
  mode: CompanionMode,
  registrations: readonly MotionClipRegistration[],
): MotionClipRegistration | undefined {
  const exact = registrations.filter((registration) => registration.mode === mode);
  // Connectivity changes the semantic/status priority, but it must not turn the
  // companion back into its imported bind pose. An admitted idle loop is the
  // safe body fallback when disconnected has no purpose-authored state clip.
  const candidates = exact.length > 0
    ? exact
    : mode === 'disconnected'
      ? registrations.filter((registration) => registration.mode === 'idle')
      : [];
  return candidates
    .sort((left, right) =>
      (left.order ?? 0) - (right.order ?? 0) ||
      left.canonical.clipId.localeCompare(right.canonical.clipId),
    )[0];
}

function safeCrossFade(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Math.round(value), 1_000));
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/**
 * Creates the only supported production registration shape after the rights,
 * conversion, semantic, and exact-output-hash contracts all agree.
 */
export async function admitMotionClip(
  input: AdmitMotionClipInput,
): Promise<MotionClipRegistration> {
  if (input.mode === 'cancelled') {
    throw new Error('Cancelled motion cannot register a full-body clip');
  }
  if (
    input.order !== undefined &&
    (!Number.isSafeInteger(input.order) || input.order < 0 || input.order > 10_000)
  ) {
    throw new Error('Animation registration order is invalid');
  }
  const canonical = parseCanonicalAnimationClip(input.canonical);
  const manifest = parseAnimationAssetManifest(input.manifest);
  if (manifest.clipId !== canonical.clipId) {
    throw new Error('Animation manifest clipId does not match canonical clip');
  }
  if (manifest.intent !== input.mode) {
    throw new Error('Animation manifest intent does not match companion state');
  }
  if (manifest.layer !== 'state') {
    throw new Error('State motion registration requires the state animation layer');
  }
  if (manifest.conversion.sampleRate !== canonical.sampleRate) {
    throw new Error('Animation manifest sample rate does not match canonical clip');
  }
  const digest = await sha256Hex(exactArrayBuffer(serializeCanonicalAnimationClip(canonical)));
  if (digest !== manifest.output.sha256) {
    throw new Error('Animation output checksum does not match canonical clip');
  }
  deepFreeze(canonical);
  deepFreeze(manifest);
  return Object.freeze({
    [admittedMotionClip]: true as const,
    mode: input.mode,
    canonical,
    manifest,
    playback: manifest.playback === 'one-shot' ? 'once' : 'loop',
    crossFadeMs: safeCrossFade(input.crossFadeMs, rules[input.mode].crossFadeMs),
    order: input.order,
  });
}

/**
 * Resolves concurrent semantic requests into one full-body owner. This is the
 * only place where state priority and clip selection are decided.
 */
export function resolveMotionPlan(
  requested: CompanionMode | readonly CompanionMode[],
  registrations: readonly MotionClipRegistration[] = [],
  options: { reducedMotion?: boolean } = {},
): MotionPlan {
  const modes = (Array.isArray(requested) ? requested : [requested]) as CompanionMode[];
  const mode = [...new Set(modes)].sort(compareModes)[0] ?? 'idle';
  const rule = rules[mode];
  const reducedMotion = options.reducedMotion === true;
  const clip = !reducedMotion && rule.allowClip
    ? selectClip(mode, registrations)
    : undefined;

  return {
    mode,
    priority: rule.priority,
    procedural: rule.procedural,
    playback: clip?.playback ?? rule.playback,
    crossFadeMs: reducedMotion
      ? 0
      : safeCrossFade(clip?.crossFadeMs, rule.crossFadeMs),
    stopImmediately: mode === 'cancelled',
    reducedMotion,
    clip,
  };
}

export function motionPriority(mode: CompanionMode): number {
  return rules[mode].priority;
}
