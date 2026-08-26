import { describe, expect, it } from 'vitest';

import { resolveBuildReleaseManifest } from '../release.config';
import { getDistributionProfile, getReleaseManifest } from '../src/main/capabilities';
import { readReleaseManifest } from '../src/shared/release-manifest';

describe('release manifest', () => {
  it('resolves the ordinary development package explicitly', () => {
    const manifest = resolveBuildReleaseManifest(undefined, 'win32');
    expect(manifest).toMatchObject({
      profileId: 'development-direct',
      packageClass: 'development',
      distributionProfile: 'direct',
      commerceMode: 'disabled',
    });
    expect(getDistributionProfile(manifest)).toBe('direct');
  });

  it('admits only remote OpenClaw in the Windows Store-free profile', () => {
    expect(resolveBuildReleaseManifest('windows-store-free', 'win32')).toMatchObject({
      profileId: 'windows-store-free',
      packageClass: 'release-candidate',
      distributionProfile: 'store',
      commerceMode: 'disabled',
      adapterIds: ['openclaw'],
      localAgentProcesses: false,
    });
  });

  it('rejects unknown profiles and platform mismatches instead of falling back', () => {
    expect(() => resolveBuildReleaseManifest('windows-store-third-party-commerce', 'win32'))
      .toThrow('Unknown Desky release profile');
    expect(() => resolveBuildReleaseManifest('macos-store', 'win32'))
      .toThrow('cannot target win32');
  });

  it('rejects extra fields and Store manifests that widen capabilities', () => {
    const manifest = resolveBuildReleaseManifest('windows-store-free', 'win32');
    expect(() => readReleaseManifest({ ...manifest, remoteFlag: true }))
      .toThrow('release manifest is invalid');
    expect(() => getReleaseManifest({
      ...manifest,
      adapterIds: ['openclaw', 'codex'],
      localAgentProcesses: true,
    })).toThrow('Store release manifest is invalid');
  });

  it('returns frozen manifests and capability lists', () => {
    const manifest = resolveBuildReleaseManifest('windows-direct', 'win32');
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.adapterIds)).toBe(true);
  });
});
