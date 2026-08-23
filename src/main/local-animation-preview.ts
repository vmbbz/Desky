import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

import type {
  LocalAnimationAsset,
  LocalAnimationMetadata,
  LocalAnimationPlayCommand,
  LocalAnimationPreviewReport,
  LocalAnimationPreviewState,
} from '../shared/local-animation';
import { initialLocalAnimationPreviewState } from '../shared/local-animation';

const maxAnimationBytes = 32 * 1024 * 1024;
const maxJsonChunkBytes = 4 * 1024 * 1024;
const glbMagic = 0x46546c67;
const jsonChunkType = 0x4e4f534a;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseVrmAnimationJson(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.byteLength < 20) throw new Error('The selected file is too small to be a VRM Animation.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== glbMagic || view.getUint32(4, true) !== 2) {
    throw new Error('The selected file is not a binary glTF 2.0 VRM Animation.');
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error('The VRM Animation container length is invalid.');
  }
  const jsonLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== jsonChunkType || jsonLength === 0 || jsonLength > maxJsonChunkBytes) {
    throw new Error('The VRM Animation JSON manifest is invalid.');
  }
  if (20 + jsonLength > bytes.byteLength) {
    throw new Error('The VRM Animation JSON chunk is truncated.');
  }
  const jsonText = new TextDecoder('utf-8', { fatal: true })
    .decode(bytes.subarray(20, 20 + jsonLength))
    .replace(/[\u0000\u0020]+$/u, '');
  const parsed = JSON.parse(jsonText) as unknown;
  if (!isRecord(parsed)) throw new Error('The VRM Animation JSON root is invalid.');
  return parsed;
}

function assertEmbeddedResources(document: Record<string, unknown>): void {
  for (const collectionName of ['buffers', 'images'] as const) {
    const collection = document[collectionName];
    if (collection === undefined) continue;
    if (!Array.isArray(collection)) throw new Error(`The VRM Animation ${collectionName} list is invalid.`);
    for (const item of collection) {
      if (isRecord(item) && typeof item.uri === 'string') {
        throw new Error('VRM Animation previews must contain all resources inside the selected file.');
      }
    }
  }
}

function assertHumanoidAnimationMap(document: Record<string, unknown>): void {
  const extensions = document.extensions as Record<string, unknown>;
  const vrma = extensions.VRMC_vrm_animation as Record<string, unknown>;
  const humanoid = vrma.humanoid;
  const humanBones = isRecord(humanoid) ? humanoid.humanBones : undefined;
  const nodes = document.nodes;
  if (!isRecord(humanBones) || !Array.isArray(nodes)) {
    throw new Error('The VRM Animation has no usable humanoid bone map.');
  }
  const mappedNodeIndices = new Set<number>();
  for (const bone of Object.values(humanBones)) {
    if (!isRecord(bone) || !Number.isSafeInteger(bone.node) || (bone.node as number) < 0 || (bone.node as number) >= nodes.length) {
      throw new Error('The VRM Animation humanoid bone map is invalid.');
    }
    mappedNodeIndices.add(bone.node as number);
  }
  const hips = humanBones.hips;
  if (!isRecord(hips) || !mappedNodeIndices.has(hips.node as number)) {
    throw new Error('The VRM Animation humanoid bone map must include hips.');
  }
  const animations = document.animations as unknown[];
  const hasMappedChannel = animations.some((animation) => {
    if (!isRecord(animation) || !Array.isArray(animation.channels)) return false;
    return animation.channels.some((channel) => {
      if (!isRecord(channel) || !isRecord(channel.target)) return false;
      return Number.isSafeInteger(channel.target.node)
        && mappedNodeIndices.has(channel.target.node as number);
    });
  });
  if (!hasMappedChannel) {
    throw new Error('The VRM Animation has no channels mapped to its humanoid bones.');
  }
}

export function validateLocalAnimationAsset(filePath: string, input: Uint8Array): LocalAnimationAsset {
  const fileName = basename(filePath);
  if (extname(fileName).toLowerCase() !== '.vrma' || fileName.length === 0 || fileName.length > 255) {
    throw new Error('Choose a file with the .vrma extension.');
  }
  if (input.byteLength === 0 || input.byteLength > maxAnimationBytes) {
    throw new Error('VRM Animation files must be no larger than 32 MiB.');
  }
  const document = parseVrmAnimationJson(input);
  const extensionsUsed = document.extensionsUsed;
  const extensions = document.extensions;
  if (
    !Array.isArray(extensionsUsed)
    || !extensionsUsed.includes('VRMC_vrm_animation')
    || !isRecord(extensions)
    || !isRecord(extensions.VRMC_vrm_animation)
  ) {
    throw new Error('The selected file does not declare the VRMC_vrm_animation extension.');
  }
  if (!Array.isArray(document.animations) || document.animations.length === 0 || document.animations.length > 32) {
    throw new Error('The VRM Animation must contain between 1 and 32 animation clips.');
  }
  if (Array.isArray(document.nodes) && document.nodes.length > 512) {
    throw new Error('The VRM Animation contains too many scene nodes.');
  }
  if (Array.isArray(document.accessors) && document.accessors.length > 2_048) {
    throw new Error('The VRM Animation contains too many data accessors.');
  }
  assertEmbeddedResources(document);
  assertHumanoidAnimationMap(document);

  const bytes = exactArrayBuffer(input);
  const sha256 = createHash('sha256').update(input).digest('hex');
  return Object.freeze({
    assetId: `local-vrma:${sha256}`,
    fileName,
    sha256,
    sizeBytes: input.byteLength,
    bytes,
  });
}

function metadata(asset: LocalAnimationAsset): LocalAnimationMetadata {
  return Object.freeze({
    assetId: asset.assetId,
    fileName: asset.fileName,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
  });
}

export class LocalAnimationPreviewHost {
  private asset?: LocalAnimationAsset;

  private command?: LocalAnimationPlayCommand;

  private requestSequence = 0;

  private state: LocalAnimationPreviewState = initialLocalAnimationPreviewState;

  getState(): LocalAnimationPreviewState {
    return this.state;
  }

  getCurrentCommand(): LocalAnimationPlayCommand | undefined {
    if (this.state.status !== 'loading' && this.state.status !== 'playing') return undefined;
    return this.command;
  }

  select(asset: LocalAnimationAsset): LocalAnimationPlayCommand {
    this.asset = asset;
    return this.requestPlay();
  }

  requestPlay(): LocalAnimationPlayCommand {
    if (!this.asset) throw new Error('Choose a local VRM Animation before playing it.');
    this.requestSequence += 1;
    const requestId = `local-vrma-preview-${this.requestSequence}`;
    this.command = Object.freeze({ kind: 'play', requestId, asset: this.asset });
    this.state = Object.freeze({
      requestId,
      selection: metadata(this.asset),
      status: 'loading',
      message: `Preparing ${this.asset.fileName}…`,
    });
    return this.command;
  }

  report(report: LocalAnimationPreviewReport): LocalAnimationPreviewState {
    if (!this.command || report.requestId !== this.command.requestId) return this.state;
    this.state = Object.freeze({
      requestId: report.requestId,
      selection: metadata(this.command.asset),
      status: report.status,
      message: report.message.slice(0, 240),
    });
    if (report.status !== 'playing') this.command = undefined;
    return this.state;
  }

  clear(): LocalAnimationPreviewState {
    this.asset = undefined;
    this.command = undefined;
    this.state = initialLocalAnimationPreviewState;
    return this.state;
  }
}
