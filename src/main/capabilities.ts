import type { DistributionProfile } from '../shared/runtime';
import { readReleaseManifest, type ReleaseManifest } from '../shared/release-manifest';

const embeddedReleaseManifest = typeof __DESKY_RELEASE_MANIFEST__ === 'undefined'
  ? undefined
  : __DESKY_RELEASE_MANIFEST__;
let cachedManifest: ReleaseManifest | undefined;

export function getReleaseManifest(value: unknown = embeddedReleaseManifest): ReleaseManifest {
  if (value !== embeddedReleaseManifest) return readReleaseManifest(value);
  cachedManifest ??= readReleaseManifest(value);
  return cachedManifest;
}

export function getDistributionProfile(manifest?: unknown): DistributionProfile {
  return getReleaseManifest(manifest).distributionProfile;
}
