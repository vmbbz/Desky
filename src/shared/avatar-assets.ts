import type { CatalogAvatar } from './avatar-catalog';

export interface FeaturedAvatarAsset {
  avatar: CatalogAvatar;
  bytes: ArrayBuffer;
}

export interface AvatarAssetBridge {
  getFeatured(): Promise<FeaturedAvatarAsset>;
}
