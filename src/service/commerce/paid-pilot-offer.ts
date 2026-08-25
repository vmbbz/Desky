import { getPaidPilotAvatarRevisions } from '../../main/marketplace-catalog';
import { parseBaseSepoliaOfferPolicy, type BaseSepoliaOfferPolicy } from './quote-service';

export const toothpastePilotOfferId = 'offer.avatar.toothpaste.base-sepolia-pilot';
export const toothpastePilotCatalogVersion = 'desky-paid-pilot:1';
export const toothpastePilotAmountAtomic = '100000';

/** Exact product/price admission for the capped testnet pilot; environment can choose regions/recipient only. */
export function admitToothpastePilotOffer(value: unknown): BaseSepoliaOfferPolicy {
  const offer = parseBaseSepoliaOfferPolicy(value);
  const [revision] = getPaidPilotAvatarRevisions();
  if (!revision
    || offer.offerId !== toothpastePilotOfferId
    || offer.offerRevision !== 1
    || offer.productId !== revision.avatar.productId
    || offer.productRevision !== 1
    || offer.avatarRevisionIds.length !== 1
    || offer.avatarRevisionIds[0] !== revision.avatar.revisionId
    || offer.catalogVersion !== toothpastePilotCatalogVersion
    || offer.amountAtomic !== toothpastePilotAmountAtomic) {
    throw new Error('Hosted commerce offer is not the admitted Toothpaste pilot.');
  }
  return offer;
}
