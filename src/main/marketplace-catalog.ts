import {
  parseMarketplaceCatalog,
  type MarketplaceAvatar,
  type MarketplaceCatalog,
} from '../shared/avatar-marketplace';

export interface AdmittedAvatarRevision {
  avatar: MarketplaceAvatar;
  registryCommit: string;
  sourceRecordSha256: string;
  modelUrl: string;
  thumbnailUrl: string;
  thumbnailSha256: string;
  thumbnailBytes: number;
  modelBytes: number;
  sourceUpdatedAt: string;
}

const registryCommit = '0f9a1b2fd99894736563d55b2c9dc9125700d081';

const freeAdmittedRevisions: readonly AdmittedAvatarRevision[] = [{
  avatar: {
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
  },
  registryCommit,
  sourceRecordSha256: '880ed0f4523d0c1e9809f85e2f7583e4b111ff7a5e5b68df509e6e086502a5fa',
  modelUrl: 'https://arweave.net/X3NJlq8p9AsiUIqZhsmByDssKQGYeAZxnFNI0fSULMI',
  thumbnailUrl: 'https://arweave.net/C5r_C82cPUwxHxPCL2_ZQC6Gr3owsvbQ2Um3Pkb5_sk',
  thumbnailSha256: 'bdaf847bc6feebfe2e5efde3b1329cccb9c30bcb109e93e0d134865fcb8eecf5',
  thumbnailBytes: 788_547,
  modelBytes: 1_338_344,
  sourceUpdatedAt: '2025-03-11T16:41:51.489Z',
}, {
  avatar: {
    avatarId: 'c47d2c68-80ae-4131-802a-b1bf12f30398',
    productId: 'avatar.cool-banana',
    revisionId: 'cool-banana-4d316549-v1',
    name: 'CoolBanana',
    description: 'A sunglasses-wearing banana with a famously readable silhouette at desktop-companion scale.',
    creator: 'Polygonal Mind',
    projectId: '100avatars-r1',
    projectName: '100Avatars R1',
    sourceUrl: 'https://github.com/ToxSam/open-source-avatars',
    licenseId: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'CoolBanana by Polygonal Mind · 100Avatars R1 · CC0-1.0',
    modelSha256: '4d316549404d52bb0f4f60ae91a6c7bd234e001987840df04e1e73379941aa4c',
    vrmVersion: '0.x',
    performanceClass: 'light',
    admissionStatus: 'admitted',
    availability: 'free',
  },
  registryCommit,
  sourceRecordSha256: '1c6afcabff8e16b2c66f639b780449d72907ca7113d718d2649be39a67120842',
  modelUrl: 'https://arweave.net/o4gWzn4PPzYo2KPm-wFXnvBC7KrN6N_R0NNfg1yPPeM',
  thumbnailUrl: 'https://arweave.net/4X1LoMeFmjPx8gMrJn4NQv0U59CHKCiw1z7ZY4aYYHw',
  thumbnailSha256: 'd8353a7ced01b0974cd0567935a34b922d29899fa1a41be4d8dcd45ffff461d1',
  thumbnailBytes: 963_931,
  modelBytes: 1_491_040,
  sourceUpdatedAt: '2025-03-11T16:41:51.488Z',
}, {
  avatar: {
    avatarId: 'e69fd8b9-d6ae-44ca-84e0-be4bb075d426',
    productId: 'avatar.astronaut',
    revisionId: 'astronaut-1cb82186-v1',
    name: 'Astronaut',
    description: 'A compact suited explorer that broadens Desky’s free animation and framing test portfolio.',
    creator: 'Polygonal Mind',
    projectId: '100avatars-r1',
    projectName: '100Avatars R1',
    sourceUrl: 'https://github.com/ToxSam/open-source-avatars',
    licenseId: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Astronaut by Polygonal Mind · 100Avatars R1 · CC0-1.0',
    modelSha256: '1cb8218610deafc0fd4608507fc52cf3303de84b0f641b9a452efb5e8a0e6f23',
    vrmVersion: '0.x',
    performanceClass: 'light',
    admissionStatus: 'admitted',
    availability: 'free',
  },
  registryCommit,
  sourceRecordSha256: '733a0a5b4f0bb2451eb3cf3bca27ade503a70a287c7a39a71f3680c89c775ca6',
  modelUrl: 'https://arweave.net/T0c0z_XEPQHy3vyXz31XB22s_6JTqHdnau8exq_I8tI',
  thumbnailUrl: 'https://arweave.net/Qo512sj7GqyM2wvlubg4aPyA-Hl_VTxRGYiDZ0A4Wx4',
  thumbnailSha256: 'e12cc43b73ab8c3c977ba47509928f4f8a7c89393aaba7c5bcbd29f116e2c6f6',
  thumbnailBytes: 955_819,
  modelBytes: 1_679_188,
  sourceUpdatedAt: '2025-03-11T16:41:51.489Z',
}];

