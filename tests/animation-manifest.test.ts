import { describe, expect, it } from 'vitest';

import { parseAnimationAssetManifest } from '../src/shared/animation-manifest';

const sourceProvenance = {
  schemaVersion: 1,
  assetId: 'animation:source/wave',
  kind: 'animation',
  sourceUrl: 'https://example.com/source/wave.fbx',
  creator: 'Example Animator',
  licenseId: 'CC0-1.0',
  sha256: 'a'.repeat(64),
  fetchedAt: '2026-08-22T12:00:00.000Z',
};

const outputProvenance = {
  schemaVersion: 1,
  assetId: 'animation:clip/wave-v1',
  kind: 'animation',
  sourceUrl: 'desky-asset://animations/wave-v1.json',
  sourceProject: 'Desky animation pipeline',
  licenseId: 'CC0-1.0',
  sha256: 'b'.repeat(64),
  fetchedAt: '2026-08-22T12:01:00.000Z',
};

function validManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    clipId: 'wave-v1',
    clipVersion: 1,
    intent: 'action',
    layer: 'action',
    playback: 'one-shot',
    source: sourceProvenance,
    output: outputProvenance,
    conversion: {
      tool: '@desky/animation-converter',
      toolVersion: '1.0.0',
      convertedAt: '2026-08-22T12:01:00.000Z',
      retargetProfile: 'mixamo-vrm-normalized-v1',
      rotationSpace: 'parent-rest-world',
      translationScale: 'hips-height-ratio',
      sampleRate: 30,
      includeRootMotion: false,
    },
    rightsReview: {
      status: 'approved',
      reviewer: 'release-owner',
      reviewedAt: '2026-08-22T12:02:00.000Z',
    },
    reducedMotionAlternative: 'neutral-v1',
  };
}

describe('animation asset manifest', () => {
  it('accepts the versioned retargeting and provenance contract', () => {
    expect(parseAnimationAssetManifest(validManifest())).toMatchObject({
      clipId: 'wave-v1',
      intent: 'action',
      playback: 'one-shot',
      conversion: {
        retargetProfile: 'mixamo-vrm-normalized-v1',
        rotationSpace: 'parent-rest-world',
        translationScale: 'hips-height-ratio',
      },
      rightsReview: { status: 'approved' },
    });
  });

  it('rejects an unapproved animation even when the bytes are identified', () => {
    const manifest = validManifest();
    manifest.rightsReview = {
      status: 'pending',
      reviewer: 'release-owner',
      reviewedAt: '2026-08-22T12:02:00.000Z',
    };

    expect(() => parseAnimationAssetManifest(manifest)).toThrow(
      'Animation rights review is not approved',
    );
  });

  it('rejects drift from the pinned retargeting formula', () => {
    const manifest = validManifest();
    manifest.conversion = {
      ...(manifest.conversion as Record<string, unknown>),
      translationScale: 'unscaled',
    };

    expect(() => parseAnimationAssetManifest(manifest)).toThrow(
      'Unsupported animation retargeting contract',
    );
  });

  it('supports state intents added by the motion arbiter but excludes cancellation clips', () => {
    const approval = validManifest();
    approval.intent = 'approval';
    approval.layer = 'state';
    approval.playback = 'loop';
    expect(parseAnimationAssetManifest(approval).intent).toBe('approval');

    const cancelled = validManifest();
    cancelled.intent = 'cancelled';
    expect(() => parseAnimationAssetManifest(cancelled)).toThrow(/intent/i);
  });
});
