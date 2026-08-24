import {
  parseMarketplaceCatalog,
  type MarketplaceCatalog,
} from '../shared/avatar-marketplace';

const bundledFoundationCatalog: MarketplaceCatalog = {
  schemaVersion: 1,
  catalogId: 'desky-foundation',
  revision: 1,
  generatedAt: '2026-08-24T00:00:00.000Z',
  authority: 'bundled-foundation',
  commerceMode: 'disabled',
  targetFreeAvatarCount: 3,
  avatars: [{
    avatarId: '15dce553-3d3c-4288-8c03-c69c65167447',
    productId: 'avatar.milk',
    revisionId: 'milk-99e32f15-v1',
    name: 'Milk',
    description: 'The light, expressive carton companion used to prove Desky’s VRM and motion foundations.',
    creator: 'Polygonal Mind',
    projectId: '100avatars-r1',
    projectName: '100Avatars R1',
    sourceUrl: 'https://github.com/ToxSam/open-source-avatars',
    licenseId: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Milk by Polygonal Mind · 100Avatars R1 · CC0-1.0',
    modelSha256: '99e32f15d529eb47b3892aa44d5f053c07dabf55a0851aca7e7ab74f5f17e107',
    vrmVersion: '0.x',
    performanceClass: 'light',
    admissionStatus: 'admitted',
    availability: 'free',
  }],
};

export function getBundledMarketplaceCatalog(): MarketplaceCatalog {
  return parseMarketplaceCatalog(structuredClone(bundledFoundationCatalog));
}
