import { describe, expect, it } from 'vitest';

import { resolveAvatarFramingScale } from '../src/renderer/avatar/avatar-framing';

describe('avatar framing', () => {
  it('fits a companion inside the camera with motion-safe horizontal room', () => {
    const cameraDistance = 4.2;
    const verticalFovDegrees = 28;
    const aspectRatio = 423 / 583;
    const visibleHeight = 2 * cameraDistance * Math.tan(verticalFovDegrees * Math.PI / 360);
    const visibleWidth = visibleHeight * aspectRatio;
    const scale = resolveAvatarFramingScale({
      avatarWidth: 1.5,
      avatarHeight: 2.5,
      cameraDistance,
      verticalFovDegrees,
      aspectRatio,
    });

    expect(2.5 * scale).toBeLessThanOrEqual(visibleHeight * 0.98);
    expect(1.5 * scale).toBeLessThanOrEqual(visibleWidth * 0.9);
    expect(scale).toBeGreaterThan(0);
  });

  it('fails safely for malformed geometry or camera data', () => {
    expect(resolveAvatarFramingScale({
      avatarWidth: 0,
      avatarHeight: 2,
      cameraDistance: 4,
      verticalFovDegrees: 28,
      aspectRatio: 1,
    })).toBe(1);
  });
});
