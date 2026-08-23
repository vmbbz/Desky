import { describe, expect, it } from 'vitest';

import { resolveAvatarDragMode } from '../src/renderer/avatar/avatar-manipulation';

describe('avatar manipulation intent', () => {
  it('rotates direct mesh drags and moves transparent-space drags', () => {
    expect(resolveAvatarDragMode({ hitAvatar: true, forceRotate: false })).toBe('rotate');
    expect(resolveAvatarDragMode({ hitAvatar: false, forceRotate: false })).toBe('move');
  });

  it('retains modifier-driven rotation when raycasting misses', () => {
    expect(resolveAvatarDragMode({ hitAvatar: false, forceRotate: true })).toBe('rotate');
  });
});
