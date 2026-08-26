import {
  readReleaseManifest,
  type ReleaseManifest,
  type ReleaseProfileId,
} from './src/shared/release-manifest';

type BuildProfile = Omit<ReleaseManifest, 'buildMarker'>;

const profiles: Readonly<Record<ReleaseProfileId, BuildProfile>> = Object.freeze({
  'development-direct': {
    schemaVersion: 1,
    profileId: 'development-direct',
    packageClass: 'development',
    targetPlatform: 'development',
    distributionProfile: 'direct',
    commerceMode: 'disabled',
    adapterIds: ['openclaw', 'codex', 'hermes'],
    localAgentProcesses: true,
  },
  'windows-direct': {
    schemaVersion: 1,
    profileId: 'windows-direct',
    packageClass: 'release-candidate',
    targetPlatform: 'win32',
    distributionProfile: 'direct',
    commerceMode: 'disabled',
    adapterIds: ['openclaw', 'codex', 'hermes'],
    localAgentProcesses: true,
  },
  'windows-store-free': {
    schemaVersion: 1,
    profileId: 'windows-store-free',
    packageClass: 'release-candidate',
    targetPlatform: 'win32',
    distributionProfile: 'store',
    commerceMode: 'disabled',
    adapterIds: ['openclaw'],
    localAgentProcesses: false,
  },
  'macos-direct': {
    schemaVersion: 1,
    profileId: 'macos-direct',
    packageClass: 'release-candidate',
    targetPlatform: 'darwin',
    distributionProfile: 'direct',
    commerceMode: 'disabled',
    adapterIds: ['openclaw', 'codex', 'hermes'],
    localAgentProcesses: true,
  },
  'macos-store': {
    schemaVersion: 1,
    profileId: 'macos-store',
    packageClass: 'release-candidate',
    targetPlatform: 'darwin',
    distributionProfile: 'store',
    commerceMode: 'disabled',
    adapterIds: ['openclaw'],
    localAgentProcesses: false,
  },
});

export function resolveBuildReleaseManifest(
  requestedProfile: string | undefined,
  platform: NodeJS.Platform,
): ReleaseManifest {
  const profileId = requestedProfile ?? 'development-direct';
  if (!Object.hasOwn(profiles, profileId)) {
    throw new Error(`Unknown Desky release profile: ${profileId}`);
  }
  const profile = profiles[profileId as ReleaseProfileId];
  if (profile.targetPlatform !== 'development' && profile.targetPlatform !== platform) {
    throw new Error(`Desky release profile ${profileId} cannot target ${platform}.`);
  }
  return readReleaseManifest({
    ...profile,
    buildMarker: `desky-release-profile:${profile.profileId}`,
  });
}
