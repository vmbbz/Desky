import type { MotionCueKind } from './motion-cue-queue';

const autonomousKinds = [
  'look-around',
  'weight-shift',
  'stretch',
  'ambient-wave',
] as const satisfies readonly MotionCueKind[];

const minimumDelaySeconds = 4.5;
const delayRangeSeconds = 5.5;

export class AutonomousMotionScheduler {
  private state: number;

  private nextCueAt?: number;

  private previousKind?: MotionCueKind;

  constructor(seed = 0xD35C_0001) {
    this.state = seed >>> 0 || 1;
  }

  update(elapsedSeconds: number, enabled: boolean): MotionCueKind | undefined {
    if (!enabled) {
      this.nextCueAt = undefined;
      return undefined;
    }
    if (this.nextCueAt === undefined) {
      this.nextCueAt = elapsedSeconds + this.nextDelay();
      return undefined;
    }
    if (elapsedSeconds < this.nextCueAt) return undefined;

    let kind = autonomousKinds[Math.floor(this.random() * autonomousKinds.length)];
    if (kind === this.previousKind) {
      kind = autonomousKinds[(autonomousKinds.indexOf(kind) + 1) % autonomousKinds.length];
    }
    this.previousKind = kind;
    this.nextCueAt = elapsedSeconds + this.nextDelay();
    return kind;
  }

  private random(): number {
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return this.state / 0x1_0000_0000;
  }

  private nextDelay(): number {
    return minimumDelaySeconds + this.random() * delayRangeSeconds;
  }
}
