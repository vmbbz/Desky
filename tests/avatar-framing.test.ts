import { describe, expect, it } from 'vitest';

import {
  resolveAvatarFramingScale,
  resolveMotionEnvelopeZoom,
  smoothMotionEnvelopeZoom,
} from '../src/renderer/avatar/avatar-framing';

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

  it('derives the same motion-envelope target from any current camera zoom', () => {
    const atFullSize = resolveMotionEnvelopeZoom({
      currentZoom: 1,
      projectedMaxAbsX: 1.6,
      projectedMaxAbsY: 0.9,
    });
    const alreadyContracted = resolveMotionEnvelopeZoom({
      currentZoom: 0.75,
      projectedMaxAbsX: 1.2,
      projectedMaxAbsY: 0.675,
    });

    expect(atFullSize).toBeCloseTo(0.575);
    expect(alreadyContracted).toBeCloseTo(atFullSize);
  });

  it('preserves the preferred idle framing when the live pose is already safe', () => {
    expect(resolveMotionEnvelopeZoom({
      currentZoom: 1,
      projectedMaxAbsX: 0.9,
      projectedMaxAbsY: 0.96,
    })).toBe(1);
  });

  it('contracts faster than it releases and fails safely for invalid samples', () => {
    const contracted = smoothMotionEnvelopeZoom({
      currentZoom: 1,
      targetZoom: 0.6,
      deltaSeconds: 1 / 60,
    });
    const released = smoothMotionEnvelopeZoom({
      currentZoom: 0.6,
      targetZoom: 1,
      deltaSeconds: 1 / 60,
    });

    expect(1 - contracted).toBeGreaterThan(released - 0.6);
    expect(resolveMotionEnvelopeZoom({
      currentZoom: 0,
      projectedMaxAbsX: Number.NaN,
      projectedMaxAbsY: 1,
    })).toBe(1);
  });
});
