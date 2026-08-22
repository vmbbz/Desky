export const distributionProfiles = ['store', 'direct'] as const;

export type DistributionProfile = (typeof distributionProfiles)[number];

export interface RuntimeInfo {
  distributionProfile: DistributionProfile;
  platform: NodeJS.Platform;
  version: string;
}

export type WindowAction = 'close' | 'minimize';
