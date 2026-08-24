import { describe, expect, it } from 'vitest';

import { resolveAvatarTargetFrameRate } from '../src/renderer/avatar/avatar-render-policy';

describe('avatar render policy', () => {
  it('uses 30 FPS for ambient and autonomous idle life', () => {
    expect(resolveAvatarTargetFrameRate({
      mode: 'idle',
      activeCue: false,
      previewActive: false,
    })).toBe(30);
    expect(resolveAvatarTargetFrameRate({
      mode: 'disconnected',
      activeCue: false,
      previewActive: false,
    })).toBe(30);
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
});
