import { describe, expect, it } from 'vitest';

import {
  admitToothpastePilotOffer,
  toothpastePilotAmountAtomic,
  toothpastePilotCatalogVersion,
  toothpastePilotOfferId,
} from '../src/service/commerce/paid-pilot-offer';

const offer = {
  schemaVersion: 1,
  offerId: toothpastePilotOfferId,
  offerRevision: 1,
  productId: 'avatar.toothpaste',
  productRevision: 1,
  avatarRevisionIds: ['toothpaste-6dc38124-v1'],
  catalogVersion: toothpastePilotCatalogVersion,
  regions: ['ZA'],
  currency: 'USDC',
  amountAtomic: toothpastePilotAmountAtomic,
  recipient: '0x2222222222222222222222222222222222222222',
} as const;

describe('Toothpaste paid pilot offer', () => {
  it('pins the exact paid revision and ten-cent atomic test-USDC price', () => {
    expect(admitToothpastePilotOffer(offer)).toEqual(offer);
  });

  it('rejects environment attempts to drift the product or price', () => {
    expect(() => admitToothpastePilotOffer({ ...offer, amountAtomic: '100001' })).toThrow(/Toothpaste/);
    expect(() => admitToothpastePilotOffer({
      ...offer, avatarRevisionIds: ['milk-99e32f15-v1'],
    })).toThrow(/Toothpaste/);
  });
});
