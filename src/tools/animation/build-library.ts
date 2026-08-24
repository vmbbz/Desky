import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { CompanionMode } from '../../shared/adapter-events';
import {
  parseAnimationAssetManifest,
  type MotionIntent,
  type MotionLayer,
  type PlaybackKind,
} from '../../shared/animation-manifest';
import { createAssetProvenance, sha256Hex } from '../../shared/asset-provenance';
import { serializeCanonicalAnimationClip } from '../../shared/canonical-animation';
import { convertMixamoAnimation } from './convert-mixamo';
import {
  extractMixamoAnimationSource,
  listFbxAssetAnimationClips,
  parseFbxAsset,
} from './mixamo-source';
import type { SourceRigProfile } from './mixamo-rig';

interface BuildSource {
  sourceId: string;
  label: string;
  inputPath: string;
  sourceUrl: string;
  archiveSha256: string;
  animationSourceSha256: string;
  fetchedAt: string;
  expectedClipCount: number;
  sourceRigProfile: SourceRigProfile;
  excludedClips: string[];
  creator?: string;
  licenseId?: string;
  attribution?: string;
}

interface ClipOverride {
  sourceId: string;
  sourceClip: string;
  intent: MotionIntent;
  layer: MotionLayer;
  playback: PlaybackKind;
  label?: string;
  tags?: string[];
}

interface ClipReference {
  sourceId: string;
  sourceClip: string;
}

interface LibraryBuildPlan {
  schemaVersion: 1;
  libraryId: string;
  label: string;
  creator: string;
  licenseId: 'CC0-1.0' | 'MIXED';
  sourceUrl: string;
  generatedAt: string;
  convertedAt: string;
  rightsReviewer: string;
  reviewedAt: string;
  sampleRate: number;
  sources: BuildSource[];
  clipOverrides: ClipOverride[];
  states: Array<{
    mode: CompanionMode;
    clip: ClipReference;
    order: number;
    crossFadeMs: number;
    hipsTranslation?: 'authored' | 'preserve-target';
  }>;
  programs: Array<{
    programId: string;
    label: string;
    tags: string[];
    fallbackCue?: string;
    trigger: Record<string, unknown>;
    steps: Array<ClipReference & {
      repetitions: number;
      reverse: boolean;
      holdSeconds: number;
    }>;
  }>;
}

const idPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function slug(value: string): string {
  return value
    .split('|').at(-1)!
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function clipKey(reference: ClipReference): string {
  return `${reference.sourceId}::${reference.sourceClip}`;
}

function clipId(reference: ClipReference): string {
  const id = `${reference.sourceId}-${slug(reference.sourceClip)}-v1`;
  if (!idPattern.test(id)) throw new Error(`Generated animation clip ID is invalid: ${id}`);
  return id;
}

function sourceTags(sourceId: string, sourceClip: string, extra: string[] = []): string[] {
  const tags = [
    sourceId,
    ...slug(sourceClip).split('-').filter((tag) => tag.length > 1),
    ...extra,
  ];
  return [...new Set(tags)].slice(0, 24);
}

function readPlan(value: unknown): LibraryBuildPlan {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Unsupported animation library build plan');
  }
  if (!Array.isArray(value.sources) || !Array.isArray(value.clipOverrides) ||
      !Array.isArray(value.states) || !Array.isArray(value.programs)) {
    throw new Error('Animation library build plan is incomplete');
  }
  if (value.licenseId !== 'CC0-1.0' && value.licenseId !== 'MIXED') {
    throw new Error('Built-in animation plan must use an admitted library licence');
  }
  if (!Number.isSafeInteger(value.sampleRate) || Number(value.sampleRate) < 1 || Number(value.sampleRate) > 120) {
    throw new Error('Animation library sample rate is invalid');
  }
  return value as unknown as LibraryBuildPlan;
}

function validatePathInside(root: string, path: string, field: string): string {
  const resolved = resolve(root, path);
  const fromRoot = relative(root, resolved);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`${field} escapes the workspace root`);
  }
  return resolved;
}

