import { describe, expect, it } from 'vitest';

import type { AdmittedAnimationProgram } from '../src/renderer/avatar/animation-library-runtime';
import { AutonomousMotionScheduler } from '../src/renderer/avatar/autonomous-motion-scheduler';

function ambientProgram(
  programId: string,
  options: {
    modes?: ('idle' | 'disconnected')[];
    weight?: number;
    minimum?: number;
    maximum?: number;
    cooldown?: number;
    cycle?: { id: string; length: number; slots: number[] };
  } = {},
): AdmittedAnimationProgram {
  return {
    programId,
    label: programId,
    tags: ['idle'],
    fallbackCue: 'weight-shift',
    trigger: {
      kind: 'ambient',
      modes: options.modes ?? ['idle'],
      weight: options.weight ?? 1,
      minimumQuietSeconds: options.minimum ?? 4.5,
      maximumQuietSeconds: options.maximum ?? 10,
      cooldownSeconds: options.cooldown ?? 20,
      cycle: options.cycle,
    },
    steps: [],
  };
}

describe('AutonomousMotionScheduler', () => {
  it('uses file-defined timing and avoids immediate program repeats', () => {
    const scheduler = new AutonomousMotionScheduler([
      ambientProgram('look-around'),
      ambientProgram('phone-check'),
    ], 42);
    expect(scheduler.update(0, 'idle')).toBeUndefined();
    let first: AdmittedAnimationProgram | undefined;
    let firstAt = 0;
    for (let second = 1; second <= 11; second += 1) {
      first = scheduler.update(second, 'idle');
      if (first) {
        firstAt = second;
        break;
      }
    }
    expect(firstAt).toBeGreaterThanOrEqual(5);
    expect(firstAt).toBeLessThanOrEqual(11);

    let second: AdmittedAnimationProgram | undefined;
    for (let elapsed = firstAt + 1; elapsed <= firstAt + 11; elapsed += 1) {
      second = scheduler.update(elapsed, 'idle');
      if (second) break;
    }
    expect(second).toBeDefined();
    expect(second?.programId).not.toBe(first?.programId);
  });

  it('restarts the quiet interval when autonomous motion is disabled', () => {
    const scheduler = new AutonomousMotionScheduler([
      ambientProgram('idle-break'),
    ], 7);
    scheduler.update(0, 'idle');
    scheduler.update(20, undefined);
    expect(scheduler.update(20, 'idle')).toBeUndefined();
    expect(scheduler.update(24, 'idle')).toBeUndefined();
  });

  it('does not schedule a program outside its declared companion mode', () => {
    const scheduler = new AutonomousMotionScheduler([
      ambientProgram('idle-only', { minimum: 1, maximum: 1 }),
    ], 9);
    expect(scheduler.update(0, 'working')).toBeUndefined();
    expect(scheduler.update(30, 'working')).toBeUndefined();
  });

  it('can keep an offline companion alive when the file admits disconnected mode', () => {
    const scheduler = new AutonomousMotionScheduler([
      ambientProgram('offline-break', { modes: ['disconnected'], minimum: 1, maximum: 1 }),
    ], 12);
    expect(scheduler.update(0, 'disconnected')).toBeUndefined();
    expect(scheduler.update(1, 'disconnected')?.programId).toBe('offline-break');
  });

  it('follows an exact file-defined cadence with repeated primary slots', () => {
    const cycle = { id: 'primary-idle', length: 3 };
    const scheduler = new AutonomousMotionScheduler([
      ambientProgram('long-look-around', {
        minimum: 1,
        maximum: 1,
        cycle: { ...cycle, slots: [0, 1] },
      }),
      ambientProgram('celebration-fist-pump', {
        minimum: 1,
        maximum: 1,
        cycle: { ...cycle, slots: [2] },
      }),
    ], 42);

    const selected: string[] = [];
    for (let second = 0; second <= 6; second += 1) {
      const program = scheduler.update(second, 'idle');
      if (program) selected.push(program.programId);
    }
    expect(selected).toEqual([
      'long-look-around',
      'long-look-around',
      'celebration-fist-pump',
    ]);
  });
});
