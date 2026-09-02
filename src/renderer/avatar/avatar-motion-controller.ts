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
import { isAvatarActionKind } from '../../shared/agent-actions';
import type { MotionPersonalityPolicy } from '../../shared/motion-personality';
import { AutonomousMotionScheduler } from './autonomous-motion-scheduler';
import {
  selectActionProgram,
  type AdmittedAnimationLibrary,
  type AdmittedAnimationLibraryClip,
  type AdmittedAnimationProgram,
} from './animation-library-runtime';
import { createVrmAnimationClip } from './create-vrm-animation-clip';
import {
  resolveMotionPlan,
  type MotionClipRegistration,
  type MotionPlan,
} from './motion-arbiter';
import {
  createMotionCue,
  MotionCueQueue,
  type MotionCue,
  type MotionCueKind,
  type MotionCueSource,
} from './motion-cue-queue';

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

const previewInterruptingModes: ReadonlySet<CompanionMode> = new Set([
  'approval',
  'cancelled',
  'disconnected',
  'error',
]);

const programCrossFadeSeconds = 0.22;
const programExitFadeSeconds = 0.32;

export interface MotionPreviewObserver {
  onStarted(): void;
  onEnded(result: 'completed' | 'interrupted'): void;
}

export type MotionPreviewStartResult =
  | { accepted: true }
  | { accepted: false; reason: string };

export class AvatarMotionController {
  private readonly mixer: AnimationMixer;

  private readonly rootPosition;

  private readonly rootQuaternion;

  private readonly viewYawQuaternion = new Quaternion();

  private readonly rootYawOffset = new Quaternion();

  private readonly boneBaselines = new Map<string, BoneBaseline>();

  private readonly runtimeClips = new Map<string, AnimationClip>();

  private readonly activeActions = new Set<AnimationAction>();

  private currentAction?: AnimationAction;

  private plan: MotionPlan;

  private elapsedSeconds = 0;

  private modeStartedAt = 0;

  private reducedMotion = false;

  private clipError?: string;

  private readonly cueQueue = new MotionCueQueue();

  private readonly autonomousMotion: AutonomousMotionScheduler;

  private readonly animationPrograms = new Map<string, AdmittedAnimationProgram>();

  private readonly animationLibrary?: AdmittedAnimationLibrary;

  private activeCueStartedAt?: number;

  private activeProgram?: {
    program: AdmittedAnimationProgram;
    stepIndex: number;
    action: AnimationAction;
    holdUntil?: number;
  };

  private settlingAction?: {
    action: AnimationAction;
    completeAt: number;
  };

  private cueSequence = 0;

  private preview?: {
    action: AnimationAction;
    clip: AnimationClip;
    observer: MotionPreviewObserver;
  };

