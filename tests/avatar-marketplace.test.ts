import { describe, expect, it } from 'vitest';

import {
  getAdmittedAvatarRevisionByRevisionId,
  getBundledMarketplaceCatalog,
  getPaidPilotAvatarRevisions,
} from '../src/main/marketplace-catalog';
import {
  evaluateFreeEntitlement,
  parseMarketplaceCatalog,
} from '../src/shared/avatar-marketplace';

describe('avatar marketplace foundation', () => {
  it('publishes three admitted free revisions while commerce is disabled', () => {
    const catalog = getBundledMarketplaceCatalog();
    expect(catalog.commerceMode).toBe('disabled');
    expect(catalog.targetFreeAvatarCount).toBe(3);
    expect(catalog.avatars).toHaveLength(3);
    expect(catalog.avatars.map((avatar) => avatar.name)).toEqual([
      'Milk',
      'CoolBanana',
      'Astronaut',
    ]);
    expect(catalog.avatars.every((avatar) => avatar.availability === 'free'
      && avatar.admissionStatus === 'admitted'
      && evaluateFreeEntitlement(avatar).status === 'granted')).toBe(true);
  });

  it('rejects locked offers when the commerce provider is disabled', () => {
    const catalog = getBundledMarketplaceCatalog();
    expect(() => parseMarketplaceCatalog({
      ...catalog,
      avatars: [{ ...catalog.avatars[0], availability: 'locked' }],
    })).toThrow(/commerce-disabled/);
  });

  it('rejects candidates that are presented as available', () => {
    const catalog = getBundledMarketplaceCatalog();
    expect(() => parseMarketplaceCatalog({
      ...catalog,
      avatars: [{ ...catalog.avatars[0], admissionStatus: 'candidate' }],
    })).toThrow(/Only admitted/);
  });

  it('keeps the rights-reviewed paid pilot outside the provider-disabled free catalog', () => {
    const catalog = getBundledMarketplaceCatalog();
    const [toothpaste] = getPaidPilotAvatarRevisions();
    expect(toothpaste).toMatchObject({
      avatar: {
        name: 'Toothpaste',
        productId: 'avatar.toothpaste',
        revisionId: 'toothpaste-6dc38124-v1',
        licenseId: 'CC0-1.0',
        animationProfileId: 'desky-humanoid-standard-v1',
        availability: 'locked',
      },
      registryCommit: '0f9a1b2fd99894736563d55b2c9dc9125700d081',
      modelBytes: 1_223_740,
      thumbnailBytes: 1_199_496,
    });
    expect(catalog.avatars.some((avatar) => avatar.avatarId === toothpaste.avatar.avatarId)).toBe(false);
    expect(getAdmittedAvatarRevisionByRevisionId(toothpaste.avatar.revisionId)).toBe(toothpaste);
  });
});
