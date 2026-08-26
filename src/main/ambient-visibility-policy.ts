export type AmbientVisibilityRecoveryReason = 'hidden-unexpectedly' | 'minimized';

export interface AmbientVisibilitySnapshot {
  desiredVisible: boolean;
  destroyed: boolean;
  minimized: boolean;
  powerSuspended: boolean;
  visible: boolean;
}

/**
 * Recovers only involuntary disappearance. Deliberate Hide and system suspend always win.
 */
export function ambientVisibilityRecoveryReason(
  snapshot: AmbientVisibilitySnapshot,
): AmbientVisibilityRecoveryReason | undefined {
  if (!snapshot.desiredVisible || snapshot.destroyed || snapshot.powerSuspended) return undefined;
  if (snapshot.minimized) return 'minimized';
  if (!snapshot.visible) return 'hidden-unexpectedly';
  return undefined;
}
