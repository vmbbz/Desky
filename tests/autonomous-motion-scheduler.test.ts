import { describe, expect, it } from 'vitest';

import { AutonomousMotionScheduler } from '../src/renderer/avatar/autonomous-motion-scheduler';

describe('AutonomousMotionScheduler', () => {
  it('waits within a bounded interval and avoids immediate repeats', () => {
    const scheduler = new AutonomousMotionScheduler(42);
    expect(scheduler.update(0, true)).toBeUndefined();
    let first: string | undefined;
    let firstAt = 0;
    for (let second = 1; second <= 11; second += 1) {
      first = scheduler.update(second, true);
      if (first) {
        firstAt = second;
        break;
      }
    }
    expect(firstAt).toBeGreaterThanOrEqual(5);
    expect(firstAt).toBeLessThanOrEqual(11);

    let secondKind: string | undefined;
    for (let second = firstAt + 1; second <= firstAt + 11; second += 1) {
      secondKind = scheduler.update(second, true);
      if (secondKind) break;
    }
    expect(secondKind).toBeDefined();
    expect(secondKind).not.toBe(first);
  });

  it('restarts its quiet interval when autonomous motion is disabled', () => {
    const scheduler = new AutonomousMotionScheduler(7);
    scheduler.update(0, true);
    scheduler.update(20, false);
    expect(scheduler.update(20, true)).toBeUndefined();
    expect(scheduler.update(24, true)).toBeUndefined();
  });
});