/**
 * Rights-reviewed revisions admitted for the isolated direct-build paid pilot. They are not
 * projected into the provider-disabled bundled catalog and therefore cannot silently become a
 * fourth free avatar or appear in a Store build.
 */
const paidPilotRevisions: readonly AdmittedAvatarRevision[] = [{
  avatar: {
    avatarId: '4877abd5-b8f5-4f06-a24d-b6006834f330',
    productId: 'avatar.toothpaste',
    revisionId: 'toothpaste-6dc38124-v1',
    name: 'Toothpaste',
    description: 'A bright, expressive tube companion selected for Desky’s first capped paid-pilot checkout.',
    creator: 'Polygonal Mind',
    projectId: '100avatars-r1',
    projectName: '100Avatars R1',
    sourceUrl: 'https://github.com/ToxSam/open-source-avatars',
    licenseId: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Toothpaste by Polygonal Mind · 100Avatars R1 · CC0-1.0',
    modelSha256: '6dc381245877db614e4021c91b1eb646a340468628a112da52ed2b66d116e719',
    vrmVersion: '0.x',
    performanceClass: 'light',
    admissionStatus: 'admitted',
    availability: 'locked',
  },
  registryCommit,
  sourceRecordSha256: '6666ec558d020632b6a2d2f3891b264a5bdbaa27ff8bea718796324f989e59b6',
  modelUrl: 'https://arweave.net/A5L5mRZbyQoLveZt8sFFiepEdd3A1VbB-yTlltq2lP8',
  thumbnailUrl: 'https://arweave.net/fV5ZWfBSozq_frCKP2W6Ei7993JaTghLYSGzelYyxBk',
  thumbnailSha256: '727cacd0795187cce551efe7df2b20650a5ddbcda1ce21bcae37074ddb62a68e',
  thumbnailBytes: 1_199_496,
  modelBytes: 1_223_740,
  sourceUpdatedAt: '2025-03-11T16:41:51.490Z',
}];

const admittedRevisions: readonly AdmittedAvatarRevision[] = [
  ...freeAdmittedRevisions,
  ...paidPilotRevisions,
];

const bundledFoundationCatalog: MarketplaceCatalog = {
  schemaVersion: 1,
  catalogId: 'desky-foundation',
  revision: 2,
  generatedAt: '2026-08-24T00:00:00.000Z',
  authority: 'bundled-foundation',
  commerceMode: 'disabled',
  targetFreeAvatarCount: 3,
  avatars: freeAdmittedRevisions.map((revision) => revision.avatar),
};

export function getBundledMarketplaceCatalog(): MarketplaceCatalog {
  return parseMarketplaceCatalog(structuredClone(bundledFoundationCatalog));
}

export function getAdmittedAvatarRevisions(): readonly AdmittedAvatarRevision[] {
  return admittedRevisions;
}

export function getPaidPilotAvatarRevisions(): readonly AdmittedAvatarRevision[] {
  return paidPilotRevisions;
}

export function getAdmittedAvatarRevisionByAvatarId(
  avatarId: string,
): AdmittedAvatarRevision | undefined {
  return admittedRevisions.find((revision) => revision.avatar.avatarId === avatarId);
}

export function getAdmittedAvatarRevisionByRevisionId(
  revisionId: string,
): AdmittedAvatarRevision | undefined {
  return admittedRevisions.find((revision) => revision.avatar.revisionId === revisionId);
}
