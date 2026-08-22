import {
  parseAssetProvenance,
  type AssetProvenance,
} from './asset-provenance';

export const motionIntents = [
  'idle',
  'thinking',
  'working',
  'speaking',
  'success',
  'error',
  'action',
] as const;

export const motionLayers = ['baseline', 'state', 'gesture', 'action'] as const;
export const playbackKinds = ['loop', 'one-shot'] as const;

export type MotionIntent = (typeof motionIntents)[number];
export type MotionLayer = (typeof motionLayers)[number];
export type PlaybackKind = (typeof playbackKinds)[number];

export interface AnimationAssetManifest {
  schemaVersion: 1;
  clipId: string;
  clipVersion: number;
  intent: MotionIntent;
  layer: MotionLayer;
  playback: PlaybackKind;
  source: AssetProvenance;
  output: AssetProvenance;
  conversion: {
    tool: string;
    toolVersion: string;
    convertedAt: string;
    retargetProfile: 'mixamo-vrm-normalized-v1';
    rotationSpace: 'parent-rest-world';
    translationScale: 'hips-height-ratio';
    sampleRate: number;
    includeRootMotion: boolean;
  };
  rightsReview: {
    status: 'approved';
    reviewer: string;
    reviewedAt: string;
  };
  reducedMotionAlternative?: string;
}

const clipIdPattern = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maximumLength = 200): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumLength;
}

function parseIsoTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`Invalid animation manifest ${field}`);
  }
  return value;
}

export function parseAnimationAssetManifest(value: unknown): AnimationAssetManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Unsupported animation manifest schema');
  }
  if (typeof value.clipId !== 'string' || !clipIdPattern.test(value.clipId)) {
    throw new Error('Invalid animation manifest clipId');
  }
  if (!Number.isSafeInteger(value.clipVersion) || Number(value.clipVersion) < 1) {
    throw new Error('Invalid animation manifest clipVersion');
  }
  if (!motionIntents.includes(value.intent as MotionIntent)) {
    throw new Error('Invalid animation manifest intent');
  }
  if (!motionLayers.includes(value.layer as MotionLayer)) {
    throw new Error('Invalid animation manifest layer');
  }
  if (!playbackKinds.includes(value.playback as PlaybackKind)) {
    throw new Error('Invalid animation manifest playback');
  }

  const source = parseAssetProvenance(value.source);
  const output = parseAssetProvenance(value.output);
  if (source.kind !== 'animation' || output.kind !== 'animation') {
    throw new Error('Animation manifests require animation provenance');
  }

  const conversion = value.conversion;
  if (!isRecord(conversion)) throw new Error('Invalid animation manifest conversion');
  if (!isNonEmptyString(conversion.tool) || !isNonEmptyString(conversion.toolVersion)) {
    throw new Error('Invalid animation converter identity');
  }
  if (
    conversion.retargetProfile !== 'mixamo-vrm-normalized-v1' ||
    conversion.rotationSpace !== 'parent-rest-world' ||
    conversion.translationScale !== 'hips-height-ratio'
  ) {
    throw new Error('Unsupported animation retargeting contract');
  }
  if (
    !Number.isInteger(conversion.sampleRate) ||
    Number(conversion.sampleRate) < 1 ||
    Number(conversion.sampleRate) > 120
  ) {
    throw new Error('Invalid animation sample rate');
  }
  if (typeof conversion.includeRootMotion !== 'boolean') {
    throw new Error('Invalid animation root-motion policy');
  }

  const rightsReview = value.rightsReview;
  if (
    !isRecord(rightsReview) ||
    rightsReview.status !== 'approved' ||
    !isNonEmptyString(rightsReview.reviewer)
  ) {
    throw new Error('Animation rights review is not approved');
  }

  const reducedMotionAlternative = value.reducedMotionAlternative;
  if (
    reducedMotionAlternative !== undefined &&
    (typeof reducedMotionAlternative !== 'string' ||
      !clipIdPattern.test(reducedMotionAlternative))
  ) {
    throw new Error('Invalid reduced-motion alternative');
  }

  return {
    schemaVersion: 1,
    clipId: value.clipId,
    clipVersion: Number(value.clipVersion),
    intent: value.intent as MotionIntent,
    layer: value.layer as MotionLayer,
    playback: value.playback as PlaybackKind,
    source,
    output,
    conversion: {
      tool: conversion.tool,
      toolVersion: conversion.toolVersion,
      convertedAt: parseIsoTimestamp(conversion.convertedAt, 'convertedAt'),
      retargetProfile: 'mixamo-vrm-normalized-v1',
      rotationSpace: 'parent-rest-world',
      translationScale: 'hips-height-ratio',
      sampleRate: Number(conversion.sampleRate),
      includeRootMotion: conversion.includeRootMotion,
    },
    rightsReview: {
      status: 'approved',
      reviewer: rightsReview.reviewer,
      reviewedAt: parseIsoTimestamp(rightsReview.reviewedAt, 'reviewedAt'),
    },
    reducedMotionAlternative,
  };
}
