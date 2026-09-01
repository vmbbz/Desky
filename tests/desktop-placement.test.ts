import { describe, expect, it } from 'vitest';

import {
  clampBoundsToDisplays,
  defaultAmbientBounds,
  deriveAmbientEdgeLayout,
  displayArrangementKey,
  resolveAmbientDragBounds,
  resolveArrangementBounds,
  type DisplayGeometry,
} from '../src/main/desktop-placement';

const primary: DisplayGeometry = {
  id: '1',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};

const secondary: DisplayGeometry = {
  id: '2',
  bounds: { x: -1280, y: 0, width: 1280, height: 1024 },
  workArea: { x: -1280, y: 24, width: 1280, height: 1000 },
  scaleFactor: 1.25,
};

describe('desktop placement', () => {
  it('keys arrangements by geometry rather than unstable enumeration order or display IDs', () => {
    expect(displayArrangementKey([primary, secondary])).toBe(displayArrangementKey([
      { ...secondary, id: '99' },
      { ...primary, id: '44' },
    ]));
    expect(displayArrangementKey([primary])).not.toBe(displayArrangementKey([primary, secondary]));
  });

  it('selects the intersecting display and clamps every edge inside its work area', () => {
    const result = clampBoundsToDisplays(
      { x: -1500, y: -80, width: 420, height: 580 },
      [primary, secondary],
    );
    expect(result.display.id).toBe('2');
    expect(result.bounds).toEqual({ x: -1268, y: 36, width: 420, height: 580 });
  });

  it('recovers an off-screen placement onto the nearest active display', () => {
    const result = clampBoundsToDisplays(
      { x: 3800, y: 1700, width: 420, height: 580 },
      [primary, secondary],
    );
    expect(result.display.id).toBe('1');
    expect(result.bounds).toEqual({ x: 1488, y: 448, width: 420, height: 580 });
  });

  it('starts near the lower-right safe edge of the primary work area', () => {
    expect(defaultAmbientBounds({ width: 420, height: 580 }, primary)).toEqual({
      x: 1476,
      y: 436,
      width: 420,
      height: 580,
    });
  });

  it('restores a known arrangement position instead of carrying over the current topology', () => {
    expect(resolveArrangementBounds(
      { x: 1488, y: 448, width: 420, height: 580 },
      [primary, secondary],
      { x: -1100, y: 180 },
    )).toEqual({ x: -1100, y: 180, width: 420, height: 580 });
  });

  it('flips and shifts anchored UI away from nearby work-area edges', () => {
    expect(deriveAmbientEdgeLayout(
      { x: 12, y: 12, width: 420, height: 580 },
      primary.workArea,
    )).toEqual({ bubblePlacement: 'below', horizontalPlacement: 'right' });
    expect(deriveAmbientEdgeLayout(
      { x: 1488, y: 448, width: 420, height: 580 },
      primary.workArea,
    )).toEqual({ bubblePlacement: 'above', horizontalPlacement: 'left' });
    expect(deriveAmbientEdgeLayout(
      { x: 700, y: 200, width: 420, height: 580 },
      primary.workArea,
    )).toEqual({ bubblePlacement: 'above', horizontalPlacement: 'center' });
  });

  it('keeps the ambient container fixed-size even if Windows reports a snapped start bound', () => {
    expect(resolveAmbientDragBounds(
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: 100, y: 100 },
      { x: 165, y: 142 },
      { width: 420, height: 580 },
    )).toEqual({ x: 65, y: 42, width: 420, height: 580 });
  });
});
