import { describe, expect, it } from 'vitest';

import { getBundledMarketplaceCatalog } from '../src/main/marketplace-catalog';
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
});
