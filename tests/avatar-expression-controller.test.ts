import {
  VRMExpressionPresetName,
  type VRM,
} from '@pixiv/three-vrm';
import { describe, expect, it } from 'vitest';

import { AvatarExpressionController } from '../src/renderer/avatar/avatar-expression-controller';
import type { VrmCapabilities } from '../src/renderer/avatar/vrm-capabilities';

function capabilities(overrides: Partial<VrmCapabilities> = {}): VrmCapabilities {
  return {
    specVersion: '1',
    specLabel: 'VRM 1.0',
    requiresLegacyRotation: false,
    availableBones: [],
    missingCoreBones: [],
    availableExpressions: [],
    availableVisemes: [],
    supportsBlink: false,
    supportsLookAt: false,
    springBoneJointCount: 0,
    ...overrides,
  };
}

function expressionFixture(names: readonly string[]) {
  const values = new Map(names.map((name) => [name, 0]));
  return {
    values,
    manager: {
      getValue: (name: string) => values.get(name) ?? null,
      setValue: (name: string, value: number) => { values.set(name, value); },
    },
  };
}

describe('AvatarExpressionController', () => {
  it('drives deterministic bilateral blinking only when the avatar supports it', () => {
    const expressions = expressionFixture([
      VRMExpressionPresetName.BlinkLeft,
      VRMExpressionPresetName.BlinkRight,
    ]);
    const vrm = { expressionManager: expressions.manager } as unknown as VRM;
    const controller = new AvatarExpressionController(vrm, capabilities({
      availableExpressions: [...expressions.values.keys()],
      supportsBlink: true,
    }));

    controller.update(0.016, 3.48);

    expect(expressions.values.get(VRMExpressionPresetName.BlinkLeft)).toBeCloseTo(1, 6);
    expect(expressions.values.get(VRMExpressionPresetName.BlinkRight)).toBeCloseTo(1, 6);
  });

  it('uses available state expressions and restores their baselines on disposal', () => {
    const expressions = expressionFixture([VRMExpressionPresetName.Happy]);
    expressions.values.set(VRMExpressionPresetName.Happy, 0.1);
    const vrm = { expressionManager: expressions.manager } as unknown as VRM;
    const controller = new AvatarExpressionController(vrm, capabilities({
      availableExpressions: [VRMExpressionPresetName.Happy],
    }));

    controller.setMode('success');
    controller.update(0.016, 0.6);
    expect(expressions.values.get(VRMExpressionPresetName.Happy)).toBeCloseTo(0.42, 6);

    controller.dispose();
    expect(expressions.values.get(VRMExpressionPresetName.Happy)).toBe(0.1);
  });

  it('applies restrained look-at and neutralizes gaze for reduced motion', () => {
    const lookAt = {
      autoUpdate: true,
      target: undefined,
      yaw: 0,
      pitch: 0,
    };
    const vrm = { lookAt } as unknown as VRM;
    const controller = new AvatarExpressionController(vrm, capabilities({ supportsLookAt: true }));

    controller.update(0.016, 2);
    expect(lookAt.yaw).not.toBe(0);
    controller.setReducedMotion(true);
    controller.update(0.016, 3);
    expect(lookAt).toMatchObject({ yaw: 0, pitch: 0, autoUpdate: false, target: null });

    controller.dispose();
    expect(lookAt).toMatchObject({ yaw: 0, pitch: 0, autoUpdate: true, target: undefined });
  });

  it('degrades to a no-op when optional facial capabilities are absent', () => {
    const controller = new AvatarExpressionController({} as VRM, capabilities());
    expect(() => {
      controller.setMode('speaking');
      controller.update(0.016, 10);
      controller.dispose();
    }).not.toThrow();
  });
});
