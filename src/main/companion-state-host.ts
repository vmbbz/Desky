import type { AdapterEvent } from '../shared/adapter-events';
import {
  initialCompanionDraftSnapshot,
  initialCompanionSnapshot,
  reduceCompanionSnapshot,
  type CompanionDraftSnapshot,
  type CompanionSnapshot,
} from '../shared/companion-state';

export class CompanionStateHost {
  private snapshot = initialCompanionSnapshot;
  private draft = initialCompanionDraftSnapshot;

  getSnapshot(): CompanionSnapshot {
    return this.snapshot;
  }

  applyEvent(event: AdapterEvent): CompanionSnapshot {
    this.snapshot = reduceCompanionSnapshot(this.snapshot, event);
    return this.snapshot;
  }

  getDraft(): CompanionDraftSnapshot {
    return this.draft;
  }

  setDraft(text: string): CompanionDraftSnapshot {
    this.draft = {
      revision: this.draft.revision + 1,
      text,
    };
    return this.draft;
  }
}
