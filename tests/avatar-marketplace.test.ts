import { describe, expect, it } from 'vitest';

import { getBundledMarketplaceCatalog } from '../src/main/marketplace-catalog';
import {
  evaluateFreeEntitlement,
  parseMarketplaceCatalog,
} from '../src/shared/avatar-marketplace';

describe('avatar marketplace foundation', () => {
  it('publishes only the admitted free Milk revision while commerce is disabled', () => {
    const catalog = getBundledMarketplaceCatalog();
    expect(catalog.commerceMode).toBe('disabled');
    expect(catalog.targetFreeAvatarCount).toBe(3);
    expect(catalog.avatars).toHaveLength(1);
    expect(catalog.avatars[0]).toMatchObject({
      name: 'Milk',
      availability: 'free',
      admissionStatus: 'admitted',
      modelSha256: '99e32f15d529eb47b3892aa44d5f053c07dabf55a0851aca7e7ab74f5f17e107',
    });
    expect(evaluateFreeEntitlement(catalog.avatars[0]).status).toBe('granted');
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
