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

/** Keeps ambient life efficient while preserving deliberate/live motion fidelity. */
export function resolveAvatarTargetFrameRate(input: AvatarFrameRateInput): 30 | 60 {
  return input.activeCue || input.previewActive || highFidelityModes.has(input.mode) ? 60 : 30;
}
