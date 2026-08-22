export const assetKinds = ['avatar', 'animation', 'thumbnail', 'audio'] as const;

export type AssetKind = (typeof assetKinds)[number];

export interface AssetProvenance {
  schemaVersion: 1;
  assetId: string;
  kind: AssetKind;
  sourceUrl: string;
  sourceProject?: string;
  creator?: string;
  licenseId: string;
  attribution?: string;
  sha256: string;
  fetchedAt: string;
  sourceUpdatedAt?: string;
}

export interface CreateAssetProvenanceInput {
  assetId: string;
  kind: AssetKind;
  sourceUrl: string;
  sourceProject?: string;
  creator?: string;
  licenseId: string;
  attribution?: string;
  bytes: ArrayBuffer;
  fetchedAt?: Date;
  sourceUpdatedAt?: string;
}

const assetIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maximumLength = 500): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumLength;
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isAssetSourceUrl(value: unknown): value is string {
  if (!isNonEmptyString(value, 2_048)) return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'desky-asset:';
  } catch {
    return false;
  }
}

function readOptionalString(
  value: unknown,
  field: string,
  maximumLength = 500,
): string | undefined {
  if (value === undefined) return undefined;
  if (!isNonEmptyString(value, maximumLength)) {
    throw new Error(`Invalid asset provenance ${field}`);
  }
  return value;
}

export function parseAssetProvenance(value: unknown): AssetProvenance {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Unsupported asset provenance schema');
  }
  if (typeof value.assetId !== 'string' || !assetIdPattern.test(value.assetId)) {
    throw new Error('Invalid asset provenance assetId');
  }
  if (!assetKinds.includes(value.kind as AssetKind)) {
    throw new Error('Invalid asset provenance kind');
  }
  if (!isAssetSourceUrl(value.sourceUrl)) {
    throw new Error('Invalid asset provenance sourceUrl');
  }
  if (!isNonEmptyString(value.licenseId, 120)) {
    throw new Error('Invalid asset provenance licenseId');
  }
  if (typeof value.sha256 !== 'string' || !sha256Pattern.test(value.sha256)) {
    throw new Error('Invalid asset provenance sha256');
  }
  if (!isIsoTimestamp(value.fetchedAt)) {
    throw new Error('Invalid asset provenance fetchedAt');
  }
  if (value.sourceUpdatedAt !== undefined && !isIsoTimestamp(value.sourceUpdatedAt)) {
    throw new Error('Invalid asset provenance sourceUpdatedAt');
  }

  return {
    schemaVersion: 1,
    assetId: value.assetId,
    kind: value.kind as AssetKind,
    sourceUrl: value.sourceUrl,
    sourceProject: readOptionalString(value.sourceProject, 'sourceProject'),
    creator: readOptionalString(value.creator, 'creator'),
    licenseId: value.licenseId,
    attribution: readOptionalString(value.attribution, 'attribution', 2_000),
    sha256: value.sha256,
    fetchedAt: value.fetchedAt,
    sourceUpdatedAt: value.sourceUpdatedAt,
  };
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function createAssetProvenance(
  input: CreateAssetProvenanceInput,
): Promise<AssetProvenance> {
  return parseAssetProvenance({
    schemaVersion: 1,
    assetId: input.assetId,
    kind: input.kind,
    sourceUrl: input.sourceUrl,
    sourceProject: input.sourceProject,
    creator: input.creator,
    licenseId: input.licenseId,
    attribution: input.attribution,
    sha256: await sha256Hex(input.bytes),
    fetchedAt: (input.fetchedAt ?? new Date()).toISOString(),
    sourceUpdatedAt: input.sourceUpdatedAt,
  });
}
