import {
  VRMHumanBoneName,
  VRMLoaderPlugin,
  VRMUtils,
  type VRM,
} from '@pixiv/three-vrm';
import { useEffect, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { CompanionMode } from '../../shared/adapter-events';
import { createAssetProvenance } from '../../shared/asset-provenance';
import { fetchFeaturedCc0Avatar } from './catalog';
import {
  assertCoreHumanoid,
  assertVrmUsageCompatible,
  inspectVrmCapabilities,
  reviewVrmUsage,
} from './vrm-capabilities';

const maxModelBytes = 100 * 1024 * 1024;

interface AvatarStageProps {
  mode: CompanionMode;
}

type LoadState =
  | { kind: 'loading'; message: string }
  | { kind: 'ready'; message: string }
  | { kind: 'error'; message: string };

async function fetchModel(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Avatar download failed (${response.status})`);
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > maxModelBytes) throw new Error('Avatar exceeds the 100 MB limit');

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxModelBytes) throw new Error('Avatar exceeds the 100 MB limit');
  return buffer;
}

function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials as Material[]) material.dispose();
  });
}

function applyRelaxedPose(vrm: VRM): void {
  const leftUpperArm = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
  const rightUpperArm = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
  const leftLowerArm = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm);
  const rightLowerArm = vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm);

  if (leftUpperArm) leftUpperArm.rotation.z = 1.05;
  if (rightUpperArm) rightUpperArm.rotation.z = -1.05;
  if (leftLowerArm) leftLowerArm.rotation.y = -0.12;
  if (rightLowerArm) rightLowerArm.rotation.y = 0.12;
  vrm.humanoid.update();
}

export function AvatarStage({ mode }: AvatarStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const [loadState, setLoadState] = useState<LoadState>({
    kind: 'loading',
    message: 'Finding a licensed CC0 avatar…',
  });

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let disposed = false;
    let frameId = 0;
    let currentVrm: VRM | undefined;
    let avatarRoot: Object3D | undefined;
    let baseY = 0;
    let baseRotationY = 0;

    const renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    renderer.setClearColor(new Color(0x000000), 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;

    const scene = new Scene();
    const camera = new PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);
    camera.lookAt(0, 0, 0);

    scene.add(new AmbientLight(0xffffff, 2.2));
    const keyLight = new DirectionalLight(0xe5f7ff, 3.2);
    keyLight.position.set(2, 4, 3);
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0x8b7cff, 1.8);
    fillLight.position.set(-3, 2, 1);
    scene.add(fillLight);

    const resize = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const clock = new Clock();
    const animate = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.elapsedTime;
      currentVrm?.update(delta);

      if (avatarRoot) {
        const energetic = ['thinking', 'working', 'speaking'].includes(modeRef.current);
        const amplitude = energetic ? 0.018 : 0.008;
        const speed = energetic ? 3.2 : 1.6;
        avatarRoot.position.y = baseY + Math.sin(elapsed * speed) * amplitude;
        avatarRoot.rotation.y = baseRotationY + Math.sin(elapsed * 0.55) * 0.035;
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    const load = async () => {
      try {
        const avatar = await fetchFeaturedCc0Avatar();
        if (disposed) return;
        setLoadState({ kind: 'loading', message: `Loading ${avatar.name}…` });

        const buffer = await fetchModel(avatar.modelUrl);
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        const gltf = await loader.parseAsync(buffer, new URL('.', avatar.modelUrl).href);
        if (disposed) return;

        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) throw new Error('The selected file is not a readable VRM avatar');
        const capabilities = inspectVrmCapabilities(vrm);
        assertCoreHumanoid(capabilities);
        const usageReview = reviewVrmUsage(vrm.meta, avatar.license);
        assertVrmUsageCompatible(usageReview);
        const provenance = await createAssetProvenance({
          assetId: `avatar:${avatar.projectId}/${avatar.id}`,
          kind: 'avatar',
          sourceUrl: avatar.modelUrl,
          sourceProject: avatar.projectName,
          creator: usageReview.creator,
          licenseId: avatar.license,
          attribution: usageReview.requiresCredit ? usageReview.creator : undefined,
          bytes: buffer,
        });
        if (disposed) return;
        if (capabilities.requiresLegacyRotation) VRMUtils.rotateVRM0(vrm);
        applyRelaxedPose(vrm);
        currentVrm = vrm;
        avatarRoot = vrm.scene;
        avatarRoot.userData.deskyAsset = {
          provenance,
          capabilities,
          usageReview,
        };
        baseRotationY = avatarRoot.rotation.y;
        avatarRoot.rotation.y = baseRotationY;

        const bounds = new Box3().setFromObject(avatarRoot);
        const size = bounds.getSize(new Vector3());
        const scaleByHeight = size.y > 0 ? 2.5 / size.y : 1;
        const scaleByWidth = size.x > 0 ? 2.35 / size.x : 1;
        const scale = Math.min(scaleByHeight, scaleByWidth);
        avatarRoot.scale.setScalar(scale);

        const fittedBounds = new Box3().setFromObject(avatarRoot);
        const center = fittedBounds.getCenter(new Vector3());
        avatarRoot.position.x -= center.x;
        avatarRoot.position.y -= center.y;
        avatarRoot.position.z -= center.z;
        baseY = avatarRoot.position.y;
        avatarRoot.position.y = baseY;
        scene.add(avatarRoot);

        setLoadState({
          kind: 'ready',
          message: `${avatar.name} · ${capabilities.specLabel} · ${avatar.license} · ${avatar.projectName}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Avatar loading failed';
        setLoadState({ kind: 'error', message });
      }
    };

    void load();
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      if (avatarRoot) disposeObject(avatarRoot);
      renderer.dispose();
    };
  }, []);

  return (
    <section className="avatar-stage" aria-label="Desky avatar">
      <canvas ref={canvasRef} />
      <div className={`asset-status asset-status--${loadState.kind}`} role="status">
        {loadState.message}
      </div>
    </section>
  );
}
