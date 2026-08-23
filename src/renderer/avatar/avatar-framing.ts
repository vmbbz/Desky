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
