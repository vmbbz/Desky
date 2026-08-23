import {
  VRMAnimationLoaderPlugin,
  createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation';
import type { VRM } from '@pixiv/three-vrm';
import type { AnimationClip } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const maxPreviewDurationSeconds = 120;
const maxPreviewTracks = 256;

export async function loadVrmAnimationPreview(
  bytes: ArrayBuffer,
  vrm: VRM,
  fileName: string,
): Promise<AnimationClip> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const gltf = await loader.parseAsync(bytes, '');
  const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;
  if (!animations?.length) {
    throw new Error('The selected file contains no readable VRM Animation.');
  }
  const clip = createVRMAnimationClip(animations[0], vrm);
  clip.name = `local-preview:${fileName}`;
  if (!Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > maxPreviewDurationSeconds) {
    throw new Error('VRM Animation previews must be between 0 and 120 seconds long.');
  }
  if (clip.tracks.length === 0 || clip.tracks.length > maxPreviewTracks) {
    throw new Error('The VRM Animation has no compatible tracks or exceeds the 256-track limit.');
  }
  return clip;
}
