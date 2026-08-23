import type { CompanionMode } from '../../shared/adapter-events';
import type { AdmittedAnimationProgram } from './animation-library-runtime';

export class AutonomousMotionScheduler {
  private state: number;

  private nextProgram?: AdmittedAnimationProgram;

  private nextProgramAt?: number;

  private previousProgramId?: string;

  private readonly lastPlayedAt = new Map<string, number>();

  constructor(
    private readonly programs: readonly AdmittedAnimationProgram[],
    seed = 0xD35C_0001,
  ) {
    this.state = seed >>> 0 || 1;
  }

  update(
    elapsedSeconds: number,
    mode: CompanionMode | undefined,
  ): AdmittedAnimationProgram | undefined {
    if (!mode) {
      this.resetQuietInterval();
      return undefined;
    }
    const eligible = this.programs.filter(
      (program) => program.trigger.kind === 'ambient' && program.trigger.modes.includes(mode),
    );
    if (eligible.length === 0) {
      this.resetQuietInterval();
      return undefined;
    }
    if (!this.nextProgram || this.nextProgramAt === undefined) {
      this.schedule(elapsedSeconds, eligible);
      return undefined;
    }
    if (elapsedSeconds < this.nextProgramAt) return undefined;

    const selected = this.nextProgram;
    this.lastPlayedAt.set(selected.programId, elapsedSeconds);
    this.previousProgramId = selected.programId;
    this.nextProgram = undefined;
    this.nextProgramAt = undefined;
    return selected;
  }

  private resetQuietInterval(): void {
    this.nextProgram = undefined;
    this.nextProgramAt = undefined;
  }

  private schedule(
    elapsedSeconds: number,
    eligible: readonly AdmittedAnimationProgram[],
  ): void {
    let candidates = eligible.filter((program) => {
      if (eligible.length > 1 && program.programId === this.previousProgramId) return false;
      if (program.trigger.kind !== 'ambient') return false;
      const lastPlayedAt = this.lastPlayedAt.get(program.programId);
      return lastPlayedAt === undefined || elapsedSeconds - lastPlayedAt >= program.trigger.cooldownSeconds;
    });
    if (candidates.length === 0) {
      candidates = eligible.filter((program) => program.programId !== this.previousProgramId);
    }
    if (candidates.length === 0) candidates = [...eligible];

    const totalWeight = candidates.reduce(
      (sum, program) => sum + (program.trigger.kind === 'ambient' ? program.trigger.weight : 0),
      0,
    );
    let selection = this.random() * totalWeight;
    let selected = candidates[candidates.length - 1];
    for (const candidate of candidates) {
      selection -= candidate.trigger.kind === 'ambient' ? candidate.trigger.weight : 0;
      if (selection > 0) continue;
      selected = candidate;
      break;
    }
    if (selected.trigger.kind !== 'ambient') return;
    this.nextProgram = selected;
    this.nextProgramAt = elapsedSeconds
      + selected.trigger.minimumQuietSeconds
      + this.random() * (selected.trigger.maximumQuietSeconds - selected.trigger.minimumQuietSeconds);
  }

  private random(): number {
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
}
