import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  parseAssetProvenance,
  type AssetProvenance,
} from '../shared/asset-provenance';
import type { AvatarCatalogFetcher } from '../shared/avatar-catalog';
import {
  downloadAdmittedAvatarRevision,
  downloadAdmittedAvatarThumbnail,
} from './avatar-asset-broker';
import type { AdmittedAvatarRevision } from './marketplace-catalog';

interface AvatarCacheSidecar {
  schemaVersion: 1;
  revisionId: string;
  registryCommit: string;
  sourceRecordSha256: string;
  bytes: number;
  provenance: AssetProvenance;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertVrmEnvelope(bytes: Uint8Array, expectedVersion: '0.x' | '1.0'): void {
  if (bytes.byteLength < 20) throw new Error('Avatar is not a complete GLB file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67
    || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== bytes.byteLength
    || view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error('Avatar has an invalid GLB envelope.');
  }
  const jsonLength = view.getUint32(12, true);
  if (jsonLength === 0 || 20 + jsonLength > bytes.byteLength) {
    throw new Error('Avatar has an invalid GLB JSON chunk.');
  }
  let document: unknown;
  try {
    const json = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).replace(/\0+$/u, '');
    document = JSON.parse(json) as unknown;
  } catch {
    throw new Error('Avatar has unreadable GLB metadata.');
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error('Avatar has unreadable GLB metadata.');
  }
  const extensions = (document as Record<string, unknown>).extensions;
  if (typeof extensions !== 'object' || extensions === null || Array.isArray(extensions)) {
    throw new Error('Avatar does not contain VRM metadata.');
  }
  const names = Object.keys(extensions);
  const actualVersion = names.includes('VRMC_vrm') ? '1.0' : names.includes('VRM') ? '0.x' : undefined;
  if (!actualVersion) throw new Error('Avatar does not contain VRM metadata.');
  if (actualVersion !== expectedVersion) throw new Error('Avatar VRM version does not match its admission record.');
}

function parseSidecar(
  value: unknown,
  revision: AdmittedAvatarRevision,
  kind: 'avatar' | 'thumbnail',
  sourceUrl: string,
  expectedSha256: string,
  expectedBytes: number,
): AvatarCacheSidecar {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid avatar cache sidecar.');
  }
  const source = value as Record<string, unknown>;
  const provenance = parseAssetProvenance(source.provenance);
  if (source.schemaVersion !== 1
    || source.revisionId !== revision.avatar.revisionId
    || source.registryCommit !== revision.registryCommit
    || source.sourceRecordSha256 !== revision.sourceRecordSha256
    || source.bytes !== expectedBytes
    || provenance.assetId !== `${kind}:${revision.avatar.avatarId}/${revision.avatar.revisionId}`
    || provenance.kind !== kind
    || provenance.sourceUrl !== sourceUrl
    || provenance.licenseId !== revision.avatar.licenseId
    || provenance.sha256 !== expectedSha256) {
    throw new Error('Avatar cache sidecar does not match its admitted revision.');
  }
  return {
    schemaVersion: 1,
    revisionId: revision.avatar.revisionId,
    registryCommit: revision.registryCommit,
    sourceRecordSha256: revision.sourceRecordSha256,
    bytes: expectedBytes,
    provenance,
  };
}

export class AvatarCache {
  constructor(
    private readonly rootPath: string,
    private readonly fetcher: AvatarCatalogFetcher = fetch,
  ) {}

  async get(revision: AdmittedAvatarRevision): Promise<ArrayBuffer> {
    const objectPath = join(this.rootPath, 'objects', `${revision.avatar.modelSha256}.vrm`);
    const recordPath = join(this.rootPath, 'records', `${revision.avatar.revisionId}.json`);
    try {
      const [object, record] = await Promise.all([
        readFile(objectPath),
        readFile(recordPath, 'utf8'),
      ]);
      this.validateBytes(object, revision);
      parseSidecar(
        JSON.parse(record) as unknown,
        revision,
        'avatar',
        revision.modelUrl,
        revision.avatar.modelSha256,
        revision.modelBytes,
      );
      return toArrayBuffer(object);
    } catch {
      return this.downloadAndStore(revision, objectPath, recordPath);
    }
  }

  async getThumbnail(revision: AdmittedAvatarRevision): Promise<ArrayBuffer> {
    const objectPath = join(this.rootPath, 'objects', `${revision.thumbnailSha256}.png`);
    const recordPath = join(this.rootPath, 'records', `${revision.avatar.revisionId}.thumbnail.json`);
    try {
      const [object, record] = await Promise.all([
        readFile(objectPath),
        readFile(recordPath, 'utf8'),
      ]);
      this.validateThumbnail(object, revision);
      parseSidecar(
        JSON.parse(record) as unknown,
        revision,
        'thumbnail',
        revision.thumbnailUrl,
        revision.thumbnailSha256,
        revision.thumbnailBytes,
      );
      return toArrayBuffer(object);
    } catch {
      const downloaded = new Uint8Array(
        await downloadAdmittedAvatarThumbnail(revision, this.fetcher),
      );
      this.validateThumbnail(downloaded, revision);
      return this.storeThumbnail(revision, downloaded, objectPath, recordPath);
    }
  }

