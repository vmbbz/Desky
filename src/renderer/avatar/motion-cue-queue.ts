export const motionCueKinds = ['emphasis', 'nod', 'wave', 'jump'] as const;

export type MotionCueKind = (typeof motionCueKinds)[number];
export type MotionCueLayer = 'gesture' | 'action';
export type MotionCueSource = 'agent' | 'conversation' | 'user';

export interface MotionCue {
  id: string;
  kind: MotionCueKind;
  layer: MotionCueLayer;
  source: MotionCueSource;
  durationSeconds: number;
  priority: number;
}

const definitions: Record<MotionCueKind, Pick<MotionCue, 'layer' | 'durationSeconds' | 'priority'>> = {
  emphasis: { layer: 'gesture', durationSeconds: 1.1, priority: 55 },
  nod: { layer: 'gesture', durationSeconds: 0.75, priority: 55 },
  wave: { layer: 'action', durationSeconds: 1.6, priority: 65 },
  jump: { layer: 'action', durationSeconds: 1.15, priority: 65 },
};

const maxPendingCues = 8;

export function createMotionCue(
  id: string,
  kind: MotionCueKind,
  source: MotionCueSource,
): MotionCue {
  if (!id || id.length > 128) throw new Error('Motion cue id is invalid');
  return Object.freeze({ id, kind, source, ...definitions[kind] });
}

export class MotionCueQueue {
  private pending: MotionCue[] = [];

  private current?: MotionCue;

  get active(): MotionCue | undefined {
    return this.current;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(cue: MotionCue): boolean {
    if (this.current?.id === cue.id || this.pending.some((candidate) => candidate.id === cue.id)) {
      return false;
    }
    if (this.pending.length >= maxPendingCues) {
      if (cue.layer !== 'action') return false;
      let replaceIndex = -1;
      for (let index = this.pending.length - 1; index >= 0; index -= 1) {
        if (this.pending[index].layer !== 'gesture') continue;
        replaceIndex = index;
        break;
      }
      if (replaceIndex < 0) return false;
      this.pending.splice(replaceIndex, 1);
    }
    this.pending.push(cue);
    return true;
  }

  startNext(statePriority: number): MotionCue | undefined {
    if (this.current) return this.current;
    let selectedIndex = -1;
    for (let index = 0; index < this.pending.length; index += 1) {
      const candidate = this.pending[index];
      if (candidate.priority < statePriority) continue;
      if (
        selectedIndex < 0 ||
        candidate.priority > this.pending[selectedIndex].priority
      ) {
        selectedIndex = index;
      }
    }
    if (selectedIndex < 0) return undefined;
    this.current = this.pending.splice(selectedIndex, 1)[0];
    return this.current;
  }

  completeActive(): MotionCue | undefined {
    const completed = this.current;
    this.current = undefined;
    return completed;
  }

  reconcileState(statePriority: number, clearAll = false): boolean {
    if (clearAll) {
      const interrupted = Boolean(this.current);
      this.clear();
      return interrupted;
    }
    const interrupted = Boolean(this.current && statePriority > this.current.priority);
    if (interrupted) this.current = undefined;
    this.pending = this.pending.filter((cue) => cue.priority >= statePriority);
    return interrupted;
  }

  clear(): void {
    this.current = undefined;
    this.pending = [];
  }
}