async function writeAtomically(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rm(path, { force: true });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function buildAnimationLibrary(input: {
  planPath: string;
  outputPath: string;
  workspaceRoot: string;
  converterVersion: string;
}): Promise<{ clipCount: number; programCount: number; bytes: number; sha256: string }> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const planPath = validatePathInside(workspaceRoot, input.planPath, 'Animation plan path');
  const outputPath = validatePathInside(workspaceRoot, input.outputPath, 'Animation output path');
  const plan = readPlan(JSON.parse(await readFile(planPath, 'utf8')));
  const sourceLicenses = new Set(plan.sources.map((source) => source.licenseId ?? plan.licenseId));
  if (plan.licenseId === 'CC0-1.0' && [...sourceLicenses].some((license) => license !== 'CC0-1.0')) {
    throw new Error('CC0 animation plans cannot contain a differently licensed source');
  }
  if (plan.licenseId === 'MIXED' && sourceLicenses.size < 2) {
    throw new Error('Mixed animation plans require multiple source licences');
  }
  const overrideByClip = new Map(plan.clipOverrides.map((override) => [clipKey(override), override]));
  if (overrideByClip.size !== plan.clipOverrides.length) {
    throw new Error('Animation plan contains duplicate clip overrides');
  }

  const clips: Array<Record<string, unknown>> = [];
  const discovered = new Set<string>();
  const sourceArchives: Array<Record<string, unknown>> = [];

  for (const source of plan.sources) {
    if (!idPattern.test(source.sourceId) || !sha256Pattern.test(source.archiveSha256) ||
        !sha256Pattern.test(source.animationSourceSha256)) {
      throw new Error(`Animation source ${source.sourceId} has invalid identity or hashes`);
    }
    const sourcePath = validatePathInside(workspaceRoot, source.inputPath, 'Animation source path');
    const sourceCreator = source.creator ?? plan.creator;
    const sourceLicenseId = source.licenseId ?? plan.licenseId;
    const sourceAttribution = source.attribution
      ?? `${sourceCreator}; ${source.label}; ${sourceLicenseId}`;
    const sourceBytes = await readFile(sourcePath);
    const sourceBuffer = exactArrayBuffer(sourceBytes);
    const actualSourceHash = await sha256Hex(sourceBuffer);
    if (actualSourceHash !== source.animationSourceSha256) {
      throw new Error(`Animation source ${source.sourceId} checksum does not match the reviewed plan`);
    }
    const asset = parseFbxAsset(sourceBuffer);
    const inventory = listFbxAssetAnimationClips(asset);
    if (inventory.length !== source.expectedClipCount) {
      throw new Error(`Animation source ${source.sourceId} clip count drifted`);
    }
    const names = new Set(inventory.map((clip) => clip.name));
    for (const excluded of source.excludedClips) {
      if (!names.has(excluded)) throw new Error(`Excluded clip ${excluded} is absent from ${source.sourceId}`);
    }
    sourceArchives.push({
      sourceId: source.sourceId,
      label: source.label,
      sourceUrl: source.sourceUrl,
      archiveSha256: source.archiveSha256,
      animationSourceSha256: source.animationSourceSha256,
      clipCount: inventory.length,
      creator: sourceCreator,
      licenseId: sourceLicenseId,
      attribution: sourceAttribution,
    });

    for (const animation of inventory) {
      if (source.excludedClips.includes(animation.name)) continue;
      const reference = { sourceId: source.sourceId, sourceClip: animation.name };
      const identity = clipId(reference);
      if (discovered.has(identity)) throw new Error(`Generated animation clip ID collides: ${identity}`);
      discovered.add(identity);
      const override = overrideByClip.get(clipKey(reference));
      const intent = override?.intent ?? 'action';
      const layer = override?.layer ?? 'action';
      const playback = override?.playback ?? (/_Loop$/i.test(animation.name) ? 'loop' : 'one-shot');
      const sourceAnimation = extractMixamoAnimationSource(asset, {
        sourceClip: animation.name,
        sourceRigProfile: source.sourceRigProfile,
      });
      const canonical = convertMixamoAnimation(sourceAnimation, {
        clipId: identity,
        sampleRate: plan.sampleRate,
        includeRootMotion: false,
      });
      const canonicalBytes = serializeCanonicalAnimationClip(canonical);
      const sourceProvenance = await createAssetProvenance({
        assetId: `animation:source/${identity}`,
        kind: 'animation',
        sourceUrl: source.sourceUrl,
        sourceProject: `${source.label} / ${animation.name}`,
        creator: sourceCreator,
        licenseId: sourceLicenseId,
        attribution: `${sourceAttribution}; ${animation.name}`,
        bytes: sourceBuffer,
        fetchedAt: new Date(source.fetchedAt),
      });
      const outputProvenance = await createAssetProvenance({
        assetId: `animation:canonical/${identity}:v1`,
        kind: 'animation',
        sourceUrl: `desky-asset://animations/${plan.libraryId}/${identity}.json`,
        sourceProject: plan.label,
        creator: sourceCreator,
        licenseId: sourceLicenseId,
        attribution: `${sourceAttribution}; ${animation.name}`,
        bytes: exactArrayBuffer(canonicalBytes),
        fetchedAt: new Date(plan.convertedAt),
      });
      const manifest = parseAnimationAssetManifest({
        schemaVersion: 1,
        clipId: identity,
        clipVersion: 1,
        intent,
        layer,
        playback,
        source: sourceProvenance,
        output: outputProvenance,
        conversion: {
          tool: 'desky-animation-converter',
          toolVersion: input.converterVersion,
          convertedAt: plan.convertedAt,
          retargetProfile: 'mixamo-vrm-normalized-v1',
          rotationSpace: 'parent-rest-world',
          translationScale: 'hips-height-ratio',
          sampleRate: plan.sampleRate,
          includeRootMotion: false,
          sourceRigProfile: source.sourceRigProfile,
          sourceClip: animation.name,
        },
        rightsReview: {
          status: 'approved',
          reviewer: plan.rightsReviewer,
          reviewedAt: plan.reviewedAt,
        },
      });
      clips.push({
        clipId: identity,
        label: override?.label ?? animation.name.split('|').at(-1)!.replace(/_/g, ' '),
        tags: sourceTags(source.sourceId, animation.name, override?.tags),
        canonical,
        manifest,
      });
    }
  }

  for (const override of plan.clipOverrides) {
    if (!discovered.has(clipId(override))) {
      throw new Error(`Animation override references missing clip ${clipKey(override)}`);
    }
  }

  const states = plan.states.map((state) => ({
    mode: state.mode,
    clipId: clipId(state.clip),
    order: state.order,
    crossFadeMs: state.crossFadeMs,
    hipsTranslation: state.hipsTranslation ?? 'authored',
  }));
  const programs = plan.programs.map((program) => ({
    programId: program.programId,
    label: program.label,
    tags: program.tags,
    fallbackCue: program.fallbackCue,
    trigger: program.trigger,
    steps: program.steps.map((step) => ({
      clipId: clipId(step),
      repetitions: step.repetitions,
      reverse: step.reverse,
      holdSeconds: step.holdSeconds,
    })),
  }));

  const output = {
    schemaVersion: 1,
    libraryId: plan.libraryId,
    label: plan.label,
    creator: plan.creator,
    licenseId: plan.licenseId,
    sourceUrl: plan.sourceUrl,
    generatedAt: plan.generatedAt,
    sourceArchives,
    clips: clips.sort((left, right) => String(left.clipId).localeCompare(String(right.clipId))),
    states,
    programs,
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(output)}\n`);
  await writeAtomically(outputPath, bytes);
  return {
    clipCount: clips.length,
    programCount: programs.length,
    bytes: bytes.byteLength,
    sha256: await sha256Hex(exactArrayBuffer(bytes)),
  };
}
