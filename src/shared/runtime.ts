export const distributionProfiles = ['store', 'direct'] as const;

export type DistributionProfile = (typeof distributionProfiles)[number];

export const surfaceKinds = ['ambient', 'control-center'] as const;

export type SurfaceKind = (typeof surfaceKinds)[number];

export const motionPreferences = ['system', 'full', 'reduced'] as const;

export type MotionPreference = (typeof motionPreferences)[number];

export function resolveReducedMotion(
  preference: MotionPreference,
  systemPrefersReducedMotion: boolean,
): boolean {
  if (preference === 'full') return false;
  if (preference === 'reduced') return true;
  return systemPrefersReducedMotion;
}

export interface RuntimeInfo {
  distributionProfile: DistributionProfile;
  platform: NodeJS.Platform;
  version: string;
  surface: SurfaceKind;
}

export interface DesktopRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ambientPointerRegions = ['interactive', 'transparent'] as const;

export type AmbientPointerRegion = (typeof ambientPointerRegions)[number];

export const bubblePlacements = ['above', 'below'] as const;

export type BubblePlacement = (typeof bubblePlacements)[number];

export const horizontalPlacements = ['left', 'center', 'right'] as const;

export type HorizontalPlacement = (typeof horizontalPlacements)[number];

export interface AmbientSurfaceState {
  alwaysOnTop: boolean;
  bounds: DesktopRectangle;
  bubblePlacement: BubblePlacement;
  displayKey: string;
  fullClickThrough: boolean;
  horizontalPlacement: HorizontalPlacement;
  recoveryAvailable: boolean;
  recoveryShortcut: string;
  recoveryShortcutRegistered: boolean;
  trayAvailable: boolean;
  visible: boolean;
  workArea: DesktopRectangle;
}

export const windowActions = [
  'close',
  'minimize',
  'hide-ambient',
  'open-control-center',
  'reset-ambient-position',
  'show-ambient',
  'toggle-always-on-top',
  'toggle-full-click-through',
] as const;

export type WindowAction = (typeof windowActions)[number];
