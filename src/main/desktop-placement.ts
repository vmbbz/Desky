import type {
  BubblePlacement,
  DesktopRectangle,
  HorizontalPlacement,
} from '../shared/runtime';

export interface DisplayGeometry {
  bounds: DesktopRectangle;
  id: string;
  scaleFactor: number;
  workArea: DesktopRectangle;
}

export interface AmbientEdgeLayout {
  bubblePlacement: BubblePlacement;
  horizontalPlacement: HorizontalPlacement;
}

const defaultInset = 12;
const edgeThreshold = 48;

function finiteInteger(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

function rectangleSignature(rectangle: DesktopRectangle): string {
  return [rectangle.x, rectangle.y, rectangle.width, rectangle.height]
    .map(finiteInteger)
    .join(',');
}

export function displayArrangementKey(displays: DisplayGeometry[]): string {
  const geometries = displays.map((display) => (
    `${rectangleSignature(display.bounds)}@${display.scaleFactor.toFixed(3)}`
  ));
  geometries.sort();
  return `v1:${geometries.join(';')}`;
}

function intersectionArea(first: DesktopRectangle, second: DesktopRectangle): number {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
  );
  return width * height;
}

function centerDistanceSquared(first: DesktopRectangle, second: DesktopRectangle): number {
  const firstX = first.x + first.width / 2;
  const firstY = first.y + first.height / 2;
  const secondX = second.x + second.width / 2;
  const secondY = second.y + second.height / 2;
  return (firstX - secondX) ** 2 + (firstY - secondY) ** 2;
}

export function selectDisplayForBounds(
  bounds: DesktopRectangle,
  displays: DisplayGeometry[],
): DisplayGeometry {
  if (displays.length === 0) throw new Error('At least one display is required');

  return displays.reduce((best, candidate) => {
    const bestIntersection = intersectionArea(bounds, best.workArea);
    const candidateIntersection = intersectionArea(bounds, candidate.workArea);
    if (candidateIntersection !== bestIntersection) {
      return candidateIntersection > bestIntersection ? candidate : best;
    }
    return centerDistanceSquared(bounds, candidate.workArea)
      < centerDistanceSquared(bounds, best.workArea)
      ? candidate
      : best;
  });
}

export function clampBoundsToWorkArea(
  bounds: DesktopRectangle,
  workArea: DesktopRectangle,
  inset = defaultInset,
): DesktopRectangle {
  const safeInset = Math.max(0, finiteInteger(inset));
  const availableWidth = Math.max(0, workArea.width - safeInset * 2);
  const availableHeight = Math.max(0, workArea.height - safeInset * 2);
  const minX = workArea.x + safeInset;
  const minY = workArea.y + safeInset;
  const maxX = minX + Math.max(0, availableWidth - bounds.width);
  const maxY = minY + Math.max(0, availableHeight - bounds.height);

  return {
    ...bounds,
    x: Math.min(maxX, Math.max(minX, finiteInteger(bounds.x))),
    y: Math.min(maxY, Math.max(minY, finiteInteger(bounds.y))),
  };
}

export function clampBoundsToDisplays(
  bounds: DesktopRectangle,
  displays: DisplayGeometry[],
  inset = defaultInset,
): { bounds: DesktopRectangle; display: DisplayGeometry } {
  const display = selectDisplayForBounds(bounds, displays);
  return {
    bounds: clampBoundsToWorkArea(bounds, display.workArea, inset),
    display,
  };
}

export function defaultAmbientBounds(
  size: Pick<DesktopRectangle, 'width' | 'height'>,
  display: DisplayGeometry,
  inset = 24,
): DesktopRectangle {
  return clampBoundsToWorkArea({
    x: display.workArea.x + display.workArea.width - size.width - inset,
    y: display.workArea.y + display.workArea.height - size.height - inset,
    width: size.width,
    height: size.height,
  }, display.workArea, inset);
}

export function resolveArrangementBounds(
  currentBounds: DesktopRectangle,
  displays: DisplayGeometry[],
  storedPosition?: Pick<DesktopRectangle, 'x' | 'y'>,
): DesktopRectangle {
  return clampBoundsToDisplays({
    ...currentBounds,
    x: storedPosition?.x ?? currentBounds.x,
    y: storedPosition?.y ?? currentBounds.y,
  }, displays).bounds;
}

export function deriveAmbientEdgeLayout(
  bounds: DesktopRectangle,
  workArea: DesktopRectangle,
  threshold = edgeThreshold,
): AmbientEdgeLayout {
  const topClearance = bounds.y - workArea.y;
  const leftClearance = bounds.x - workArea.x;
  const rightClearance = workArea.x + workArea.width - (bounds.x + bounds.width);

  return {
    bubblePlacement: topClearance <= threshold ? 'below' : 'above',
    horizontalPlacement: leftClearance <= threshold
      ? 'right'
      : rightClearance <= threshold
        ? 'left'
        : 'center',
  };
}

export function resolveAmbientDragBounds(
  startBounds: DesktopRectangle,
  pointerStart: Pick<DesktopRectangle, 'x' | 'y'>,
  pointerCurrent: Pick<DesktopRectangle, 'x' | 'y'>,
  fixedSize: Pick<DesktopRectangle, 'width' | 'height'>,
): DesktopRectangle {
  return {
    x: startBounds.x + Math.round(pointerCurrent.x - pointerStart.x),
    y: startBounds.y + Math.round(pointerCurrent.y - pointerStart.y),
    width: fixedSize.width,
    height: fixedSize.height,
  };
}
