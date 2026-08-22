import { VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import {
  AnimationMixer,
  Euler,
  LoopOnce,
  LoopRepeat,
  Quaternion,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three';

import type { CompanionMode } from '../../shared/adapter-events';
import { createVrmAnimationClip } from './create-vrm-animation-clip';
import {
  resolveMotionPlan,
  type MotionClipRegistration,
  type MotionPlan,
} from './motion-arbiter';

const controlledBones = [
  VRMHumanBoneName.Spine,
  VRMHumanBoneName.Chest,
  VRMHumanBoneName.Neck,
  VRMHumanBoneName.Head,
  VRMHumanBoneName.LeftUpperArm,
  VRMHumanBoneName.RightUpperArm,
  VRMHumanBoneName.LeftLowerArm,
  VRMHumanBoneName.RightLowerArm,
] as const;

interface BoneBaseline {
  node: Object3D;
  quaternion: Quaternion;
}

export class AvatarMotionController {
  private readonly mixer: AnimationMixer;

  private readonly rootPosition;

  private readonly rootQuaternion;

  private readonly boneBaselines = new Map<string, BoneBaseline>();

  private readonly runtimeClips = new Map<string, AnimationClip>();

  private readonly activeActions = new Set<AnimationAction>();

  private currentAction?: AnimationAction;

  private plan: MotionPlan;

  private elapsedSeconds = 0;

  private modeStartedAt = 0;

  private reducedMotion = false;

  private clipError?: string;

  constructor(
    private readonly vrm: VRM,
    private readonly avatarRoot: Object3D,
    private readonly registrations: readonly MotionClipRegistration[] = [],
  ) {
    this.mixer = new AnimationMixer(vrm.scene);
    this.rootPosition = avatarRoot.position.clone();
    this.rootQuaternion = avatarRoot.quaternion.clone();
    for (const bone of controlledBones) {
      const node = vrm.humanoid.getNormalizedBoneNode(bone);
      if (node) this.boneBaselines.set(bone, { node, quaternion: node.quaternion.clone() });
    }
    this.plan = resolveMotionPlan('idle', registrations);
    this.activatePlan(this.plan);
  }

  get currentPlan(): MotionPlan {
    return this.plan;
  }

  get lastClipError(): string | undefined {
    return this.clipError;
  }

  setMode(mode: CompanionMode): void {
    const next = resolveMotionPlan(mode, this.registrations, {
      reducedMotion: this.reducedMotion,
    });
    if (next.mode === this.plan.mode && next.reducedMotion === this.plan.reducedMotion) return;
    this.plan = next;
    this.modeStartedAt = this.elapsedSeconds;
    this.activatePlan(next);
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (this.reducedMotion === reducedMotion) return;
    this.reducedMotion = reducedMotion;
    this.plan = resolveMotionPlan(this.plan.mode, this.registrations, { reducedMotion });
    this.modeStartedAt = this.elapsedSeconds;
    this.activatePlan(this.plan);
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    this.elapsedSeconds = elapsedSeconds;
    this.mixer.update(Math.max(0, Math.min(deltaSeconds, 0.1)));
    for (const action of this.activeActions) {
      if (action !== this.currentAction && action.getEffectiveWeight() <= 0.0001) {
        action.stop();
        this.activeActions.delete(action);
      }
    }
    if (
      this.currentAction &&
      this.plan.playback === 'once' &&
      !this.currentAction.isRunning()
    ) {
      this.currentAction.stop();
      this.activeActions.delete(this.currentAction);
      this.currentAction = undefined;
      this.modeStartedAt = Math.min(this.modeStartedAt, elapsedSeconds - 2);
      this.restoreBaseline();
    }
    if (!this.currentAction) {
      this.applyProcedural(Math.max(0, elapsedSeconds - this.modeStartedAt), elapsedSeconds);
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const clip of this.runtimeClips.values()) this.mixer.uncacheClip(clip);
    this.mixer.uncacheRoot(this.vrm.scene);
    this.activeActions.clear();
    this.runtimeClips.clear();
    this.currentAction = undefined;
    this.restoreBaseline();
  }

  private activatePlan(plan: MotionPlan): void {
    if (plan.stopImmediately) {
      this.stopCurrentAction();
      this.restoreBaseline();
      return;
    }

    if (!plan.clip) {
      this.stopCurrentAction();
      this.restoreBaseline();
      return;
    }

    try {
      let clip = this.runtimeClips.get(plan.clip.canonical.clipId);
      if (!clip) {
        clip = createVrmAnimationClip(plan.clip.canonical, this.vrm);
        this.runtimeClips.set(plan.clip.canonical.clipId, clip);
      }
      const nextAction = this.mixer.clipAction(clip);
      if (nextAction === this.currentAction && nextAction.isRunning()) return;
      nextAction.reset();
      nextAction.enabled = true;
      nextAction.clampWhenFinished = plan.playback === 'once';
      nextAction.setLoop(plan.playback === 'once' ? LoopOnce : LoopRepeat, plan.playback === 'once' ? 1 : Infinity);
      nextAction.setEffectiveTimeScale(1);
      nextAction.setEffectiveWeight(1);
      nextAction.play();
      this.activeActions.add(nextAction);
      const fadeSeconds = plan.crossFadeMs / 1_000;
      if (this.currentAction && fadeSeconds > 0) {
        this.currentAction.crossFadeTo(nextAction, fadeSeconds, false);
      } else if (fadeSeconds > 0) {
        nextAction.fadeIn(fadeSeconds);
      }
      this.currentAction = nextAction;
      this.clipError = undefined;
    } catch (error) {
      this.clipError = error instanceof Error ? error.message : 'Animation clip could not be bound';
      this.stopCurrentAction();
      this.plan = resolveMotionPlan(plan.mode, [], { reducedMotion: this.reducedMotion });
      this.restoreBaseline();
    }
  }

  private stopCurrentAction(): void {
    this.mixer.stopAllAction();
    this.activeActions.clear();
    this.currentAction = undefined;
  }

  private restoreBaseline(): void {
    this.avatarRoot.position.copy(this.rootPosition);
    this.avatarRoot.quaternion.copy(this.rootQuaternion);
    for (const baseline of this.boneBaselines.values()) {
      baseline.node.quaternion.copy(baseline.quaternion);
    }
  }

  private applyBoneOffset(
    bone: string,
    x: number,
    y: number,
    z: number,
    weight: number,
  ): void {
    const baseline = this.boneBaselines.get(bone);
    if (!baseline) return;
    const offset = new Quaternion().setFromEuler(new Euler(x * weight, y * weight, z * weight));
    baseline.node.quaternion.copy(baseline.quaternion).multiply(offset);
  }

  private applyProcedural(age: number, elapsed: number): void {
    this.restoreBaseline();
    const transitionSeconds = this.plan.crossFadeMs / 1_000;
    const transition = transitionSeconds === 0
      ? 1
      : Math.min(1, age / transitionSeconds);
    const eased = transition * transition * (3 - 2 * transition);
    const weight = eased * (this.plan.reducedMotion ? 0.2 : 1);
    const time = this.plan.reducedMotion ? 0 : elapsed;

    switch (this.plan.procedural) {
      case 'offline':
        this.applyBoneOffset(VRMHumanBoneName.Head, 0.08, 0, 0, weight);
        break;
      case 'neutral':
        this.avatarRoot.position.y += Math.sin(time * 1.6) * 0.008 * weight;
        this.avatarRoot.rotation.y += Math.sin(time * 0.55) * 0.035 * weight;
        this.applyBoneOffset(VRMHumanBoneName.Head, 0, Math.sin(time * 0.55) * 0.025, 0, weight);
        break;
      case 'attentive':
        this.avatarRoot.position.y += Math.sin(time * 1.8) * 0.006 * weight;
        this.applyBoneOffset(VRMHumanBoneName.Spine, -0.025, 0, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.Head, -0.035, Math.sin(time * 0.8) * 0.018, 0, weight);
        break;
      case 'focus':
        this.avatarRoot.position.y += Math.sin(time * 2.2) * 0.01 * weight;
        this.applyBoneOffset(VRMHumanBoneName.Head, 0.02, Math.sin(time * 0.7) * 0.06, 0.045, weight);
        this.applyBoneOffset(VRMHumanBoneName.Spine, 0, Math.sin(time * 0.7) * 0.018, 0, weight);
        break;
      case 'work': {
        const beat = Math.sin(time * 3.1);
        this.avatarRoot.position.y += beat * 0.014 * weight;
        this.applyBoneOffset(VRMHumanBoneName.Spine, -0.015, beat * 0.025, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.LeftUpperArm, 0, 0, beat * 0.065, weight);
        this.applyBoneOffset(VRMHumanBoneName.RightUpperArm, 0, 0, -beat * 0.065, weight);
        break;
      }
      case 'speak': {
        const phrase = Math.sin(time * 4.2);
        this.avatarRoot.position.y += Math.sin(time * 2.1) * 0.009 * weight;
        this.applyBoneOffset(VRMHumanBoneName.Head, phrase * 0.035, Math.sin(time * 1.1) * 0.025, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.RightUpperArm, phrase * 0.035, 0, -phrase * 0.075, weight);
        break;
      }
      case 'approval':
        this.applyBoneOffset(VRMHumanBoneName.Spine, -0.018, 0, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.Head, -0.045, 0, -0.025, weight);
        break;
      case 'success': {
        const pulse = Math.sin(Math.min(1, age / 0.75) * Math.PI);
        this.avatarRoot.position.y += pulse * 0.045 * weight;
        this.applyBoneOffset(VRMHumanBoneName.LeftUpperArm, 0, 0, -pulse * 0.16, weight);
        this.applyBoneOffset(VRMHumanBoneName.RightUpperArm, 0, 0, pulse * 0.16, weight);
        break;
      }
      case 'error': {
        const recoil = Math.max(0, 1 - age / 0.7);
        this.applyBoneOffset(VRMHumanBoneName.Spine, recoil * 0.035, 0, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.Head, 0.06, 0, 0.08, weight);
        break;
      }
      case 'cancelled':
        this.applyBoneOffset(VRMHumanBoneName.Head, 0.035, 0, 0, weight);
        break;
    }
  }
}
