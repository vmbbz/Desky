import { VRMHumanBoneName } from '@pixiv/three-vrm';

import {
  admitMotionClip,
  type MotionClipRegistration,
} from '../../src/renderer/avatar/motion-arbiter';
import type { CompanionMode } from '../../src/shared/adapter-events';
import {
  serializeCanonicalAnimationClip,
  type CanonicalAnimationClip,
} from '../../src/shared/canonical-animation';
import { sha256Hex } from '../../src/shared/asset-provenance';

export function canonicalAnimationFixture(clipId: string): CanonicalAnimationClip {
  return {
    schemaVersion: 1,
    clipId,
    durationSeconds: 1,
    sampleRate: 1,
    coordinateSpace: 'vrm1-normalized-humanoid',
    hipsTranslation: 'source-hips-height-normalized',
    tracks: [{
      bone: VRMHumanBoneName.Head,
      property: 'quaternion',
      times: [0, 1],
      values: [0, 0, 0, 1, 0, 0, 0, 1],
    }],
  };
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function admittedMotionFixture(input: {
  mode: Exclude<CompanionMode, 'cancelled'>;
  canonical?: CanonicalAnimationClip;
  clipId?: string;
  playback?: 'loop' | 'one-shot';
  crossFadeMs?: number;
  order?: number;
}): Promise<MotionClipRegistration> {
  const canonical = input.canonical ?? canonicalAnimationFixture(input.clipId ?? `${input.mode}-fixture`);
  return admitMotionClip({
    mode: input.mode,
    canonical,
    crossFadeMs: input.crossFadeMs,
    order: input.order,
    manifest: await animationManifestFixture({
      mode: input.mode,
      canonical,
      playback: input.playback,
    }),
  });
}

export async function animationManifestFixture(input: {
  mode: Exclude<CompanionMode, 'cancelled'>;
  canonical: CanonicalAnimationClip;
  playback?: 'loop' | 'one-shot';
}): Promise<Record<string, unknown>> {
  const { canonical } = input;
  const outputSha256 = await sha256Hex(
    exactArrayBuffer(serializeCanonicalAnimationClip(canonical)),
  );
  return {
    schemaVersion: 1,
    clipId: canonical.clipId,
    clipVersion: 1,
    intent: input.mode,
    layer: 'state',
    playback: input.playback ?? 'loop',
    source: {
      schemaVersion: 1,
      assetId: `animation:source/${canonical.clipId}`,
      kind: 'animation',
      sourceUrl: `https://example.com/${canonical.clipId}.fbx`,
      creator: 'Fixture Animator',
      licenseId: 'CC0-1.0',
      sha256: 'a'.repeat(64),
      fetchedAt: '2026-08-22T12:00:00.000Z',
    },
    output: {
      schemaVersion: 1,
      assetId: `animation:canonical/${canonical.clipId}:v1`,
      kind: 'animation',
      sourceUrl: `desky-asset://animations/${canonical.clipId}.json`,
      sourceProject: 'Desky test fixture',
      creator: 'Fixture Animator',
      licenseId: 'CC0-1.0',
      sha256: outputSha256,
      fetchedAt: '2026-08-22T12:01:00.000Z',
    },
    conversion: {
      tool: 'desky-animation-converter',
      toolVersion: '1.0.0',
      convertedAt: '2026-08-22T12:01:00.000Z',
      retargetProfile: 'mixamo-vrm-normalized-v1',
      rotationSpace: 'parent-rest-world',
      translationScale: 'hips-height-ratio',
      sampleRate: canonical.sampleRate,
      includeRootMotion: false,
    },
    rightsReview: {
      status: 'approved',
      reviewer: 'test-fixture',
      reviewedAt: '2026-08-22T12:02:00.000Z',
    },
  };
}
