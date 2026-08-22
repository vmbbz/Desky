export const distributionProfiles = ['store', 'direct'] as const;

export type DistributionProfile = (typeof distributionProfiles)[number];

export const surfaceKinds = ['ambient', 'control-center'] as const;

export type SurfaceKind = (typeof surfaceKinds)[number];

export interface RuntimeInfo {
  distributionProfile: DistributionProfile;
  platform: NodeJS.Platform;
  version: string;
  surface: SurfaceKind;
}

export const windowActions = [
  'close',
  'minimize',
  'open-control-center',
  'show-ambient',
] as const;

export type WindowAction = (typeof windowActions)[number];
