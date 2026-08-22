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
      alwaysOnTop: false,
      placements: {
        valid: { x: 10, y: -21, updatedAt: '2026-08-22T12:00:00.000Z' },
      },
    });
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