  private validateBytes(bytes: Uint8Array, revision: AdmittedAvatarRevision): void {
    if (bytes.byteLength !== revision.modelBytes) {
      throw new Error('Avatar byte length does not match its admission record.');
    }
    if (sha256(bytes) !== revision.avatar.modelSha256) {
      throw new Error('Avatar checksum does not match its admission record.');
    }
    assertVrmEnvelope(bytes, revision.avatar.vrmVersion);
  }

  private validateThumbnail(bytes: Uint8Array, revision: AdmittedAvatarRevision): void {
    if (bytes.byteLength !== revision.thumbnailBytes
      || sha256(bytes) !== revision.thumbnailSha256) {
      throw new Error('Avatar thumbnail does not match its admission record.');
    }
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.byteLength < pngSignature.length
      || pngSignature.some((value, index) => bytes[index] !== value)) {
      throw new Error('Avatar thumbnail is not an admitted PNG image.');
    }
  }

  private async downloadAndStore(
    revision: AdmittedAvatarRevision,
    objectPath: string,
    recordPath: string,
  ): Promise<ArrayBuffer> {
    const downloaded = new Uint8Array(await downloadAdmittedAvatarRevision(revision, this.fetcher));
    this.validateBytes(downloaded, revision);
    const fetchedAt = new Date().toISOString();
    const sidecar: AvatarCacheSidecar = {
      schemaVersion: 1,
      revisionId: revision.avatar.revisionId,
      registryCommit: revision.registryCommit,
      sourceRecordSha256: revision.sourceRecordSha256,
      bytes: downloaded.byteLength,
      provenance: parseAssetProvenance({
        schemaVersion: 1,
        assetId: `avatar:${revision.avatar.avatarId}/${revision.avatar.revisionId}`,
        kind: 'avatar',
        sourceUrl: revision.modelUrl,
        sourceProject: revision.avatar.projectName,
        creator: revision.avatar.creator,
        licenseId: revision.avatar.licenseId,
        attribution: revision.avatar.attribution,
        sha256: revision.avatar.modelSha256,
        fetchedAt,
        sourceUpdatedAt: revision.sourceUpdatedAt,
      }),
    };
    await Promise.all([
      mkdir(join(this.rootPath, 'objects'), { recursive: true }),
      mkdir(join(this.rootPath, 'records'), { recursive: true }),
    ]);
    const nonce = `${process.pid}-${Date.now()}`;
    const temporaryObjectPath = `${objectPath}.${nonce}.tmp`;
    const temporaryRecordPath = `${recordPath}.${nonce}.tmp`;
    try {
      await Promise.all([
        writeFile(temporaryObjectPath, downloaded, { mode: 0o600 }),
        writeFile(temporaryRecordPath, `${JSON.stringify(sidecar, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        }),
      ]);
      await rm(objectPath, { force: true });
      await rename(temporaryObjectPath, objectPath);
      await rm(recordPath, { force: true });
      await rename(temporaryRecordPath, recordPath);
    } catch (error) {
      await Promise.all([
        rm(temporaryObjectPath, { force: true }),
        rm(temporaryRecordPath, { force: true }),
      ]);
      throw error;
    }
    return toArrayBuffer(downloaded);
  }

  private async storeThumbnail(
    revision: AdmittedAvatarRevision,
    downloaded: Uint8Array,
    objectPath: string,
    recordPath: string,
  ): Promise<ArrayBuffer> {
    const fetchedAt = new Date().toISOString();
    const sidecar: AvatarCacheSidecar = {
      schemaVersion: 1,
      revisionId: revision.avatar.revisionId,
      registryCommit: revision.registryCommit,
      sourceRecordSha256: revision.sourceRecordSha256,
      bytes: downloaded.byteLength,
      provenance: parseAssetProvenance({
        schemaVersion: 1,
        assetId: `thumbnail:${revision.avatar.avatarId}/${revision.avatar.revisionId}`,
        kind: 'thumbnail',
        sourceUrl: revision.thumbnailUrl,
        sourceProject: revision.avatar.projectName,
        creator: revision.avatar.creator,
        licenseId: revision.avatar.licenseId,
        attribution: revision.avatar.attribution,
        sha256: revision.thumbnailSha256,
        fetchedAt,
        sourceUpdatedAt: revision.sourceUpdatedAt,
      }),
    };
    await Promise.all([
      mkdir(join(this.rootPath, 'objects'), { recursive: true }),
      mkdir(join(this.rootPath, 'records'), { recursive: true }),
    ]);
    const nonce = `${process.pid}-${Date.now()}`;
    const temporaryObjectPath = `${objectPath}.${nonce}.tmp`;
    const temporaryRecordPath = `${recordPath}.${nonce}.tmp`;
    try {
      await Promise.all([
        writeFile(temporaryObjectPath, downloaded, { mode: 0o600 }),
        writeFile(temporaryRecordPath, `${JSON.stringify(sidecar, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        }),
      ]);
      await rm(objectPath, { force: true });
      await rename(temporaryObjectPath, objectPath);
      await rm(recordPath, { force: true });
      await rename(temporaryRecordPath, recordPath);
    } catch (error) {
      await Promise.all([
        rm(temporaryObjectPath, { force: true }),
        rm(temporaryRecordPath, { force: true }),
      ]);
      throw error;
    }
    return toArrayBuffer(downloaded);
  }
}
