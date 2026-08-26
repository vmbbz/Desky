import { describe, expect, it } from 'vitest';

import {
  resolveAvatarFrameDelayMs,
  resolveAvatarTargetFrameRate,
} from '../src/renderer/avatar/avatar-render-policy';

describe('avatar render policy', () => {
  it('uses 20 FPS for calm ambient state loops', () => {
    expect(resolveAvatarTargetFrameRate({
      mode: 'idle',
      activeCue: false,
      previewActive: false,
    })).toBe(20);
    expect(resolveAvatarTargetFrameRate({
      mode: 'disconnected',
      activeCue: false,
      previewActive: false,
    })).toBe(20);
  });

  it('uses 60 FPS for live semantic work, explicit cues, and previews', () => {
    expect(resolveAvatarTargetFrameRate({
      mode: 'speaking',
      activeCue: false,
      previewActive: false,
    })).toBe(60);
    expect(resolveAvatarTargetFrameRate({
      mode: 'idle',
      activeCue: true,
      previewActive: false,
    })).toBe(60);
    expect(resolveAvatarTargetFrameRate({
      mode: 'idle',
      activeCue: false,
      previewActive: true,
    })).toBe(60);
  });

  it('sleeps between target frames instead of polling every display refresh', () => {
    expect(resolveAvatarFrameDelayMs(20, 3)).toBeCloseTo(47, 2);
    expect(resolveAvatarFrameDelayMs(60, 4)).toBeCloseTo(12.667, 2);
    expect(resolveAvatarFrameDelayMs(60, 20)).toBe(0);
    expect(resolveAvatarFrameDelayMs(20, Number.NaN)).toBeCloseTo(50, 2);
  });

});
