import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import { Group, Quaternion } from 'three';
import { describe, expect, it } from 'vitest';

import { AvatarMotionController } from '../src/renderer/avatar/avatar-motion-controller';
import type { CanonicalAnimationClip } from '../src/shared/canonical-animation';
import { admittedMotionFixture } from './fixtures/animation';

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
    expect(head.quaternion.equals(baseline)).toBe(true);
    expect(fixture.root.position.y).toBeCloseTo(0, 8);
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
});
