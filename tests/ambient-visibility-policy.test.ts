import { describe, expect, it } from 'vitest';

import { ambientVisibilityRecoveryReason } from '../src/main/ambient-visibility-policy';

const visible = {
  desiredVisible: true,
  destroyed: false,
  minimized: false,
  powerSuspended: false,
  visible: true,
};

describe('ambient visibility recovery policy', () => {
  it('recovers unexpected hiding and minimization', () => {
    expect(ambientVisibilityRecoveryReason({ ...visible, visible: false }))
      .toBe('hidden-unexpectedly');
    expect(ambientVisibilityRecoveryReason({ ...visible, minimized: true }))
      .toBe('minimized');
  });

  it('never reverses deliberate hide, suspend, destruction, or a healthy visible state', () => {
    expect(ambientVisibilityRecoveryReason({ ...visible, desiredVisible: false, visible: false }))
      .toBeUndefined();
    expect(ambientVisibilityRecoveryReason({ ...visible, powerSuspended: true, visible: false }))
      .toBeUndefined();
    expect(ambientVisibilityRecoveryReason({ ...visible, destroyed: true, visible: false }))
      .toBeUndefined();
    expect(ambientVisibilityRecoveryReason(visible)).toBeUndefined();
  });
});
