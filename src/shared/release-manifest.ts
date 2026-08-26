import type { DistributionProfile } from './runtime';

export const releaseProfileIds = [
  'development-direct',
  'windows-direct',
  'windows-store-free',
  'macos-direct',
  'macos-store',
] as const;

export type ReleaseProfileId = (typeof releaseProfileIds)[number];
export type ReleaseTargetPlatform = 'win32' | 'darwin' | 'development';
export type ReleaseCommerceMode = 'disabled';

export interface ReleaseManifest {
  schemaVersion: 1;
  profileId: ReleaseProfileId;
  buildMarker: string;
  packageClass: 'development' | 'release-candidate';
  targetPlatform: ReleaseTargetPlatform;
  distributionProfile: DistributionProfile;
  commerceMode: ReleaseCommerceMode;
  adapterIds: readonly string[];
  localAgentProcesses: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>): boolean {
  const expected = [
    'schemaVersion', 'profileId', 'buildMarker', 'packageClass', 'targetPlatform',
    'distributionProfile', 'commerceMode', 'adapterIds', 'localAgentProcesses',
  ];
  return Object.keys(value).length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

export function readReleaseManifest(value: unknown): ReleaseManifest {
  if (!isRecord(value)
    || !exactKeys(value)
    || value.schemaVersion !== 1
    || !releaseProfileIds.includes(value.profileId as ReleaseProfileId)
    || value.buildMarker !== `desky-release-profile:${String(value.profileId)}`
    || (value.packageClass !== 'development' && value.packageClass !== 'release-candidate')
    || !['win32', 'darwin', 'development'].includes(String(value.targetPlatform))
    || (value.distributionProfile !== 'direct' && value.distributionProfile !== 'store')
    || value.commerceMode !== 'disabled'
    || !Array.isArray(value.adapterIds)
    || value.adapterIds.length === 0
    || value.adapterIds.length > 4
    || value.adapterIds.some((adapterId) => typeof adapterId !== 'string'
      || !/^[a-z][a-z0-9-]{0,31}$/.test(adapterId))
    || new Set(value.adapterIds).size !== value.adapterIds.length
    || typeof value.localAgentProcesses !== 'boolean') {
    throw new Error('The embedded Desky release manifest is invalid.');
  }

  const adapterIds = [...value.adapterIds] as string[];
  const storeProfile = value.distributionProfile === 'store';
  if (storeProfile && (value.localAgentProcesses || adapterIds.length !== 1
    || adapterIds[0] !== 'openclaw')) {
    throw new Error('The embedded Desky Store release manifest is invalid.');
  }
  if (!storeProfile && !adapterIds.includes('openclaw')) {
    throw new Error('The embedded Desky direct release manifest is invalid.');
  }
  if (value.profileId === 'development-direct' && value.packageClass !== 'development') {
    throw new Error('The embedded Desky development release manifest is invalid.');
  }
  if (value.profileId !== 'development-direct' && value.packageClass !== 'release-candidate') {
    throw new Error('The embedded Desky release candidate manifest is invalid.');
  }

  return Object.freeze({
    schemaVersion: 1,
    profileId: value.profileId as ReleaseProfileId,
    buildMarker: value.buildMarker,
    packageClass: value.packageClass,
    targetPlatform: value.targetPlatform as ReleaseTargetPlatform,
    distributionProfile: value.distributionProfile as DistributionProfile,
    commerceMode: 'disabled',
    adapterIds: Object.freeze(adapterIds),
    localAgentProcesses: value.localAgentProcesses,
  });
}
