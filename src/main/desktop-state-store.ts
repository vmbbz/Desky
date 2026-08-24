import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  defaultMotionPersonality,
  normalizeMotionPersonalityPolicy,
  type MotionPersonalityPolicy,
} from '../shared/motion-personality';
import { defaultAvatarRevisionId } from '../shared/avatar-assets';

export interface StoredAmbientPlacement {
  updatedAt: string;
  x: number;
  y: number;
}

export interface DesktopState {
  activeAvatarRevisionId: string;
  alwaysOnTop: boolean;
  avatarYawDegrees: number;
  fallbackAvatarRevisionId: string;
  motionPersonality: MotionPersonalityPolicy;
  placements: Record<string, StoredAmbientPlacement>;
  version: 1;
}

const maximumPlacements = 16;

export const defaultDesktopState: DesktopState = {
  activeAvatarRevisionId: defaultAvatarRevisionId,
  alwaysOnTop: true,
  avatarYawDegrees: 0,
  fallbackAvatarRevisionId: defaultAvatarRevisionId,
  motionPersonality: structuredClone(defaultMotionPersonality),
  placements: {},
  version: 1,
};

const avatarRevisionIdPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function normalizeAvatarRevisionId(value: unknown): string {
  return typeof value === 'string' && avatarRevisionIdPattern.test(value)
    ? value
    : defaultAvatarRevisionId;
}

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000;
}

function normalizeAvatarYaw(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultDesktopState.avatarYawDegrees;
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.round(normalized * 10) / 10;
}

export function parseDesktopState(value: unknown): DesktopState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return structuredClone(defaultDesktopState);
  }
  const source = value as Record<string, unknown>;
  if (source.version !== 1) return structuredClone(defaultDesktopState);
  const placements: Record<string, StoredAmbientPlacement> = {};
  if (typeof source.placements === 'object' && source.placements !== null && !Array.isArray(source.placements)) {
    const entries: Array<[string, StoredAmbientPlacement]> = [];
    for (const [key, placementValue] of Object.entries(source.placements)) {
      if (key.length === 0 || key.length > 1024) continue;
      if (typeof placementValue !== 'object' || placementValue === null || Array.isArray(placementValue)) continue;
      const placement = placementValue as Record<string, unknown>;
      if (!isFiniteCoordinate(placement.x)
        || !isFiniteCoordinate(placement.y)
        || typeof placement.updatedAt !== 'string'
        || !Number.isFinite(Date.parse(placement.updatedAt))) continue;
      entries.push([key, {
        x: Math.round(placement.x),
        y: Math.round(placement.y),
        updatedAt: placement.updatedAt,
      }]);
    }
    entries.sort((first, second) => Date.parse(second[1].updatedAt) - Date.parse(first[1].updatedAt));
    for (const [key, placement] of entries.slice(0, maximumPlacements)) {
      placements[key] = placement;
    }
  }
  return {
    version: 1,
    activeAvatarRevisionId: normalizeAvatarRevisionId(source.activeAvatarRevisionId),
    alwaysOnTop: typeof source.alwaysOnTop === 'boolean'
      ? source.alwaysOnTop
      : defaultDesktopState.alwaysOnTop,
    avatarYawDegrees: normalizeAvatarYaw(source.avatarYawDegrees),
    fallbackAvatarRevisionId: normalizeAvatarRevisionId(source.fallbackAvatarRevisionId),
    motionPersonality: normalizeMotionPersonalityPolicy(source.motionPersonality),
    placements,
  };
}

export function recordPlacement(
  state: DesktopState,
  displayKey: string,
  position: Pick<StoredAmbientPlacement, 'x' | 'y'>,
  updatedAt = new Date().toISOString(),
): DesktopState {
  const placements = {
    ...state.placements,
    [displayKey]: {
      x: Math.round(position.x),
      y: Math.round(position.y),
      updatedAt,
    },
  };
  const retained = Object.entries(placements)
    .sort((first, second) => Date.parse(second[1].updatedAt) - Date.parse(first[1].updatedAt))
    .slice(0, maximumPlacements);
  return { ...state, placements: Object.fromEntries(retained) };
}

export class DesktopStateStore {
  constructor(private readonly filePath: string) {}

  load(): DesktopState {
    try {
      return parseDesktopState(JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown);
    } catch {
      return structuredClone(defaultDesktopState);
    }
  }

  save(state: DesktopState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(parseDesktopState(state), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temporaryPath, this.filePath);
  }
}
