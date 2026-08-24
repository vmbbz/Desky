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
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { resolveAvatarFramingScale } from './avatar-framing';
import {
  assertCoreHumanoid,
  assertVrmUsageCompatible,
  inspectVrmCapabilities,
  reviewVrmUsage,
} from './vrm-capabilities';

interface MarketplaceAvatarPreviewProps {
  avatarId: string;
  onReady?: () => void;
}

function applyPreviewPose(vrm: VRM): void {
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

export function MarketplaceAvatarPreview({ avatarId, onReady }: MarketplaceAvatarPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('Loading verified model…');
  const [kind, setKind] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let disposed = false;
    let frame = 0;
    let vrm: VRM | undefined;
    let yaw = 0;
    let dragging = false;
    let pointerX = 0;
    let manualUntil = 0;
    setKind('loading');
    setStatus('Loading verified model…');

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
    renderer.toneMappingExposure = 0.95;

    const scene = new Scene();
    const camera = new PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);
    camera.lookAt(0, 0, 0);
    scene.add(new AmbientLight(0xffffff, 2.4));
    const key = new DirectionalLight(0xe9f8ff, 3.1);
    key.position.set(2, 4, 3);
    scene.add(key);
    const fill = new DirectionalLight(0x8d7dff, 1.6);
    fill.position.set(-3, 1, 2);
    scene.add(fill);

    const resize = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const pointerDown = (event: PointerEvent) => {
      dragging = true;
      pointerX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      yaw += (event.clientX - pointerX) * 0.012;
      pointerX = event.clientX;
      manualUntil = performance.now() + 3_000;
    };
    const pointerUp = (event: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);

    const clock = new Clock();
    const animate = () => {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 0.1);
      if (vrm) {
        if (!dragging && performance.now() >= manualUntil) yaw += delta * 0.22;
        vrm.scene.rotation.y = yaw;
        vrm.update(delta);
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    void window.desky.marketplace.getPreview(avatarId).then(async ({ avatar, bytes }) => {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.parseAsync(bytes, new URL('.', avatar.modelUrl).href);
      const loaded = gltf.userData.vrm as VRM | undefined;
      if (disposed) {
        if (loaded) VRMUtils.deepDispose(loaded.scene);
        return;
      }
      if (!loaded) throw new Error('The admitted model is not a readable VRM avatar.');
      const capabilities = inspectVrmCapabilities(loaded);
      assertCoreHumanoid(capabilities);
      assertVrmUsageCompatible(reviewVrmUsage(loaded.meta, avatar.licenseId));
      if (capabilities.requiresLegacyRotation) VRMUtils.rotateVRM0(loaded);
      applyPreviewPose(loaded);
      const bounds = new Box3().setFromObject(loaded.scene);
      const size = bounds.getSize(new Vector3());
      const scale = resolveAvatarFramingScale({
        avatarWidth: size.x,
        avatarHeight: size.y,
        cameraDistance: Math.abs(camera.position.z),
        verticalFovDegrees: camera.fov,
        aspectRatio: camera.aspect,
      }) * 0.92;
      loaded.scene.scale.setScalar(scale);
      const fitted = new Box3().setFromObject(loaded.scene);
      const center = fitted.getCenter(new Vector3());
      loaded.scene.position.set(-center.x, -center.y, -center.z);
      scene.add(loaded.scene);
      vrm = loaded;
      setKind('ready');
      setStatus(`${capabilities.specLabel} · ${avatar.licenseId} · drag to rotate`);
      onReady?.();
    }).catch((error: unknown) => {
      if (disposed) return;
      setKind('error');
      setStatus(error instanceof Error ? error.message : 'Preview failed.');
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerUp);
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [avatarId, onReady]);

  return (
    <div className="marketplace-preview-stage" data-preview-state={kind}>
      <canvas ref={canvasRef} aria-label="Interactive 3D companion preview" />
      <span role={kind === 'error' ? 'alert' : 'status'}>{status}</span>
    </div>
  );
}
