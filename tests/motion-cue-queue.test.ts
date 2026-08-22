import { describe, expect, it } from 'vitest';

import {
  createMotionCue,
  MotionCueQueue,
} from '../src/renderer/avatar/motion-cue-queue';

describe('MotionCueQueue', () => {
  it('selects the highest-priority eligible cue while preserving FIFO ties', () => {
    const queue = new MotionCueQueue();
    queue.enqueue(createMotionCue('gesture-1', 'emphasis', 'conversation'));
    queue.enqueue(createMotionCue('gesture-2', 'nod', 'conversation'));
    queue.enqueue(createMotionCue('action-1', 'wave', 'user'));

    expect(queue.startNext(10)?.id).toBe('action-1');
    queue.completeActive();
    expect(queue.startNext(10)?.id).toBe('gesture-1');
  });

  it('deduplicates requests and bounds pending work without dropping an action for a gesture', () => {
    const queue = new MotionCueQueue();
    const first = createMotionCue('same', 'nod', 'conversation');
    expect(queue.enqueue(first)).toBe(true);
    expect(queue.enqueue(first)).toBe(false);
    for (let index = 1; index < 8; index += 1) {
      expect(queue.enqueue(createMotionCue(`gesture-${index}`, 'emphasis', 'conversation'))).toBe(true);
    }
    expect(queue.pendingCount).toBe(8);
    expect(queue.enqueue(createMotionCue('overflow-gesture', 'nod', 'conversation'))).toBe(false);
    expect(queue.enqueue(createMotionCue('user-action', 'jump', 'user'))).toBe(true);
    expect(queue.pendingCount).toBe(8);
    expect(queue.startNext(10)?.id).toBe('user-action');
  });

  it('lets authoritative state priority interrupt and discard lower-priority cues', () => {
    const queue = new MotionCueQueue();
    queue.enqueue(createMotionCue('action', 'wave', 'user'));
    expect(queue.startNext(10)?.id).toBe('action');

    expect(queue.reconcileState(60)).toBe(false);
    expect(queue.active?.id).toBe('action');
    expect(queue.reconcileState(95)).toBe(true);
    expect(queue.active).toBeUndefined();
    expect(queue.pendingCount).toBe(0);
  });

  it('clears every cue on a hard terminal or approval boundary', () => {
    const queue = new MotionCueQueue();
    queue.enqueue(createMotionCue('gesture', 'emphasis', 'conversation'));
    queue.startNext(10);
    queue.enqueue(createMotionCue('action', 'jump', 'user'));

    expect(queue.reconcileState(100, true)).toBe(true);
    expect(queue.active).toBeUndefined();
    expect(queue.pendingCount).toBe(0);
  });
});
