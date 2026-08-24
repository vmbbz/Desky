export interface AvatarFramingInput {
  avatarWidth: number;
  avatarHeight: number;
  cameraDistance: number;
  verticalFovDegrees: number;
  aspectRatio: number;
  verticalFill?: number;
  horizontalFill?: number;
}

const defaultVerticalFill = 0.98;
const defaultHorizontalFill = 0.9;
const defaultMotionHorizontalSafeNdc = 0.92;
const defaultMotionVerticalSafeNdc = 0.97;
const defaultMinimumMotionZoom = 0.42;

function boundedFill(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0.1, Math.min(value!, 1.1));
}

/**
 * Fits the relaxed avatar inside the actual camera frustum, with additional
 * horizontal room for authored arm and locomotion poses.
 */
export function resolveAvatarFramingScale(input: AvatarFramingInput): number {
  const {
    avatarWidth,
    avatarHeight,
    cameraDistance,
    verticalFovDegrees,
    aspectRatio,
  } = input;
  if (
    !Number.isFinite(avatarWidth) || avatarWidth <= 0 ||
    !Number.isFinite(avatarHeight) || avatarHeight <= 0 ||
    !Number.isFinite(cameraDistance) || cameraDistance <= 0 ||
    !Number.isFinite(verticalFovDegrees) || verticalFovDegrees <= 0 || verticalFovDegrees >= 180 ||
    !Number.isFinite(aspectRatio) || aspectRatio <= 0
  ) return 1;

  const verticalFill = boundedFill(input.verticalFill, defaultVerticalFill);
  const horizontalFill = boundedFill(input.horizontalFill, defaultHorizontalFill);
  const verticalFovRadians = verticalFovDegrees * Math.PI / 180;
  const visibleHeight = 2 * cameraDistance * Math.tan(verticalFovRadians / 2);
  const visibleWidth = visibleHeight * aspectRatio;
  return Math.min(
    visibleHeight * verticalFill / avatarHeight,
    visibleWidth * horizontalFill / avatarWidth,
  );
}

export interface MotionEnvelopeZoomInput {
  currentZoom: number;
  projectedMaxAbsX: number;
  projectedMaxAbsY: number;
  horizontalSafeNdc?: number;
  verticalSafeNdc?: number;
  minimumZoom?: number;
}

/**
 * Resolves a camera zoom from the avatar's live projected bounds. Projection
 * coordinates scale linearly with PerspectiveCamera.zoom, so measuring at the
 * current zoom can recover the same pose's zoom-one envelope without knowing
 * which avatar or animation produced it.
 */
export function resolveMotionEnvelopeZoom(input: MotionEnvelopeZoomInput): number {
  const {
    currentZoom,
    projectedMaxAbsX,
    projectedMaxAbsY,
  } = input;
  if (
    !Number.isFinite(currentZoom) || currentZoom <= 0
    || !Number.isFinite(projectedMaxAbsX) || projectedMaxAbsX <= 0
    || !Number.isFinite(projectedMaxAbsY) || projectedMaxAbsY <= 0
  ) return 1;

  const horizontalSafeNdc = boundedFill(
    input.horizontalSafeNdc,
    defaultMotionHorizontalSafeNdc,
  );
  const verticalSafeNdc = boundedFill(
    input.verticalSafeNdc,
    defaultMotionVerticalSafeNdc,
  );
  const minimumZoom = Math.min(1, boundedFill(input.minimumZoom, defaultMinimumMotionZoom));
  const zoomOneMaxAbsX = projectedMaxAbsX / currentZoom;
  const zoomOneMaxAbsY = projectedMaxAbsY / currentZoom;
  return Math.max(minimumZoom, Math.min(
    1,
    horizontalSafeNdc / zoomOneMaxAbsX,
    verticalSafeNdc / zoomOneMaxAbsY,
  ));
}

export interface SmoothMotionEnvelopeZoomInput {
  currentZoom: number;
  targetZoom: number;
  deltaSeconds: number;
  contractSeconds?: number;
  releaseSeconds?: number;
}

/** Uses a fast contraction and slower release to contain poses without pumping. */
export function smoothMotionEnvelopeZoom(input: SmoothMotionEnvelopeZoomInput): number {
  const { currentZoom, targetZoom, deltaSeconds } = input;
  if (!Number.isFinite(currentZoom) || currentZoom <= 0) return 1;
  if (!Number.isFinite(targetZoom) || targetZoom <= 0) return currentZoom;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return currentZoom;
  const responseSeconds = targetZoom < currentZoom
    ? Math.max(0.01, input.contractSeconds ?? 0.035)
    : Math.max(0.01, input.releaseSeconds ?? 0.45);
  const alpha = 1 - Math.exp(-Math.min(deltaSeconds, 0.1) / responseSeconds);
  const next = currentZoom + (targetZoom - currentZoom) * alpha;
  return Math.abs(next - targetZoom) < 0.0005 ? targetZoom : next;
}
