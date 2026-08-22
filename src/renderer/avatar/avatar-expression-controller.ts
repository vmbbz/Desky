import {
  VRMExpressionPresetName,
  type VRM,
} from '@pixiv/three-vrm';
import type { Object3D } from 'three';

import type { CompanionMode } from '../../shared/adapter-events';
import type { VrmCapabilities } from './vrm-capabilities';

const blinkDurationSeconds = 0.16;
const blinkIntervals = [3.4, 4.8, 3.9, 5.1] as const;
const managedExpressions = [
  VRMExpressionPresetName.Blink,
  VRMExpressionPresetName.BlinkLeft,
  VRMExpressionPresetName.BlinkRight,
  VRMExpressionPresetName.Happy,
  VRMExpressionPresetName.Sad,
  VRMExpressionPresetName.Surprised,
  VRMExpressionPresetName.Relaxed,
] as const;

interface LookAtBaseline {
  autoUpdate: boolean;
  pitch: number;
  target: Object3D | null | undefined;
  yaw: number;
}

export class AvatarExpressionController {
  private mode: CompanionMode = 'idle';

  private elapsedSeconds = 0;

  private modeStartedAt = 0;

  private reducedMotion = false;

  private nextBlinkAt = blinkIntervals[0];

  private blinkIntervalIndex = 0;

  private readonly expressionBaselines = new Map<string, number>();

  private readonly availableExpressions: ReadonlySet<string>;

  private readonly lookAtBaseline?: LookAtBaseline;

  constructor(
    private readonly vrm: VRM,
    private readonly capabilities: VrmCapabilities,
  ) {
    this.availableExpressions = new Set(capabilities.availableExpressions);
    for (const expression of managedExpressions) {
      if (!this.availableExpressions.has(expression)) continue;
      this.expressionBaselines.set(expression, vrm.expressionManager?.getValue(expression) ?? 0);
    }
    if (capabilities.supportsLookAt && vrm.lookAt) {
      this.lookAtBaseline = {
        autoUpdate: vrm.lookAt.autoUpdate,
        pitch: vrm.lookAt.pitch,
        target: vrm.lookAt.target,
        yaw: vrm.lookAt.yaw,
      };
      vrm.lookAt.autoUpdate = false;
      vrm.lookAt.target = null;
    }
  }

  setMode(mode: CompanionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.modeStartedAt = this.elapsedSeconds;
  }

  setReducedMotion(reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
  }

  update(_deltaSeconds: number, elapsedSeconds: number): void {
    this.elapsedSeconds = elapsedSeconds;
    this.restoreExpressions();
    this.applyStateExpression(Math.max(0, elapsedSeconds - this.modeStartedAt));
    this.applyBlink(elapsedSeconds);
    this.applyLookAt(elapsedSeconds);
  }

  dispose(): void {
    this.restoreExpressions();
    if (this.vrm.lookAt && this.lookAtBaseline) {
      this.vrm.lookAt.autoUpdate = this.lookAtBaseline.autoUpdate;
      this.vrm.lookAt.target = this.lookAtBaseline.target;
      this.vrm.lookAt.yaw = this.lookAtBaseline.yaw;
      this.vrm.lookAt.pitch = this.lookAtBaseline.pitch;
    }
  }

  private setExpression(name: string, value: number): void {
    if (!this.availableExpressions.has(name)) return;
    this.vrm.expressionManager?.setValue(name, Math.max(0, Math.min(value, 1)));
  }

  private restoreExpressions(): void {
    for (const [name, value] of this.expressionBaselines) this.setExpression(name, value);
  }

  private setStateExpression(name: string, value: number): void {
    this.setExpression(name, Math.max(this.expressionBaselines.get(name) ?? 0, value));
  }

  private applyStateExpression(age: number): void {
    switch (this.mode) {
      case 'idle':
        this.setStateExpression(VRMExpressionPresetName.Relaxed, 0.045);
        break;
      case 'listening':
        this.setStateExpression(VRMExpressionPresetName.Surprised, 0.055);
        break;
      case 'speaking':
        this.setStateExpression(VRMExpressionPresetName.Relaxed, 0.075);
        break;
      case 'success': {
        const acknowledgement = Math.sin(Math.min(age / 1.2, 1) * Math.PI);
        this.setStateExpression(VRMExpressionPresetName.Happy, acknowledgement * 0.42);
        break;
      }
      case 'approval':
        this.setStateExpression(VRMExpressionPresetName.Surprised, 0.18);
        break;
      case 'error':
        this.setStateExpression(VRMExpressionPresetName.Sad, 0.28);
        break;
      case 'cancelled':
        this.setStateExpression(VRMExpressionPresetName.Sad, 0.12);
        break;
      case 'disconnected':
      case 'thinking':
      case 'working':
        break;
    }
  }

  private applyBlink(elapsedSeconds: number): void {
    if (!this.capabilities.supportsBlink) return;
    while (elapsedSeconds > this.nextBlinkAt + blinkDurationSeconds) {
      this.blinkIntervalIndex = (this.blinkIntervalIndex + 1) % blinkIntervals.length;
      this.nextBlinkAt += blinkDurationSeconds + blinkIntervals[this.blinkIntervalIndex];
    }
    const phase = (elapsedSeconds - this.nextBlinkAt) / blinkDurationSeconds;
    if (phase < 0 || phase > 1) return;
    const weight = Math.sin(phase * Math.PI) ** 6;
    if (this.availableExpressions.has(VRMExpressionPresetName.Blink)) {
      this.setStateExpression(VRMExpressionPresetName.Blink, weight);
      return;
    }
    this.setStateExpression(VRMExpressionPresetName.BlinkLeft, weight);
    this.setStateExpression(VRMExpressionPresetName.BlinkRight, weight);
  }

  private applyLookAt(elapsedSeconds: number): void {
    if (!this.capabilities.supportsLookAt || !this.vrm.lookAt || !this.lookAtBaseline) return;
    if (this.reducedMotion) {
      this.vrm.lookAt.yaw = 0;
      this.vrm.lookAt.pitch = 0;
      return;
    }
    let yaw = 0;
    let pitch = 0;
    switch (this.mode) {
      case 'idle':
        yaw = Math.sin(elapsedSeconds * 0.35) * 3;
        pitch = Math.sin(elapsedSeconds * 0.22) * 1;
        break;
      case 'listening':
        pitch = -1;
        break;
      case 'thinking':
        yaw = -2.5;
        pitch = 1.5;
        break;
      case 'working':
        yaw = 2;
        pitch = 2;
        break;
      case 'speaking':
        yaw = Math.sin(elapsedSeconds * 0.7) * 2.2;
        pitch = Math.sin(elapsedSeconds * 0.45) * 0.8;
        break;
      case 'success':
        pitch = -1.5;
        break;
      case 'approval':
      case 'cancelled':
      case 'disconnected':
      case 'error':
        break;
    }
    this.vrm.lookAt.yaw = yaw;
    this.vrm.lookAt.pitch = pitch;
  }
}
