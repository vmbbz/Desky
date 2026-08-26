import type { CompanionMode } from '../../shared/adapter-events';

const highFidelityModes = new Set<CompanionMode>([
  'thinking',
  'working',
  'approval',
  'speaking',
]);

export interface AvatarFrameRateInput {
  mode: CompanionMode;
  activeCue: boolean;
  previewActive: boolean;
}

export type AvatarTargetFrameRate = 20 | 60;

/** Keeps ambient life efficient while preserving deliberate/live motion fidelity. */
export function resolveAvatarTargetFrameRate(input: AvatarFrameRateInput): AvatarTargetFrameRate {
  return input.activeCue || input.previewActive || highFidelityModes.has(input.mode) ? 60 : 20;
}

/** Schedules one RAF near the next target frame instead of waking on every display refresh. */
export function resolveAvatarFrameDelayMs(
  targetFrameRate: AvatarTargetFrameRate,
  renderDurationMs: number,
): number {
  const duration = Number.isFinite(renderDurationMs) ? Math.max(0, renderDurationMs) : 0;
  return Math.max(0, (1_000 / targetFrameRate) - duration);
}
