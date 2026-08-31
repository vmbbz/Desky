import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { AnimationClip, Euler, Group, Quaternion, QuaternionKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';

import { AvatarMotionController } from '../src/renderer/avatar/avatar-motion-controller';
import type { CanonicalAnimationClip } from '../src/shared/canonical-animation';
import {
  admittedAnimationLibraryFixture,
  admittedMotionFixture,
} from './fixtures/animation';

interface VrmFixture {
  vrm: VRM;
  root: Group;
  bones: Map<string, Group>;
}

function createVrmFixture(): VrmFixture {
  const root = new Group();
  root.name = 'avatarRoot';
  const bones = new Map<string, Group>();
  for (const boneName of Object.values(VRMHumanBoneName)) {
    const node = new Group();
    node.name = `normalized-${boneName}`;
    bones.set(boneName, node);
    root.add(node);
  }
  const vrm = {
    scene: root,
    meta: { metaVersion: '1' },
    humanoid: {
      normalizedRestPose: { hips: { position: [0, 1.5, 0] } },
      getNormalizedBoneNode: (boneName: string) => bones.get(boneName) ?? null,
    },
  } as VRM;
  return { vrm, root, bones };
}

function headClip(): CanonicalAnimationClip {
  const halfAngle = 0.15;
  return {
    schemaVersion: 1,
    clipId: 'head-focus-v1',
    durationSeconds: 1,
    sampleRate: 1,
    coordinateSpace: 'vrm1-normalized-humanoid',
    hipsTranslation: 'source-hips-height-normalized',
    tracks: [{
      bone: VRMHumanBoneName.Head,
      property: 'quaternion',
      times: [0, 1],
      values: [0, 0, 0, 1, 0, Math.sin(halfAngle), 0, Math.cos(halfAngle)],
    }],
  };
}

describe('AvatarMotionController', () => {
  it('maps semantic state changes to deterministic procedural poses', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);
    const leftArm = fixture.bones.get(VRMHumanBoneName.LeftUpperArm)!;
    const baselineArm = leftArm.quaternion.clone();

    controller.update(0.016, 1);
    expect(fixture.root.position.y).not.toBe(0);

    controller.setMode('working');
    controller.update(0.016, 2);
    expect(leftArm.quaternion.equals(baselineArm)).toBe(false);

    controller.setMode('cancelled');
    expect(fixture.root.position.y).toBe(0);
    expect(leftArm.quaternion.equals(baselineArm)).toBe(true);
    controller.update(0.016, 2.5);
    const cancelledPose = fixture.bones.get(VRMHumanBoneName.Head)!.quaternion.clone();
    controller.update(0.016, 20);
    expect(fixture.root.position.y).toBe(0);
    expect(fixture.bones.get(VRMHumanBoneName.Head)!.quaternion.equals(cancelledPose)).toBe(true);
  });

  it('binds a registered canonical clip through the mixer', async () => {
    const fixture = createVrmFixture();
    const registration = await admittedMotionFixture({
      mode: 'thinking',
      canonical: headClip(),
      crossFadeMs: 0,
    });
    const controller = new AvatarMotionController(fixture.vrm, fixture.root, [registration]);
    const head = fixture.bones.get(VRMHumanBoneName.Head)!;
    const baseline = head.quaternion.clone();

    controller.setMode('thinking');
    controller.update(0.5, 0.5);

    expect(controller.currentPlan.clip?.canonical.clipId).toBe('head-focus-v1');
    expect(head.quaternion.equals(baseline)).toBe(false);
  });

  it('settles a one-shot clip instead of holding or replaying it indefinitely', async () => {
    const fixture = createVrmFixture();
    const registration = await admittedMotionFixture({
      mode: 'success',
      canonical: headClip(),
      playback: 'one-shot',
      crossFadeMs: 0,
    });
    const controller = new AvatarMotionController(fixture.vrm, fixture.root, [registration]);
    const head = fixture.bones.get(VRMHumanBoneName.Head)!;
    const baseline = head.quaternion.clone();

    controller.setMode('success');
    for (let frame = 1; frame <= 12; frame += 1) {
      controller.update(0.1, frame / 10);
    }

    expect(controller.currentPlan.playback).toBe('once');
    expect(head.quaternion.angleTo(baseline)).toBeLessThan(1e-8);
    expect(fixture.root.position.y).toBeCloseTo(0, 8);
  });

  it('keeps an admitted living idle clip active after a successful reply', async () => {
    const fixture = createVrmFixture();
    const idle = await admittedMotionFixture({
      mode: 'idle',
      canonical: headClip(),
      crossFadeMs: 180,
    });
    const controller = new AvatarMotionController(fixture.vrm, fixture.root, [idle]);

    controller.setMode('speaking');
    controller.setMode('success');

    expect(controller.currentPlan.mode).toBe('success');
    expect(controller.currentPlan.clip?.canonical.clipId).toBe('head-focus-v1');
    expect(controller.currentPlan.playback).toBe('loop');
  });

  it('uses a stable low-motion pose when reduced motion is requested', async () => {
    const fixture = createVrmFixture();
    const registration = await admittedMotionFixture({
      mode: 'working',
      canonical: headClip(),
    });
    const controller = new AvatarMotionController(fixture.vrm, fixture.root, [registration]);
    controller.setReducedMotion(true);
    controller.setMode('working');
    controller.update(0.016, 2);
    const first = fixture.bones.get(VRMHumanBoneName.Spine)!.quaternion.clone();
    controller.update(0.016, 20);

    expect(controller.currentPlan.clip).toBeUndefined();
    expect(fixture.bones.get(VRMHumanBoneName.Spine)!.quaternion.equals(first)).toBe(true);
    expect(fixture.root.position.y).toBe(0);
  });

  it('fails safely to the procedural plan when a clip cannot bind to the target avatar', async () => {
    const fixture = createVrmFixture();
    const registration = await admittedMotionFixture({
      mode: 'thinking',
      canonical: headClip(),
    });
    fixture.bones.delete(VRMHumanBoneName.Head);
    const controller = new AvatarMotionController(fixture.vrm, fixture.root, [registration]);

    controller.setMode('thinking');

    expect(controller.currentPlan.clip).toBeUndefined();
    expect(controller.lastClipError).toMatch(/supported/i);
    expect(() => controller.update(0.016, 1)).not.toThrow();
  });

  it('restores controlled transforms on disposal', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);
    const baseline = new Quaternion().copy(
      fixture.bones.get(VRMHumanBoneName.LeftUpperArm)!.quaternion,
    );
    controller.setMode('working');
    controller.update(0.016, 1);
    controller.dispose();
    expect(fixture.bones.get(VRMHumanBoneName.LeftUpperArm)!.quaternion.equals(baseline)).toBe(true);
  });

  it('preserves an explicit view rotation across procedural baseline restores', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);
    const expected = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));

    controller.setViewYawDegrees(90);
    controller.update(0.016, 1);
    expect(fixture.root.quaternion.angleTo(expected)).toBeLessThan(0.05);

    controller.queueMotionCue('jump');
    controller.update(0.016, 2);
    controller.update(0.1, 3.3);
    expect(fixture.root.quaternion.angleTo(expected)).toBeLessThan(0.05);
  });

  it('plans autonomous motion from admitted files and lets attentive state interrupt it', async () => {
    const fixture = createVrmFixture();
    const animationLibrary = await admittedAnimationLibraryFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root, [], {
      autonomousMotionSeed: 42,
      animationLibrary,
    });
    controller.update(0.016, 0);
    for (let second = 1; second <= 11 && !controller.activeMotionCue; second += 1) {
      controller.update(0.1, second);
    }

    expect(controller.activeMotionCue).toMatchObject({
      source: 'ambient',
      programId: 'fixture-ambient',
    });
    controller.setMode('listening');
    expect(controller.activeMotionCue).toBeUndefined();
    expect(controller.pendingMotionCueCount).toBe(0);
    expect(controller.currentPlan.mode).toBe('listening');
  });

  it('keeps speaking on its authored state clip without a procedural interruption', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);

    controller.setMode('speaking');
    expect(controller.pendingMotionCueCount).toBe(0);
    controller.update(0.016, 0.1);
    expect(controller.activeMotionCue).toBeUndefined();
    expect(controller.currentPlan.mode).toBe('speaking');
  });

  it('runs a user action as the temporary body owner and lets approval interrupt it', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);

    expect(controller.queueMotionCue('jump')).toBe(true);
    controller.update(0.016, 0);
    controller.update(0.1, 0.5);
    expect(controller.activeMotionCue?.kind).toBe('jump');
    expect(fixture.root.position.y).toBeGreaterThan(0);

    controller.setMode('working');
    expect(controller.activeMotionCue?.kind).toBe('jump');
    controller.setMode('approval');
    expect(controller.activeMotionCue).toBeUndefined();
    expect(controller.pendingMotionCueCount).toBe(0);
    expect(fixture.root.position.y).toBe(0);
  });

  it('resolves an explicit action through the admitted file program before using its fallback', async () => {
    const fixture = createVrmFixture();
    const animationLibrary = await admittedAnimationLibraryFixture({ trigger: 'jump' });
    const controller = new AvatarMotionController(fixture.vrm, fixture.root, [], {
      animationLibrary,
    });
    const head = fixture.bones.get(VRMHumanBoneName.Head)!;
    const baseline = head.quaternion.clone();

    expect(controller.queueMotionCue('jump')).toBe(true);
    controller.update(0.016, 0);
    controller.update(0.25, 0.25);

    expect(controller.activeMotionCue?.programId).toBe('fixture-jump');
    expect(controller.lastClipError).toBeUndefined();
    expect(head.quaternion.equals(baseline)).toBe(false);
    expect(fixture.root.position.y).toBe(0);

    controller.setMode('approval');
    expect(controller.activeMotionCue).toBeUndefined();
    expect(head.quaternion.angleTo(baseline)).toBeLessThan(1e-8);
  });

  it('plays the full authored duration and eases back without a final-pose snap', async () => {
    const fixture = createVrmFixture();
    const animationLibrary = await admittedAnimationLibraryFixture({
      trigger: 'jump',
      durationSeconds: 1,
    });
    const controller = new AvatarMotionController(fixture.vrm, fixture.root, [], {
      animationLibrary,
    });
    const head = fixture.bones.get(VRMHumanBoneName.Head)!;
    const baseline = head.quaternion.clone();

    expect(controller.queueMotionCue('jump')).toBe(true);
    controller.update(0.016, 0);
    for (let frame = 1; frame <= 9; frame += 1) {
      controller.update(0.1, frame / 10);
    }

    expect(controller.activeMotionCue?.programId).toBe('fixture-jump');
    expect(head.quaternion.angleTo(baseline)).toBeGreaterThan(0.05);

    controller.update(0.1, 1);
    controller.update(0.1, 1.1);
    expect(controller.activeMotionCue).toBeUndefined();
    const settlingAngle = head.quaternion.angleTo(baseline);
    expect(settlingAngle).toBeGreaterThan(0.01);

    controller.update(0.1, 1.2);
    controller.update(0.1, 1.3);
    controller.update(0.1, 1.4);
    controller.update(0.1, 1.5);
    expect(head.quaternion.angleTo(baseline)).toBeLessThan(1e-8);
  });

  it('crossfades adjacent authored steps instead of cutting through the bind pose', async () => {
    const fixture = createVrmFixture();
    const animationLibrary = await admittedAnimationLibraryFixture({
      trigger: 'jump',
      durationSeconds: 0.5,
      stepCount: 2,
    });
    const controller = new AvatarMotionController(fixture.vrm, fixture.root, [], {
      animationLibrary,
    });
    const head = fixture.bones.get(VRMHumanBoneName.Head)!;
    const baseline = head.quaternion.clone();

    expect(controller.queueMotionCue('jump')).toBe(true);
    controller.update(0.016, 0);
    for (let frame = 1; frame <= 4; frame += 1) {
      controller.update(0.1, frame / 10);
    }
    controller.update(0.1, 0.5);

    expect(controller.activeMotionCue?.programId).toBe('fixture-jump');
    expect(head.quaternion.angleTo(baseline)).toBeGreaterThan(0.15);

    controller.update(0.05, 0.55);
    expect(head.quaternion.angleTo(baseline)).toBeGreaterThan(0.1);
  });

  it('keeps local Jump available before a gateway session is selected', async () => {
    const fixture = createVrmFixture();
    const animationLibrary = await admittedAnimationLibraryFixture({ trigger: 'jump' });
    const controller = new AvatarMotionController(fixture.vrm, fixture.root, [], {
      animationLibrary,
    });

    controller.setMode('disconnected');
    expect(controller.queueMotionCue('jump', 'user')).toBe(true);
    controller.update(0.016, 0);
    expect(controller.activeMotionCue?.programId).toBe('fixture-jump');
    expect(controller.lastClipError).toBeUndefined();
  });

  it('acknowledges a queued action without travel under reduced motion', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);
    controller.setReducedMotion(true);
    controller.queueMotionCue('jump');

    controller.update(0.016, 0);
    controller.update(0.1, 0.5);

    expect(controller.activeMotionCue?.kind).toBe('jump');
    expect(fixture.root.position.y).toBe(0);
    expect(fixture.bones.get(VRMHumanBoneName.Spine)!.quaternion.equals(new Quaternion())).toBe(false);
  });

  it('rejects a new action while an authoritative state owns the body', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);
    controller.setMode('approval');

    expect(controller.queueMotionCue('wave')).toBe(false);
    expect(controller.pendingMotionCueCount).toBe(0);
  });

  it('restores the accepted state baseline after an action completes', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);
    controller.queueMotionCue('jump');

    controller.update(0.016, 0);
    controller.update(0.1, 1.3);

    expect(controller.activeMotionCue).toBeUndefined();
    expect(controller.currentPlan.mode).toBe('idle');
    expect(fixture.root.position.y).toBe(0);
  });

  it('plays a local VRMA clip through the same mixer and restores state afterward', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);
    const head = fixture.bones.get(VRMHumanBoneName.Head)!;
    const baseline = head.quaternion.clone();
    const halfAngle = 0.2;
    const clip = new AnimationClip('local-preview', 0.3, [
      new QuaternionKeyframeTrack(
        `${head.name}.quaternion`,
        [0, 0.3],
        [0, 0, 0, 1, 0, Math.sin(halfAngle), 0, Math.cos(halfAngle)],
      ),
    ]);
    const lifecycle: string[] = [];
    let restoredAngle = Number.POSITIVE_INFINITY;

    expect(controller.playPreviewClip(clip, {
      onStarted: () => lifecycle.push('started'),
      onEnded: (result) => {
        lifecycle.push(result);
        restoredAngle = head.quaternion.angleTo(baseline);
      },
    })).toEqual({ accepted: true });
    controller.update(0.1, 0.1);
    expect(head.quaternion.equals(baseline)).toBe(false);
    controller.update(0.1, 0.2);
    controller.update(0.1, 0.3);
    controller.update(0.1, 0.4);

    expect(lifecycle).toEqual(['started', 'completed']);
    expect(restoredAngle).toBeLessThan(1e-8);
    expect(controller.currentPlan.mode).toBe('idle');
  });

  it('does not let a local animation preview override approval or reduced-motion policy', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);
    const clip = new AnimationClip('local-preview', 1, [
      new QuaternionKeyframeTrack(
        `${fixture.bones.get(VRMHumanBoneName.Head)!.name}.quaternion`,
        [0, 1],
        [0, 0, 0, 1, 0, 0, 0, 1],
      ),
    ]);
    const observer = { onStarted: () => undefined, onEnded: () => undefined };

    controller.setMode('approval');
    expect(controller.playPreviewClip(clip, observer)).toMatchObject({ accepted: false });
    controller.setMode('idle');
    controller.setReducedMotion(true);
    expect(controller.playPreviewClip(clip, observer)).toMatchObject({ accepted: false });
  });

  it.each(['approval', 'cancelled', 'disconnected', 'error'] as const)(
    'interrupts an active local preview when %s becomes authoritative',
    (mode) => {
      const fixture = createVrmFixture();
      const controller = new AvatarMotionController(fixture.vrm, fixture.root);
      const head = fixture.bones.get(VRMHumanBoneName.Head)!;
      const baseline = head.quaternion.clone();
      const halfAngle = 0.2;
      const clip = new AnimationClip('local-preview', 10, [
        new QuaternionKeyframeTrack(
          `${head.name}.quaternion`,
          [0, 10],
          [0, 0, 0, 1, 0, Math.sin(halfAngle), 0, Math.cos(halfAngle)],
        ),
      ]);
      const lifecycle: string[] = [];

      expect(controller.playPreviewClip(clip, {
        onStarted: () => lifecycle.push('started'),
        onEnded: (result) => lifecycle.push(result),
      })).toEqual({ accepted: true });
      controller.update(1, 1);
      expect(head.quaternion.angleTo(baseline)).toBeGreaterThan(0.001);

      controller.setMode(mode);

      expect(lifecycle).toEqual(['started', 'interrupted']);
      expect(controller.currentPlan.mode).toBe(mode);
      expect(head.quaternion.angleTo(baseline)).toBeLessThan(1e-8);
      expect(fixture.root.position.y).toBe(0);
    },
  );

  it('allows an explicit local preview from a stable offline state', () => {
    const fixture = createVrmFixture();
    const controller = new AvatarMotionController(fixture.vrm, fixture.root);
    const head = fixture.bones.get(VRMHumanBoneName.Head)!;
    const clip = new AnimationClip('local-preview', 1, [
      new QuaternionKeyframeTrack(
        `${head.name}.quaternion`,
        [0, 1],
        [0, 0, 0, 1, 0, 0, 0, 1],
      ),
    ]);

    controller.setMode('disconnected');
    expect(controller.playPreviewClip(clip, {
      onStarted: () => undefined,
      onEnded: () => undefined,
    })).toEqual({ accepted: true });
  });
});
