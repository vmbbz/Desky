import { VRMHumanBoneName } from '@pixiv/three-vrm';

import {
  admitMotionClip,
  type MotionClipRegistration,
} from '../../src/renderer/avatar/motion-arbiter';
import {
  admitAnimationLibrary,
  type AdmittedAnimationLibrary,
} from '../../src/renderer/avatar/animation-library-runtime';
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

export async function admittedAnimationLibraryFixture(input: {
  trigger?: 'ambient' | 'jump';
  clipId?: string;
  durationSeconds?: number;
} = {}): Promise<AdmittedAnimationLibrary> {
  const clipId = input.clipId ?? 'library-motion-fixture';
  const canonical = canonicalAnimationFixture(clipId);
  canonical.durationSeconds = input.durationSeconds ?? 1;
  canonical.tracks[0].times = [0, canonical.durationSeconds];
  canonical.tracks[0].values = [0, 0, 0, 1, 0, Math.sin(0.2), 0, Math.cos(0.2)];
  const manifest = await animationManifestFixture({ mode: 'idle', canonical });
  manifest.intent = 'action';
  manifest.layer = input.trigger === 'jump' ? 'action' : 'gesture';
  manifest.playback = 'one-shot';
  return admitAnimationLibrary({
    schemaVersion: 1,
    libraryId: 'fixture-library',
    label: 'Fixture animation library',
    creator: 'Fixture Animator',
    licenseId: 'CC0-1.0',
    sourceUrl: 'https://example.com/fixture-library',
    generatedAt: '2026-08-22T12:03:00.000Z',
    sourceArchives: [{
      sourceId: 'fixture-source',
      label: 'Fixture source',
      sourceUrl: 'https://example.com/fixture-library',
      archiveSha256: 'b'.repeat(64),
      animationSourceSha256: 'a'.repeat(64),
      clipCount: 1,
    }],
    clips: [{
      clipId,
      label: 'Fixture clip',
      tags: ['fixture'],
      canonical,
      manifest,
    }],
    states: [],
    programs: [{
      programId: input.trigger === 'jump' ? 'fixture-jump' : 'fixture-ambient',
      label: 'Fixture program',
      tags: ['fixture'],
      fallbackCue: input.trigger === 'jump' ? 'jump' : 'weight-shift',
      trigger: input.trigger === 'jump'
        ? { kind: 'action', action: 'jump', order: 0 }
        : {
            kind: 'ambient',
            modes: ['idle'],
            weight: 1,
            minimumQuietSeconds: 1,
            maximumQuietSeconds: 1,
            cooldownSeconds: 1,
          },
      steps: [{ clipId, repetitions: 1, reverse: false, holdSeconds: 0 }],
    }],
  });
}
