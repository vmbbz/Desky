import type { AvatarSelectionState, SelectedAvatarAsset } from './avatar-assets';

export const marketplaceCommerceModes = ['disabled', 'enabled'] as const;
export type MarketplaceCommerceMode = (typeof marketplaceCommerceModes)[number];

export const marketplaceAvailability = ['free', 'locked', 'unavailable'] as const;
export type MarketplaceAvailability = (typeof marketplaceAvailability)[number];

export const avatarAdmissionStatuses = ['admitted', 'candidate', 'suspended'] as const;
export type AvatarAdmissionStatus = (typeof avatarAdmissionStatuses)[number];

export interface MarketplaceAvatar {
  avatarId: string;
  productId: string;
  revisionId: string;
  name: string;
  description: string;
  creator: string;
  projectId: string;
  projectName: string;
  sourceUrl: string;
  licenseId: string;
  licenseUrl: string;
  attribution: string;
  modelSha256: string;
  vrmVersion: '0.x' | '1.0';
  performanceClass: 'light' | 'standard' | 'rich';
  admissionStatus: AvatarAdmissionStatus;
  availability: MarketplaceAvailability;
}

export interface MarketplaceCatalog {
  schemaVersion: 1;
  catalogId: string;
  revision: number;
  generatedAt: string;
  authority: 'bundled-foundation';
  commerceMode: MarketplaceCommerceMode;
  targetFreeAvatarCount: 3;
  avatars: MarketplaceAvatar[];
}

export interface FreeEntitlementDecision {
  provider: 'free';
  productId: string;
  status: 'granted' | 'unavailable';
  reason: string;
}

export interface MarketplaceThumbnail {
  avatarId: string;
  mediaType: 'image/png';
  bytes: ArrayBuffer;
}

const idPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string, maximum = 512): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`Invalid marketplace ${field}.`);
  }
  return value;
}

function readId(value: unknown, field: string): string {
  const id = readString(value, field, 128);
  if (!idPattern.test(id)) throw new Error(`Invalid marketplace ${field}.`);
  return id;
}

function readHttpsUrl(value: unknown, field: string): string {
  const raw = readString(value, field, 2_048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid marketplace ${field}.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`Invalid marketplace ${field}.`);
  }
  return url.href;
}

function parseAvatar(value: unknown): MarketplaceAvatar {
  if (!isRecord(value)
    || !avatarAdmissionStatuses.includes(value.admissionStatus as AvatarAdmissionStatus)
    || !marketplaceAvailability.includes(value.availability as MarketplaceAvailability)
    || (value.vrmVersion !== '0.x' && value.vrmVersion !== '1.0')
    || (value.performanceClass !== 'light'
      && value.performanceClass !== 'standard'
      && value.performanceClass !== 'rich')) {
    throw new Error('Invalid marketplace avatar.');
  }
  const modelSha256 = readString(value.modelSha256, 'model SHA-256', 64);
  if (!sha256Pattern.test(modelSha256)) throw new Error('Invalid marketplace model SHA-256.');
  const avatar: MarketplaceAvatar = {
    avatarId: readId(value.avatarId, 'avatar ID'),
    productId: readId(value.productId, 'product ID'),
    revisionId: readId(value.revisionId, 'revision ID'),
    name: readString(value.name, 'avatar name', 120),
    description: readString(value.description, 'avatar description', 400),
    creator: readString(value.creator, 'creator', 200),
    projectId: readId(value.projectId, 'project ID'),
    projectName: readString(value.projectName, 'project name', 200),
    sourceUrl: readHttpsUrl(value.sourceUrl, 'source URL'),
    licenseId: readString(value.licenseId, 'licence ID', 120),
    licenseUrl: readHttpsUrl(value.licenseUrl, 'licence URL'),
    attribution: readString(value.attribution, 'attribution', 1_000),
    modelSha256,
    vrmVersion: value.vrmVersion,
    performanceClass: value.performanceClass,
    admissionStatus: value.admissionStatus as AvatarAdmissionStatus,
    availability: value.availability as MarketplaceAvailability,
  };
  if (avatar.admissionStatus !== 'admitted' && avatar.availability !== 'unavailable') {
    throw new Error('Only admitted marketplace avatars can be made available.');
  }
  return avatar;
}

export function parseMarketplaceCatalog(value: unknown): MarketplaceCatalog {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.authority !== 'bundled-foundation'
    || !marketplaceCommerceModes.includes(value.commerceMode as MarketplaceCommerceMode)
    || value.targetFreeAvatarCount !== 3
    || !Array.isArray(value.avatars)
    || value.avatars.length > 5_000
    || typeof value.revision !== 'number'
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1) {
    throw new Error('Invalid marketplace catalog.');
  }
  const generatedAt = readString(value.generatedAt, 'generation timestamp', 40);
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('Invalid marketplace generation timestamp.');
  }
  const avatars = value.avatars.map(parseAvatar);
  if (new Set(avatars.map((avatar) => avatar.avatarId)).size !== avatars.length
    || new Set(avatars.map((avatar) => avatar.productId)).size !== avatars.length) {
    throw new Error('Marketplace catalog identifiers must be unique.');
  }
  if (value.commerceMode === 'disabled' && avatars.some((avatar) => avatar.availability === 'locked')) {
    throw new Error('A commerce-disabled catalog cannot advertise locked purchases.');
  }
  return {
    schemaVersion: 1,
    catalogId: readId(value.catalogId, 'catalog ID'),
    revision: value.revision,
    generatedAt,
    authority: 'bundled-foundation',
    commerceMode: value.commerceMode as MarketplaceCommerceMode,
    targetFreeAvatarCount: 3,
    avatars,
  };
}

export function evaluateFreeEntitlement(avatar: MarketplaceAvatar): FreeEntitlementDecision {
  if (avatar.admissionStatus !== 'admitted' || avatar.availability !== 'free') {
    return {
      provider: 'free',
      productId: avatar.productId,
      status: 'unavailable',
      reason: 'This companion has not been admitted to the free catalog.',
    };
  }
  return {
    provider: 'free',
    productId: avatar.productId,
    status: 'granted',
    reason: 'Included permanently with Desky.',
  };
}

export interface MarketplaceBridge {
  getCatalog(): Promise<MarketplaceCatalog>;
  getThumbnail(avatarId: string): Promise<MarketplaceThumbnail>;
  getPreview(avatarId: string): Promise<SelectedAvatarAsset>;
  activate(avatarId: string): Promise<AvatarSelectionState>;
  openSource(avatarId: string): Promise<void>;
}
