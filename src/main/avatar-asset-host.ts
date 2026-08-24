import type {
  AvatarLoadReport,
  AvatarRuntimeDescriptor,
  AvatarSelectionState,
  SelectedAvatarAsset,
} from '../shared/avatar-assets';
import { defaultAvatarRevisionId } from '../shared/avatar-assets';
import { evaluateFreeEntitlement } from '../shared/avatar-marketplace';
import {
  getAdmittedAvatarRevisionByAvatarId,
  getAdmittedAvatarRevisionByRevisionId,
  type AdmittedAvatarRevision,
} from './marketplace-catalog';

export interface PersistedAvatarSelection {
  activeRevisionId: string;
  fallbackRevisionId: string;
}

type SelectionListener = (state: AvatarSelectionState) => void;

export interface AvatarRevisionCache {
  get(revision: AdmittedAvatarRevision): Promise<ArrayBuffer>;
}

function runtimeDescriptor(revision: AdmittedAvatarRevision): AvatarRuntimeDescriptor {
  return {
    avatarId: revision.avatar.avatarId,
    revisionId: revision.avatar.revisionId,
    name: revision.avatar.name,
    projectId: revision.avatar.projectId,
    projectName: revision.avatar.projectName,
    licenseId: revision.avatar.licenseId,
    modelUrl: revision.modelUrl,
  };
}

function safeMessage(value: string | undefined): string {
  const message = value?.trim();
  return message ? message.slice(0, 240) : 'The companion could not be loaded.';
}

export class AvatarAssetHost {
  private pending?: AdmittedAvatarRevision;

  private pendingFallbackRevisionId?: string;

  private error?: string;

  private activationSequence = 0;

  private readonly listeners = new Set<SelectionListener>();

  constructor(
    private readonly cache: AvatarRevisionCache,
    private readonly readPersisted: () => PersistedAvatarSelection,
    private readonly writePersisted: (selection: PersistedAvatarSelection) => void,
  ) {}

  getState(): AvatarSelectionState {
    const persisted = this.normalizedPersisted();
    const active = this.requireRevision(persisted.activeRevisionId);
    return {
      activeAvatarId: active.avatar.avatarId,
      activeRevisionId: active.avatar.revisionId,
      pendingAvatarId: this.pending?.avatar.avatarId,
      pendingRevisionId: this.pending?.avatar.revisionId,
      status: this.pending ? 'activating' : this.error ? 'error' : 'ready',
      error: this.error,
    };
  }

  onState(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getSelected(): Promise<SelectedAvatarAsset> {
    const selected = this.pending ?? this.requireRevision(this.normalizedPersisted().activeRevisionId);
    const bytes = await this.cache.get(selected);
    return { avatar: runtimeDescriptor(selected), bytes };
  }

  async activate(avatarId: string): Promise<AvatarSelectionState> {
    const revision = getAdmittedAvatarRevisionByAvatarId(avatarId);
    if (!revision || evaluateFreeEntitlement(revision.avatar).status !== 'granted') {
      throw new Error('This companion is not available in the free admitted catalog.');
    }
    const active = this.requireRevision(this.normalizedPersisted().activeRevisionId);
    if (revision.avatar.revisionId === active.avatar.revisionId && !this.pending) {
      this.error = undefined;
      return this.publish();
    }
    const sequence = ++this.activationSequence;
    await this.cache.get(revision);
    if (sequence !== this.activationSequence) return this.getState();
    this.pending = revision;
    this.pendingFallbackRevisionId = active.avatar.revisionId;
    this.error = undefined;
    return this.publish();
  }

  async reportLoad(report: AvatarLoadReport): Promise<AvatarSelectionState> {
    if (this.pending) {
      if (report.revisionId !== this.pending.avatar.revisionId) return this.getState();
      if (report.status === 'ready') {
        const previous = this.requireRevision(this.normalizedPersisted().activeRevisionId);
        this.writePersisted({
          activeRevisionId: this.pending.avatar.revisionId,
          fallbackRevisionId: this.pendingFallbackRevisionId ?? previous.avatar.revisionId,
        });
        this.pending = undefined;
        this.pendingFallbackRevisionId = undefined;
        this.error = undefined;
        return this.publish();
      }
      this.pending = undefined;
      this.pendingFallbackRevisionId = undefined;
      this.error = safeMessage(report.message);
      return this.publish();
    }

    const persisted = this.normalizedPersisted();
    if (report.revisionId !== persisted.activeRevisionId) return this.getState();
    if (report.status === 'ready') {
      this.error = undefined;
      return this.publish();
    }
    const fallback = this.requireRevision(persisted.fallbackRevisionId);
    if (fallback.avatar.revisionId !== persisted.activeRevisionId) {
      try {
        await this.cache.get(fallback);
        this.pending = fallback;
        this.pendingFallbackRevisionId = defaultAvatarRevisionId;
        this.error = `Recovered after ${safeMessage(report.message)}`;
        return this.publish();
      } catch {
        // Preserve the original diagnostic when both the active and fallback assets fail.
      }
    }
    this.error = safeMessage(report.message);
    return this.publish();
  }

  private normalizedPersisted(): PersistedAvatarSelection {
    const value = this.readPersisted();
    const active = getAdmittedAvatarRevisionByRevisionId(value.activeRevisionId)
      ?? this.requireRevision(defaultAvatarRevisionId);
    const fallback = getAdmittedAvatarRevisionByRevisionId(value.fallbackRevisionId)
      ?? this.requireRevision(defaultAvatarRevisionId);
    return {
      activeRevisionId: active.avatar.revisionId,
      fallbackRevisionId: fallback.avatar.revisionId,
    };
  }

  private requireRevision(revisionId: string): AdmittedAvatarRevision {
    const revision = getAdmittedAvatarRevisionByRevisionId(revisionId);
    if (!revision) throw new Error('The selected companion revision is unavailable.');
    return revision;
  }

  private publish(): AvatarSelectionState {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
    return state;
  }
}
