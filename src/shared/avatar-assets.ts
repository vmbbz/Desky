export const avatarSelectionStatuses = ['ready', 'activating', 'error'] as const;
export type AvatarSelectionStatus = (typeof avatarSelectionStatuses)[number];

export interface AvatarRuntimeDescriptor {
  avatarId: string;
  revisionId: string;
  animationProfileId: string;
  name: string;
  projectId: string;
  projectName: string;
  licenseId: string;
  modelUrl: string;
}

export interface SelectedAvatarAsset {
  avatar: AvatarRuntimeDescriptor;
  bytes: ArrayBuffer;
}

export interface FeaturedAvatarAsset {
  avatar: CatalogAvatar;
  bytes: ArrayBuffer;
}

export interface AvatarSelectionState {
  activeAvatarId: string;
  activeRevisionId: string;
  pendingAvatarId?: string;
  pendingRevisionId?: string;
  status: AvatarSelectionStatus;
  error?: string;
}

export interface AvatarLoadReport {
  revisionId: string;
  status: 'ready' | 'error';
  message?: string;
}

export interface AvatarAssetBridge {
  getSelected(): Promise<SelectedAvatarAsset>;
  getSelectionState(): Promise<AvatarSelectionState>;
  reportLoad(report: AvatarLoadReport): Promise<AvatarSelectionState>;
  onSelectionState(listener: (state: AvatarSelectionState) => void): () => void;
}
import type { CatalogAvatar } from './avatar-catalog';

export const defaultAvatarRevisionId = 'milk-99e32f15-v1';