  constructor(
    private readonly vrm: VRM,
    private readonly avatarRoot: Object3D,
    private readonly registrations: readonly MotionClipRegistration[] = [],
    options: {
      autonomousMotionSeed?: number;
      animationLibrary?: AdmittedAnimationLibrary;
    } = {},
  ) {
    this.mixer = new AnimationMixer(vrm.scene);
    this.rootPosition = avatarRoot.position.clone();
    this.rootQuaternion = avatarRoot.quaternion.clone();
    this.animationLibrary = options.animationLibrary;
    for (const program of options.animationLibrary?.programs ?? []) {
      this.animationPrograms.set(program.programId, program);
    }
    this.autonomousMotion = new AutonomousMotionScheduler(
      options.animationLibrary?.programs ?? [],
      options.autonomousMotionSeed,
    );
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

  get activeMotionCue(): MotionCue | undefined {
    return this.cueQueue.active;
  }

  get pendingMotionCueCount(): number {
    return this.cueQueue.pendingCount;
  }

  get runtimeDiagnostics(): {
    mode: CompanionMode;
    stateClipId?: string;
    activeProgramId?: string;
    activeCueId?: string;
    pendingCueCount: number;
    reducedMotion: boolean;
    lastClipError?: string;
  } {
    return {
      mode: this.plan.mode,
      stateClipId: this.plan.clip?.canonical.clipId,
      activeProgramId: this.activeProgram?.program.programId,
      activeCueId: this.cueQueue.active?.id,
      pendingCueCount: this.cueQueue.pendingCount,
      reducedMotion: this.reducedMotion,
      lastClipError: this.clipError,
    };
  }

  queueMotionCue(kind: MotionCueKind, source: MotionCueSource = 'user'): boolean {
    if (this.preview) return false;
    this.cueSequence += 1;
    const program = isAvatarActionKind(kind)
      ? selectActionProgram(this.animationLibrary, kind)
      : undefined;
    const localPriorityOverride = source === 'user' && this.plan.mode === 'disconnected'
      ? this.plan.priority
      : undefined;
    const cue = createMotionCue(
      `${source}-${kind}-${this.cueSequence}`,
      kind,
      source,
      program ? this.describeProgram(program) : undefined,
      localPriorityOverride,
    );
    if (this.plan.priority > cue.priority) return false;
    return this.cueQueue.enqueue(cue);
  }

  setViewYawDegrees(degrees: number): void {
    if (!Number.isFinite(degrees)) return;
    const radians = ((degrees + 180) % 360 + 360) % 360 - 180;
    this.viewYawQuaternion.setFromEuler(new Euler(0, radians * Math.PI / 180, 0));
    this.restoreBaseline();
  }

  setMode(mode: CompanionMode): void {
    const next = resolveMotionPlan(mode, this.registrations, {
      reducedMotion: this.reducedMotion,
    });
    if (next.mode === this.plan.mode && next.reducedMotion === this.plan.reducedMotion) return;
    const clearCues = mode === 'cancelled' || mode === 'approval' || mode === 'disconnected' || mode === 'error';
    if (this.preview && previewInterruptingModes.has(mode)) {
      this.endPreview('interrupted', false);
    }
    const interrupted = this.cueQueue.reconcileState(next.priority, clearCues);
    if (interrupted) {
      this.stopCurrentAction();
      this.activeCueStartedAt = undefined;
      this.restoreBaseline();
    }
    this.plan = next;
    this.modeStartedAt = this.elapsedSeconds;
    if (!this.cueQueue.active && !this.preview) this.activatePlan(next);
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (this.reducedMotion === reducedMotion) return;
    this.reducedMotion = reducedMotion;
    if (reducedMotion && this.preview) this.endPreview('interrupted', false);
    if (reducedMotion && (this.activeProgram || this.settlingAction)) this.stopCurrentAction();
    this.plan = resolveMotionPlan(this.plan.mode, this.registrations, { reducedMotion });
    this.modeStartedAt = this.elapsedSeconds;
    if (!this.cueQueue.active && !this.preview) this.activatePlan(this.plan);
  }

  setMotionPersonality(policy: MotionPersonalityPolicy): void {
    this.autonomousMotion.setPolicy(policy);
  }

  playPreviewClip(
    clip: AnimationClip,
    observer: MotionPreviewObserver,
  ): MotionPreviewStartResult {
    if (this.reducedMotion) {
      return { accepted: false, reason: 'Animation preview is paused by the system reduced-motion setting.' };
    }
    if (this.plan.mode === 'approval') {
      return { accepted: false, reason: `Animation preview is blocked while Deskii is ${this.plan.mode}.` };
    }
    if (!Number.isFinite(clip.duration) || clip.duration <= 0 || clip.tracks.length === 0) {
      return { accepted: false, reason: 'The VRM Animation has no playable tracks.' };
    }
    if (this.preview) this.endPreview('interrupted', false);
    this.cueQueue.clear();
    this.activeCueStartedAt = undefined;
    this.stopCurrentAction();
    this.restoreBaseline();
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.enabled = true;
    action.clampWhenFinished = false;
    action.setLoop(LoopOnce, 1);
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.play();
    this.activeActions.add(action);
    this.currentAction = action;
    this.preview = { action, clip, observer };
    observer.onStarted();
    return { accepted: true };
  }

  stopPreview(): void {
    if (!this.preview) return;
    this.endPreview('interrupted', true);
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
    if (this.preview) {
      this.autonomousMotion.update(elapsedSeconds, undefined);
      if (this.preview.action.isRunning()) return;
      this.endPreview('completed', true);
      return;
    }
    if (this.settlingAction) {
      this.autonomousMotion.update(elapsedSeconds, undefined);
      if (elapsedSeconds < this.settlingAction.completeAt) return;
      this.finishSettlingAction(elapsedSeconds);
    }
    const autonomousProgram = this.autonomousMotion.update(
      elapsedSeconds,
      !this.reducedMotion
        && !this.cueQueue.active
        && this.cueQueue.pendingCount === 0
        ? this.plan.mode
        : undefined,
    );
    if (autonomousProgram) this.queueAnimationProgram(autonomousProgram, 'ambient');
    const cue = this.cueQueue.startNext(this.plan.priority);
    if (cue && this.activeCueStartedAt === undefined) {
      this.activeCueStartedAt = elapsedSeconds;
      if (cue.programId && !this.reducedMotion) {
        this.startAnimationProgram(cue.programId);
      } else {
        this.stopCurrentAction();
        this.restoreBaseline();
      }
    }
    if (cue && this.activeCueStartedAt !== undefined) {
      if (this.activeProgram) {
        if (this.advanceAnimationProgram(elapsedSeconds)) return;
        this.completeActiveCue(elapsedSeconds);
        return;
      }
      const age = Math.max(0, elapsedSeconds - this.activeCueStartedAt);
      if (age < cue.durationSeconds) {
        this.applyMotionCue(cue, age);
        return;
      }
      this.completeActiveCue(elapsedSeconds);
      return;
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
    if (this.preview) this.endPreview('interrupted', false);
    this.mixer.stopAllAction();
    for (const clip of this.runtimeClips.values()) this.mixer.uncacheClip(clip);
    this.mixer.uncacheRoot(this.vrm.scene);
    this.activeActions.clear();
    this.runtimeClips.clear();
    this.currentAction = undefined;
    this.cueQueue.clear();
    this.activeProgram = undefined;
    this.settlingAction = undefined;
    this.activeCueStartedAt = undefined;
    this.restoreBaseline();
  }

  private describeProgram(program: AdmittedAnimationProgram): {
    programId: string;
    durationSeconds: number;
  } {
    const durationSeconds = program.steps.reduce(
      (total, step) => total + step.clip.canonical.durationSeconds * step.repetitions + step.holdSeconds,
      0,
    );
    return { programId: program.programId, durationSeconds };
  }

  private queueAnimationProgram(
    program: AdmittedAnimationProgram,
    source: MotionCueSource,
  ): boolean {
    if (!program.fallbackCue || this.preview) return false;
    this.cueSequence += 1;
    const cue = createMotionCue(
      `${source}-${program.programId}-${this.cueSequence}`,
      program.fallbackCue,
      source,
      this.describeProgram(program),
      this.plan.priority,
    );
    if (this.plan.priority > cue.priority) return false;
    return this.cueQueue.enqueue(cue);
  }

  private runtimeClip(
    definition: AdmittedAnimationLibraryClip,
    hipsTranslation: 'authored' | 'preserve-target' = 'authored',
  ): AnimationClip {
    const cacheKey = `${definition.clipId}:${hipsTranslation}`;
    let clip = this.runtimeClips.get(cacheKey);
    if (!clip) {
      clip = createVrmAnimationClip(definition.canonical, this.vrm, { hipsTranslation });
      this.runtimeClips.set(cacheKey, clip);
    }
    return clip;
  }

  private startAnimationProgram(programId: string): void {
    const program = this.animationPrograms.get(programId);
    if (!program) return;
    try {
      const outgoingAction = this.currentAction;
      if (!outgoingAction) this.restoreBaseline();
      const action = this.startAnimationProgramStep(program, 0, outgoingAction);
      this.activeProgram = { program, stepIndex: 0, action };
      this.clipError = undefined;
    } catch (error) {
      this.clipError = error instanceof Error ? error.message : 'Animation program could not be bound';
      this.stopCurrentAction();
    }
  }

  private startAnimationProgramStep(
    program: AdmittedAnimationProgram,
    stepIndex: number,
    outgoingAction?: AnimationAction,
  ): AnimationAction {
    const step = program.steps[stepIndex];
    if (!step) throw new Error(`Animation program ${program.programId} has no playable step`);
    const clip = this.runtimeClip(step.clip);
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.enabled = true;
    action.clampWhenFinished = true;
    action.setLoop(step.repetitions > 1 ? LoopRepeat : LoopOnce, step.repetitions);
    action.setEffectiveTimeScale(step.reverse ? -1 : 1);
    action.setEffectiveWeight(1);
    if (step.reverse) action.time = clip.duration;
    action.play();
    this.activeActions.add(action);
    if (outgoingAction && outgoingAction !== action) {
      outgoingAction.crossFadeTo(action, programCrossFadeSeconds, false);
    } else {
      action.fadeIn(programCrossFadeSeconds);
    }
    this.currentAction = action;
    return action;
  }

  /** Returns true while another program step or hold remains active. */
  private advanceAnimationProgram(elapsedSeconds: number): boolean {
    const active = this.activeProgram;
    if (!active) return false;
    if (active.action.isRunning()) return true;
    const step = active.program.steps[active.stepIndex];
    if (step.holdSeconds > 0) {
      active.holdUntil ??= elapsedSeconds + step.holdSeconds;
      if (elapsedSeconds < active.holdUntil) return true;
    }
    const nextStepIndex = active.stepIndex + 1;
    if (nextStepIndex >= active.program.steps.length) {
      this.activeProgram = undefined;
      return false;
    }
    try {
      const action = this.startAnimationProgramStep(
        active.program,
        nextStepIndex,
        active.action,
      );
      this.activeProgram = {
        program: active.program,
        stepIndex: nextStepIndex,
        action,
      };
      return true;
    } catch (error) {
      this.clipError = error instanceof Error ? error.message : 'Animation program step failed';
      this.stopCurrentAction();
      return false;
    }
  }

  private stopActiveProgram(): void {
    const active = this.activeProgram;
    if (!active) return;
    active.action.stop();
    this.activeActions.delete(active.action);
    if (this.currentAction === active.action) this.currentAction = undefined;
    this.activeProgram = undefined;
  }

  private completeActiveCue(elapsedSeconds: number): void {
    const outgoingAction = this.currentAction;
    this.activeProgram = undefined;
    this.cueQueue.completeActive();
    this.activeCueStartedAt = undefined;
    this.modeStartedAt = elapsedSeconds;
    if (this.plan.clip) {
      this.activatePlan(this.plan);
      return;
    }
    if (outgoingAction) {
      outgoingAction.fadeOut(programExitFadeSeconds);
      this.settlingAction = {
        action: outgoingAction,
        completeAt: elapsedSeconds + programExitFadeSeconds,
      };
      return;
    }
    this.restoreBaseline();
    this.activatePlan(this.plan);
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
      const clip = this.runtimeClip({
        clipId: plan.clip.canonical.clipId,
        label: plan.clip.canonical.clipId,
        tags: [],
        canonical: plan.clip.canonical,
      }, plan.clip.hipsTranslation);
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
    this.stopActiveProgram();
    this.mixer.stopAllAction();
    this.activeActions.clear();
    this.currentAction = undefined;
    this.settlingAction = undefined;
  }

  private finishSettlingAction(elapsedSeconds: number): void {
    const settling = this.settlingAction;
    if (!settling) return;
    settling.action.stop();
    this.activeActions.delete(settling.action);
    if (this.currentAction === settling.action) this.currentAction = undefined;
    this.settlingAction = undefined;
    this.modeStartedAt = elapsedSeconds;
    this.restoreBaseline();
  }

  private endPreview(result: 'completed' | 'interrupted', reactivatePlan: boolean): void {
    const preview = this.preview;
    if (!preview) return;
    preview.action.stop();
    this.activeActions.delete(preview.action);
    if (this.currentAction === preview.action) this.currentAction = undefined;
    this.mixer.uncacheClip(preview.clip);
    this.preview = undefined;
    this.restoreBaseline();
    preview.observer.onEnded(result);
    if (reactivatePlan) {
      this.modeStartedAt = this.elapsedSeconds;
      this.activatePlan(this.plan);
    }
  }

  private restoreBaseline(): void {
    this.avatarRoot.position.copy(this.rootPosition);
    this.avatarRoot.quaternion.copy(this.rootQuaternion).multiply(this.viewYawQuaternion);
    for (const baseline of this.boneBaselines.values()) {
      baseline.node.quaternion.copy(baseline.quaternion);
    }
  }

  private applyRootYaw(radians: number): void {
    this.rootYawOffset.setFromEuler(new Euler(0, radians, 0));
    this.avatarRoot.quaternion.multiply(this.rootYawOffset);
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
        this.applyRootYaw(Math.sin(time * 0.55) * 0.035 * weight);
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

  private applyMotionCue(cue: MotionCue, age: number): void {
    this.restoreBaseline();
    const progress = Math.max(0, Math.min(age / cue.durationSeconds, 1));
    const envelope = Math.sin(progress * Math.PI);
    const motionTime = this.reducedMotion ? 0.5 : progress;
    const weight = this.reducedMotion ? 0.18 : 1;

    switch (cue.kind) {
      case 'emphasis': {
        const beat = Math.sin(motionTime * Math.PI * 2) * envelope;
        this.applyBoneOffset(VRMHumanBoneName.Spine, -0.02 * envelope, 0.04 * beat, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.Head, 0.035 * beat, -0.025 * beat, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.RightUpperArm, 0.04 * envelope, 0, -0.22 * envelope, weight);
        break;
      }
      case 'nod': {
        const nod = Math.sin(motionTime * Math.PI * 2) * envelope;
        this.applyBoneOffset(VRMHumanBoneName.Neck, 0.13 * nod, 0, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.Head, 0.09 * nod, 0, 0, weight);
        break;
      }
      case 'look-around': {
        const turn = Math.sin(progress * Math.PI * 2) * envelope;
        this.applyRootYaw(turn * 0.24 * weight);
        this.applyBoneOffset(VRMHumanBoneName.Spine, 0, turn * 0.06, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.Head, 0, turn * 0.22, 0.025 * envelope, weight);
        break;
      }
      case 'weight-shift': {
        const shift = Math.sin(progress * Math.PI * 2) * envelope;
        if (!this.reducedMotion) this.avatarRoot.position.x += shift * 0.045;
        this.applyBoneOffset(VRMHumanBoneName.Spine, 0, shift * 0.055, shift * 0.075, weight);
        this.applyBoneOffset(VRMHumanBoneName.Head, 0, -shift * 0.045, -shift * 0.035, weight);
        this.applyBoneOffset(VRMHumanBoneName.LeftUpperArm, 0, 0, -shift * 0.055, weight);
        this.applyBoneOffset(VRMHumanBoneName.RightUpperArm, 0, 0, -shift * 0.055, weight);
        break;
      }
      case 'stretch': {
        const reach = Math.sin(progress * Math.PI) * envelope;
        if (!this.reducedMotion) this.avatarRoot.position.y += reach * 0.035;
        this.applyBoneOffset(VRMHumanBoneName.Spine, -reach * 0.055, 0, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.LeftUpperArm, -reach * 0.12, 0, -reach * 0.42, weight);
        this.applyBoneOffset(VRMHumanBoneName.RightUpperArm, -reach * 0.12, 0, reach * 0.42, weight);
        this.applyBoneOffset(VRMHumanBoneName.Head, -reach * 0.04, 0, 0, weight);
        break;
      }
      case 'ambient-wave': {
        const wave = Math.sin(motionTime * Math.PI * 4) * envelope;
        this.applyBoneOffset(VRMHumanBoneName.RightUpperArm, -0.1 * envelope, 0, -0.38 * envelope, weight);
        this.applyBoneOffset(VRMHumanBoneName.RightLowerArm, 0, 0.12 * wave, -0.34 * envelope, weight);
        this.applyBoneOffset(VRMHumanBoneName.Head, 0, -0.05 * envelope, 0.02 * wave, weight);
        break;
      }
      case 'wave': {
        const wave = Math.sin(motionTime * Math.PI * 6) * envelope;
        this.applyBoneOffset(VRMHumanBoneName.RightUpperArm, -0.14 * envelope, 0, -0.52 * envelope, weight);
        this.applyBoneOffset(VRMHumanBoneName.RightLowerArm, 0, 0.16 * wave, -0.48 * envelope, weight);
        this.applyBoneOffset(VRMHumanBoneName.Head, 0, -0.07 * envelope, 0.025 * wave, weight);
        break;
      }
      case 'jump': {
        if (!this.reducedMotion) this.avatarRoot.position.y += envelope * 0.18;
        this.applyBoneOffset(VRMHumanBoneName.Spine, -0.06 * envelope, 0, 0, weight);
        this.applyBoneOffset(VRMHumanBoneName.LeftUpperArm, 0, 0, -0.32 * envelope, weight);
        this.applyBoneOffset(VRMHumanBoneName.RightUpperArm, 0, 0, 0.32 * envelope, weight);
        break;
      }
    }
  }
}
