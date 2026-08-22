import { describe, expect, it } from 'vitest';

import {
  admitMotionClip,
  motionPriority,
  resolveMotionPlan,
} from '../src/renderer/avatar/motion-arbiter';
import { companionModes } from '../src/shared/adapter-events';
import {
  admittedMotionFixture,
  animationManifestFixture,
  canonicalAnimationFixture,
} from './fixtures/animation';

describe('motion arbiter', () => {
  it('defines a deterministic fallback for every companion state', () => {
    for (const mode of companionModes) {
      const plan = resolveMotionPlan(mode);
      expect(plan.mode).toBe(mode);
      expect(plan.priority).toBe(motionPriority(mode));
      expect(plan.procedural).toBeTruthy();
      expect(plan.crossFadeMs).toBeGreaterThanOrEqual(0);
      expect(plan.crossFadeMs).toBeLessThanOrEqual(1_000);
    }
  });

  it('gives cancellation, approval, and disconnection authoritative priority', () => {
    expect(resolveMotionPlan(['working', 'disconnected']).mode).toBe('disconnected');
    expect(resolveMotionPlan(['disconnected', 'approval']).mode).toBe('approval');
    const cancelled = resolveMotionPlan(['approval', 'cancelled', 'success']);
    expect(cancelled).toMatchObject({
      mode: 'cancelled',
      stopImmediately: true,
      crossFadeMs: 0,
      clip: undefined,
    });
  });

  it('selects an exact state clip by order and then stable clip id', async () => {
    const registrations = await Promise.all([
      admittedMotionFixture({ mode: 'working', clipId: 'work-z', order: 2 }),
      admittedMotionFixture({ mode: 'working', clipId: 'work-b', order: 1 }),
      admittedMotionFixture({ mode: 'working', clipId: 'work-a', order: 1, crossFadeMs: 233 }),
      admittedMotionFixture({ mode: 'speaking', clipId: 'speak-a' }),
    ]);
    expect(resolveMotionPlan('working', registrations)).toMatchObject({
      mode: 'working',
      crossFadeMs: 233,
      clip: { canonical: { clipId: 'work-a' } },
    });
    expect(Object.isFrozen(registrations[0].canonical)).toBe(true);
    expect(Object.isFrozen(registrations[0].canonical.tracks[0].values)).toBe(true);
  });

  it('suppresses full animation clips under reduced-motion preference', async () => {
    const plan = resolveMotionPlan(
      'working',
      [await admittedMotionFixture({ mode: 'working', clipId: 'work-a' })],
      { reducedMotion: true },
    );
    expect(plan).toMatchObject({
      mode: 'working',
      reducedMotion: true,
      crossFadeMs: 0,
      clip: undefined,
    });
  });

  it('refuses a clip whose canonical bytes do not match approved output provenance', async () => {
    const canonical = canonicalAnimationFixture('work-a');
    const manifest = await animationManifestFixture({ mode: 'working', canonical });
    (manifest.output as Record<string, unknown>).sha256 = 'b'.repeat(64);

    await expect(admitMotionClip({
      mode: 'working',
      canonical,
      manifest,
    })).rejects.toThrow(/checksum/i);
  });

  it('refuses semantic mismatch and full-body cancellation clips', async () => {
    const canonical = canonicalAnimationFixture('work-a');
    const manifest = await animationManifestFixture({ mode: 'working', canonical });
    manifest.intent = 'speaking';
    await expect(admitMotionClip({
      mode: 'working',
      canonical,
      manifest,
    })).rejects.toThrow(/intent/i);
    await expect(admitMotionClip({
      mode: 'cancelled',
      canonical,
      manifest,
    })).rejects.toThrow(/cancelled/i);
  });
});
