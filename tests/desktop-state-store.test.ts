import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DesktopStateStore,
  defaultDesktopState,
  parseDesktopState,
  recordPlacement,
} from '../src/main/desktop-state-store';
import { motionPersonalityForPreset } from '../src/shared/motion-personality';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('desktop state store', () => {
  it('fails closed to defaults and filters malformed persisted coordinates', () => {
    expect(parseDesktopState(null)).toEqual(defaultDesktopState);
    expect(parseDesktopState({ version: 99, alwaysOnTop: false, placements: {} }))
      .toEqual(defaultDesktopState);
    expect(parseDesktopState({
      version: 1,
      alwaysOnTop: false,
      placements: {
        valid: { x: 10.4, y: -20.6, updatedAt: '2026-08-22T12:00:00.000Z' },
        huge: { x: 1_000_000, y: 2, updatedAt: '2026-08-22T12:00:00.000Z' },
        stale: { x: 1, y: 2, updatedAt: 'not-a-date' },
      },
    })).toEqual({
      version: 1,
      activeAvatarRevisionId: 'milk-99e32f15-v1',
      alwaysOnTop: false,
      avatarYawDegrees: 0,
      fallbackAvatarRevisionId: 'milk-99e32f15-v1',
      motionPreference: 'full',
      motionPersonality: motionPersonalityForPreset('balanced'),
      placements: {
        valid: { x: 10, y: -21, updatedAt: '2026-08-22T12:00:00.000Z' },
      },
    });
  });

  it('persists bounded avatar revision IDs and repairs malformed values', () => {
    expect(parseDesktopState({
      ...defaultDesktopState,
      activeAvatarRevisionId: 'cool-banana-4d316549-v1',
      fallbackAvatarRevisionId: 'astronaut-1cb82186-v1',
    })).toMatchObject({
      activeAvatarRevisionId: 'cool-banana-4d316549-v1',
      fallbackAvatarRevisionId: 'astronaut-1cb82186-v1',
    });
    expect(parseDesktopState({
      ...defaultDesktopState,
      activeAvatarRevisionId: '../escape',
      fallbackAvatarRevisionId: '',
    })).toMatchObject({
      activeAvatarRevisionId: 'milk-99e32f15-v1',
      fallbackAvatarRevisionId: 'milk-99e32f15-v1',
    });
  });

  it('normalizes persisted avatar rotation without accepting malformed values', () => {
    expect(parseDesktopState({
      version: 1,
      alwaysOnTop: true,
      avatarYawDegrees: 540.04,
      placements: {},
    }).avatarYawDegrees).toBe(-180);
    expect(parseDesktopState({
      version: 1,
      alwaysOnTop: true,
      avatarYawDegrees: 'sideways',
      placements: {},
    }).avatarYawDegrees).toBe(0);
  });

  it('persists a valid motion personality and repairs malformed values', () => {
    const lively = motionPersonalityForPreset('lively');
    expect(parseDesktopState({
      ...defaultDesktopState,
      motionPersonality: lively,
    }).motionPersonality).toEqual(lively);
    expect(parseDesktopState({
      ...defaultDesktopState,
      motionPersonality: { preset: 'chaos' },
    }).motionPersonality).toEqual(defaultDesktopState.motionPersonality);
  });

  it('defaults movement to full and persists a valid accessibility envelope', () => {
    expect(parseDesktopState({
      ...defaultDesktopState,
      motionPreference: 'system',
    }).motionPreference).toBe('system');
    expect(parseDesktopState({
      ...defaultDesktopState,
      motionPreference: 'unbounded',
    }).motionPreference).toBe('full');
    expect(parseDesktopState({
      version: 1,
      alwaysOnTop: true,
      placements: {},
    }).motionPreference).toBe('full');
  });

  it('retains only the sixteen most recently updated display arrangements', () => {
    let state = structuredClone(defaultDesktopState);
    for (let index = 0; index < 20; index += 1) {
      state = recordPlacement(
        state,
        `display-${index}`,
        { x: index, y: index },
        new Date(Date.UTC(2026, 7, 22, 12, index)).toISOString(),
      );
    }
    expect(Object.keys(state.placements)).toHaveLength(16);
    expect(state.placements['display-19']).toBeDefined();
    expect(state.placements['display-0']).toBeUndefined();
  });

  it('round-trips a validated state through an atomic application-data file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'desky-desktop-state-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'nested', 'desktop-state.json');
    const store = new DesktopStateStore(path);
    const state = recordPlacement(defaultDesktopState, 'arrangement', { x: 88, y: 144 });
    store.save({ ...state, alwaysOnTop: false });

    expect(store.load()).toEqual({ ...state, alwaysOnTop: false });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ...state, alwaysOnTop: false });
  });
});
