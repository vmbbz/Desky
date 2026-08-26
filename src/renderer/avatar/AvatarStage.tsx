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
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import builtInAnimationLibrary from '../../assets/animations/quaternius-uam-standard-v1.library.json';
import type { CompanionMode } from '../../shared/adapter-events';
import { createAssetProvenance } from '../../shared/asset-provenance';
import type { LocalAnimationPreviewCommand } from '../../shared/local-animation';
import type { MotionPersonalityPolicy } from '../../shared/motion-personality';
import {
  resolveReducedMotion,
  type DesktopRectangle,
  type MotionPreference,
} from '../../shared/runtime';
import { AvatarExpressionController } from './avatar-expression-controller';
import {
  admitAnimationLibrary,
  type AdmittedAnimationLibrary,
} from './animation-library-runtime';
import {
  resolveAvatarFramingScale,
  resolveMotionEnvelopeZoom,
  smoothMotionEnvelopeZoom,
} from './avatar-framing';
import { AvatarMotionController } from './avatar-motion-controller';
import {
  resolveAvatarFrameDelayMs,
  resolveAvatarTargetFrameRate,
} from './avatar-render-policy';
import { loadVrmAnimationPreview } from './load-vrma-preview';
import type { MotionCueKind, MotionCueSource } from './motion-cue-queue';
import {
  assertCoreHumanoid,
  assertVrmUsageCompatible,
  inspectVrmCapabilities,
  reviewVrmUsage,
} from './vrm-capabilities';

interface AvatarStageProps {
  avatarRevisionId: string;
  mode: CompanionMode;
  motionPersonality: MotionPersonalityPolicy;
  motionPreference: MotionPreference;
  motionCue?: { id: string; kind: MotionCueKind; source: MotionCueSource };
  onVisibleBounds?: (bounds: DesktopRectangle | undefined) => void;
  onHitTestReady?: (hitTest: AvatarHitTest | undefined) => void;
  powerSuspended?: boolean;
  resumeEpoch?: number;
  surfaceVisible?: boolean;
  viewYawDegrees?: number;
}

export type AvatarHitTest = (clientX: number, clientY: number) => boolean;

type LoadState =
  | { kind: 'loading'; message: string }
  | { kind: 'ready'; message: string; textureCount: number }
  | { kind: 'error'; message: string };

function disposeObject(root: Object3D): void {
  VRMUtils.deepDispose(root);
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

export function AvatarStage({
  avatarRevisionId,
  mode,
  motionPersonality,
  motionPreference,
  motionCue,
  onVisibleBounds,
  onHitTestReady,
  powerSuspended = false,
  resumeEpoch = 0,
  surfaceVisible = true,
  viewYawDegrees = 0,
}: AvatarStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const onVisibleBoundsRef = useRef(onVisibleBounds);
  const onHitTestReadyRef = useRef(onHitTestReady);
  const motionControllerRef = useRef<AvatarMotionController>(undefined);
  const expressionControllerRef = useRef<AvatarExpressionController>(undefined);
  const motionCueRef = useRef(motionCue);
  const motionPreferenceRef = useRef(motionPreference);
  const motionPersonalityRef = useRef(motionPersonality);
  const powerSuspendedRef = useRef(powerSuspended);
  const surfaceVisibleRef = useRef(surfaceVisible);
  const renderLoopControlRef = useRef<(() => void) | undefined>(undefined);
  const viewYawDegreesRef = useRef(viewYawDegrees);
  const admittedMotionCueIdRef = useRef<string>(undefined);
  const [graphicsRetryAvailable, setGraphicsRetryAvailable] = useState(false);
  const [graphicsRetryGeneration, setGraphicsRetryGeneration] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({
    kind: 'loading',
    message: 'Finding a licensed CC0 avatar…',
  });

  useEffect(() => {
    modeRef.current = mode;
    motionControllerRef.current?.setMode(mode);
    expressionControllerRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    onVisibleBoundsRef.current = onVisibleBounds;
  }, [onVisibleBounds]);

  useEffect(() => {
    onHitTestReadyRef.current = onHitTestReady;
  }, [onHitTestReady]);

  useEffect(() => {
    viewYawDegreesRef.current = viewYawDegrees;
  }, [viewYawDegrees]);

  useEffect(() => {
    surfaceVisibleRef.current = surfaceVisible;
    renderLoopControlRef.current?.();
  }, [surfaceVisible]);

  useEffect(() => {
    powerSuspendedRef.current = powerSuspended;
    renderLoopControlRef.current?.();
  }, [powerSuspended, resumeEpoch]);

  useEffect(() => {
    motionCueRef.current = motionCue;
    if (!motionCue || admittedMotionCueIdRef.current === motionCue.id) return;
    if (!motionControllerRef.current?.queueMotionCue(motionCue.kind, motionCue.source)) return;
    admittedMotionCueIdRef.current = motionCue.id;
  }, [motionCue]);

  useEffect(() => {
    motionPreferenceRef.current = motionPreference;
    const reduced = resolveReducedMotion(
      motionPreference,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ) || motionPersonalityRef.current.preset === 'paused';
    motionControllerRef.current?.setReducedMotion(reduced);
    expressionControllerRef.current?.setReducedMotion(reduced);
  }, [motionPreference]);

  useEffect(() => {
    motionPersonalityRef.current = motionPersonality;
    motionControllerRef.current?.setMotionPersonality(motionPersonality);
    const reduced = resolveReducedMotion(
      motionPreferenceRef.current,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    ) || motionPersonality.preset === 'paused';
    motionControllerRef.current?.setReducedMotion(reduced);
    expressionControllerRef.current?.setReducedMotion(reduced);
  }, [motionPersonality]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    setLoadState({ kind: 'loading', message: 'Loading the selected companion…' });

    let disposed = false;
    let frameId = 0;
    let frameTimer: ReturnType<typeof setTimeout> | undefined;
    let currentVrm: VRM | undefined;
    let avatarRoot: Object3D | undefined;
    let activePreviewRequestId: string | undefined;
    let queuedAnimationCommand: LocalAnimationPreviewCommand | undefined;
    let appliedViewYawDegrees: number | undefined;
    let lastBoundsSignature = '';
    let webglContextLost = false;
    let webglContextUnrecoverable = false;
    let webglRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let readySnapshot: Extract<LoadState, { kind: 'ready' }> | undefined;
    const reportPreview = (
      requestId: string,
      status: 'playing' | 'completed' | 'blocked' | 'error',
      message: string,
    ) => {
      void window.desky.animation.report({ requestId, status, message }).catch(() => undefined);
    };
    const runAnimationCommand = async (command: LocalAnimationPreviewCommand) => {
      if (command.kind === 'clear') {
        activePreviewRequestId = undefined;
        motionControllerRef.current?.stopPreview();
        expressionControllerRef.current?.setSuspended(false);
        return;
      }
      queuedAnimationCommand = command;
      const motionController = motionControllerRef.current;
      const expressionController = expressionControllerRef.current;
      if (!currentVrm || !motionController || !expressionController) return;
      activePreviewRequestId = command.requestId;
      try {
        const clip = await loadVrmAnimationPreview(
          command.asset.bytes,
          currentVrm,
          command.asset.fileName,
        );
        if (disposed || activePreviewRequestId !== command.requestId) return;
        const result = motionController.playPreviewClip(clip, {
          onStarted: () => {
            expressionController.setSuspended(true);
            reportPreview(command.requestId, 'playing', `Playing ${command.asset.fileName}.`);
          },
          onEnded: (endResult) => {
            expressionController.setSuspended(false);
            if (activePreviewRequestId !== command.requestId) return;
            activePreviewRequestId = undefined;
            reportPreview(
              command.requestId,
              endResult === 'completed' ? 'completed' : 'blocked',
              endResult === 'completed'
                ? `Finished ${command.asset.fileName}.`
                : `${command.asset.fileName} was interrupted by a higher-priority companion state.`,
            );
          },
        });
        if (!result.accepted) {
          activePreviewRequestId = undefined;
          reportPreview(command.requestId, 'blocked', result.reason);
        }
      } catch (error) {
        if (disposed || activePreviewRequestId !== command.requestId) return;
        activePreviewRequestId = undefined;
        const message = error instanceof Error ? error.message : 'VRM Animation preview failed.';
        reportPreview(command.requestId, 'error', message);
      }
    };
    const acceptAnimationCommand = (command: LocalAnimationPreviewCommand) => {
      if (command.kind === 'clear') queuedAnimationCommand = undefined;
      void runAnimationCommand(command);
    };
    const removeAnimationCommand = window.desky.animation.onCommand(acceptAnimationCommand);
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateReducedMotion = () => {
      const reduced = resolveReducedMotion(
        motionPreferenceRef.current,
        reducedMotionQuery.matches,
      ) || motionPersonalityRef.current.preset === 'paused';
      motionControllerRef.current?.setReducedMotion(reduced);
      expressionControllerRef.current?.setReducedMotion(reduced);
    };
    reducedMotionQuery.addEventListener('change', updateReducedMotion);

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
    canvas.dataset.webglState = 'ready';
    canvas.dataset.webglLossCount = '0';
    canvas.dataset.webglRestoreCount = '0';

    const requestedRecoveryTimeout = Number.parseInt(
      new URLSearchParams(window.location.search).get('webglRecoveryTimeoutMs') ?? '',
      10,
    );
    const webglRecoveryTimeoutMs = Number.isSafeInteger(requestedRecoveryTimeout)
      ? Math.max(1000, Math.min(requestedRecoveryTimeout, 30_000))
      : 8_000;

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      webglContextLost = true;
      canvas.dataset.webglState = 'lost';
      canvas.dataset.webglLossCount = String(
        Number.parseInt(canvas.dataset.webglLossCount ?? '0', 10) + 1,
      );
      if (webglRecoveryTimer) clearTimeout(webglRecoveryTimer);
      webglRecoveryTimer = setTimeout(() => {
        if (disposed || !webglContextLost) return;
        webglContextUnrecoverable = true;
        canvas.dataset.webglState = 'unrecoverable';
        setGraphicsRetryAvailable(true);
        setLoadState({
          kind: 'error',
          message: 'Graphics recovery timed out. Retry the companion renderer.',
        });
        renderLoopControlRef.current?.();
      }, webglRecoveryTimeoutMs);
      setLoadState({ kind: 'loading', message: 'Graphics paused · recovering the companion…' });
      renderLoopControlRef.current?.();
    };
    const handleContextRestored = () => {
      if (webglRecoveryTimer) clearTimeout(webglRecoveryTimer);
      webglRecoveryTimer = undefined;
      webglContextLost = false;
      webglContextUnrecoverable = false;
      canvas.dataset.webglState = 'recovered';
      canvas.dataset.webglRestoreCount = String(
        Number.parseInt(canvas.dataset.webglRestoreCount ?? '0', 10) + 1,
      );
      renderer.resetState();
      resize();
      setGraphicsRetryAvailable(false);
      if (readySnapshot) setLoadState(readySnapshot);
      renderLoopControlRef.current?.();
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new Scene();
    const camera = new PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);
    camera.lookAt(0, 0, 0);
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const motionEnvelopeBounds = new Box3();
    const motionEnvelopeCorners = Array.from({ length: 8 }, () => new Vector3());
    const motionEnvelopeSkinnedMeshes: SkinnedMesh[] = [];

    const projectMotionEnvelope = () => {
      const minimum = motionEnvelopeBounds.min;
      const maximum = motionEnvelopeBounds.max;
      motionEnvelopeCorners[0].set(minimum.x, minimum.y, minimum.z);
      motionEnvelopeCorners[1].set(minimum.x, minimum.y, maximum.z);
      motionEnvelopeCorners[2].set(minimum.x, maximum.y, minimum.z);
      motionEnvelopeCorners[3].set(minimum.x, maximum.y, maximum.z);
      motionEnvelopeCorners[4].set(maximum.x, minimum.y, minimum.z);
      motionEnvelopeCorners[5].set(maximum.x, minimum.y, maximum.z);
      motionEnvelopeCorners[6].set(maximum.x, maximum.y, minimum.z);
      motionEnvelopeCorners[7].set(maximum.x, maximum.y, maximum.z);
      let maxAbsX = 0;
      let maxAbsY = 0;
      for (const corner of motionEnvelopeCorners) {
        corner.project(camera);
        maxAbsX = Math.max(maxAbsX, Math.abs(corner.x));
        maxAbsY = Math.max(maxAbsY, Math.abs(corner.y));
      }
      return { maxAbsX, maxAbsY };
    };

    const reportVisibleBounds = () => {
      if (!avatarRoot) return;
      scene.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(avatarRoot);
      if (bounds.isEmpty()) return;
      const minimum = bounds.min;
      const maximum = bounds.max;
      const corners = [
        new Vector3(minimum.x, minimum.y, minimum.z),
        new Vector3(minimum.x, minimum.y, maximum.z),
        new Vector3(minimum.x, maximum.y, minimum.z),
        new Vector3(minimum.x, maximum.y, maximum.z),
        new Vector3(maximum.x, minimum.y, minimum.z),
        new Vector3(maximum.x, minimum.y, maximum.z),
        new Vector3(maximum.x, maximum.y, minimum.z),
        new Vector3(maximum.x, maximum.y, maximum.z),
      ];
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      const projected = corners.map((corner) => corner.project(camera));
      const left = Math.max(0, Math.min(...projected.map((point) => (point.x + 1) * width / 2)));
      const right = Math.min(width, Math.max(...projected.map((point) => (point.x + 1) * width / 2)));
      const top = Math.max(0, Math.min(...projected.map((point) => (1 - point.y) * height / 2)));
      const bottom = Math.min(height, Math.max(...projected.map((point) => (1 - point.y) * height / 2)));
      if (right <= left || bottom <= top) return;
      const nextBounds = {
        x: Math.round(left),
        y: Math.round(top),
        width: Math.round(right - left),
        height: Math.round(bottom - top),
      };
      const signature = JSON.stringify(nextBounds);
      if (signature === lastBoundsSignature) return;
      lastBoundsSignature = signature;
      onVisibleBoundsRef.current?.(nextBounds);
    };

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
      reportVisibleBounds();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const clock = new Clock();
    let motionElapsed = 0;
    let motionFrame = 0;
    let motionEnvelopeTargetZoom = 1;
    let motionEnvelopeReady = false;
    let lastReportedFramingZoom = 1;
    let loopActive = false;
    const cancelScheduledFrame = () => {
      cancelAnimationFrame(frameId);
      if (frameTimer) clearTimeout(frameTimer);
      frameTimer = undefined;
    };
    const renderSuspensionReason = () => {
      if (webglContextUnrecoverable) return 'webgl-unrecoverable';
      if (webglContextLost) return 'webgl-lost';
      if (powerSuspendedRef.current) return 'power-suspend';
      if (!surfaceVisibleRef.current) return 'native-hidden';
      if (document.hidden) return 'document-hidden';
      return '';
    };
    const syncRenderLoop = () => {
      if (disposed) return;
      const reason = renderSuspensionReason();
      canvas.dataset.renderSuspended = String(Boolean(reason));
      canvas.dataset.renderSuspensionReason = reason;
      if (reason) {
        if (loopActive) cancelScheduledFrame();
        loopActive = false;
        return;
      }
      if (loopActive) return;
      clock.start();
      loopActive = true;
      canvas.dataset.renderScheduler = 'timer-raf';
      scheduleFrame();
    };
    const animate = (timestamp: number) => {
      if (disposed) return;
      const suspensionReason = renderSuspensionReason();
      if (suspensionReason) {
        canvas.dataset.renderSuspended = 'true';
        canvas.dataset.renderSuspensionReason = suspensionReason;
        loopActive = false;
        return;
      }
      const pendingDiagnostics = motionControllerRef.current?.runtimeDiagnostics;
      const targetFrameRate = resolveAvatarTargetFrameRate({
        mode: modeRef.current,
        activeCue: Boolean(
          pendingDiagnostics?.activeCueId || pendingDiagnostics?.activeProgramId,
        ),
        previewActive: Boolean(activePreviewRequestId),
      });
      canvas.dataset.renderTargetFps = String(targetFrameRate);
      const delta = Math.min(clock.getDelta(), 0.1);
      motionElapsed += delta;
      const elapsed = motionElapsed;
      const motionController = motionControllerRef.current;
      motionController?.update(delta, elapsed);
      motionFrame += 1;
      const diagnostics = motionController?.runtimeDiagnostics;
      canvas.dataset.motionFrame = String(motionFrame);
      canvas.dataset.motionElapsed = elapsed.toFixed(2);
      canvas.dataset.motionMode = diagnostics?.mode ?? 'loading';
      canvas.dataset.motionStateClip = diagnostics?.stateClipId ?? '';
      canvas.dataset.motionActiveProgram = diagnostics?.activeProgramId ?? '';
      canvas.dataset.motionActiveCue = diagnostics?.activeCueId ?? '';
      canvas.dataset.motionPendingCues = String(diagnostics?.pendingCueCount ?? 0);
      canvas.dataset.motionReduced = String(diagnostics?.reducedMotion ?? false);
      canvas.dataset.motionClipError = diagnostics?.lastClipError ?? '';
      expressionControllerRef.current?.update(delta, elapsed);
      currentVrm?.update(delta);

      if (motionControllerRef.current && appliedViewYawDegrees !== viewYawDegreesRef.current) {
        appliedViewYawDegrees = viewYawDegreesRef.current;
        motionControllerRef.current.setViewYawDegrees(appliedViewYawDegrees);
        reportVisibleBounds();
      }

      if (avatarRoot) {
        const activelyExpansive = Boolean(
          diagnostics?.activeProgramId || diagnostics?.activeCueId,
        );
        const shouldSampleEnvelope = !motionEnvelopeReady
          || motionFrame <= 2
          || motionFrame % (activelyExpansive ? 2 : 8) === 0;
        if (shouldSampleEnvelope) {
          for (const mesh of motionEnvelopeSkinnedMeshes) mesh.computeBoundingBox();
          scene.updateMatrixWorld(true);
          motionEnvelopeBounds.setFromObject(avatarRoot);
          motionEnvelopeReady = !motionEnvelopeBounds.isEmpty();
        }
        if (motionEnvelopeReady) {
          const before = projectMotionEnvelope();
          if (shouldSampleEnvelope) {
            motionEnvelopeTargetZoom = resolveMotionEnvelopeZoom({
              currentZoom: camera.zoom,
              projectedMaxAbsX: before.maxAbsX,
              projectedMaxAbsY: before.maxAbsY,
            });
          }
          const nextZoom = smoothMotionEnvelopeZoom({
            currentZoom: camera.zoom,
            targetZoom: motionEnvelopeTargetZoom,
            deltaSeconds: delta,
          });
          if (Math.abs(nextZoom - camera.zoom) > 0.0001) {
            camera.zoom = nextZoom;
            camera.updateProjectionMatrix();
          }
          const after = projectMotionEnvelope();
          canvas.dataset.framingZoom = camera.zoom.toFixed(4);
          canvas.dataset.framingTargetZoom = motionEnvelopeTargetZoom.toFixed(4);
          canvas.dataset.framingMaxX = after.maxAbsX.toFixed(4);
          canvas.dataset.framingMaxY = after.maxAbsY.toFixed(4);
          canvas.dataset.framingConstrained = String(camera.zoom < 0.999);
          if (Math.abs(camera.zoom - lastReportedFramingZoom) >= 0.003) {
            lastReportedFramingZoom = camera.zoom;
            reportVisibleBounds();
          }
        }
      }

      renderer.render(scene, camera);
      scheduleFrame(resolveAvatarFrameDelayMs(targetFrameRate, performance.now() - timestamp));
    };
    function scheduleFrame(delayMs = 0) {
      if (disposed || !loopActive) return;
      if (delayMs <= 0) {
        frameId = requestAnimationFrame(animate);
        return;
      }
      frameTimer = setTimeout(() => {
        frameTimer = undefined;
        if (!disposed && loopActive) frameId = requestAnimationFrame(animate);
      }, delayMs);
    }
    const handleVisibilityChange = () => syncRenderLoop();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    renderLoopControlRef.current = syncRenderLoop;

    let loadedRevisionId: string | undefined;
    const load = async () => {
      try {
        let animationLibrary: AdmittedAnimationLibrary | undefined;
        let animationLibraryWarning: string | undefined;
        try {
          animationLibrary = await admitAnimationLibrary(builtInAnimationLibrary);
        } catch (error) {
          animationLibraryWarning = error instanceof Error
            ? error.message
            : 'The built-in animation library failed admission.';
        }
        const { avatar, bytes: buffer } = await window.desky.avatar.getSelected();
        loadedRevisionId = avatar.revisionId;
        if (disposed) return;
        setLoadState({ kind: 'loading', message: `Loading ${avatar.name}…` });
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        const gltf = await loader.parseAsync(buffer, new URL('.', avatar.modelUrl).href);
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (disposed) {
          if (vrm) VRMUtils.deepDispose(vrm.scene);
          return;
        }
        if (!vrm) throw new Error('The selected file is not a readable VRM avatar');
        const capabilities = inspectVrmCapabilities(vrm);
        assertCoreHumanoid(capabilities);
        const usageReview = reviewVrmUsage(vrm.meta, avatar.licenseId);
        assertVrmUsageCompatible(usageReview);
        let textureCount = 0;
        vrm.scene.traverse((object) => {
          const mesh = object as Mesh;
          if (!mesh.isMesh) return;
          const skinnedMesh = mesh as SkinnedMesh;
          if (skinnedMesh.isSkinnedMesh) motionEnvelopeSkinnedMeshes.push(skinnedMesh);
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const material of materials as Array<Material & { map?: { isTexture?: boolean } }>) {
            if (material.map?.isTexture) textureCount += 1;
          }
        });
        const provenance = await createAssetProvenance({
          assetId: `avatar:${avatar.avatarId}/${avatar.revisionId}`,
          kind: 'avatar',
          sourceUrl: avatar.modelUrl,
          sourceProject: avatar.projectName,
          creator: usageReview.creator,
          licenseId: avatar.licenseId,
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

        const bounds = new Box3().setFromObject(avatarRoot);
        const size = bounds.getSize(new Vector3());
        const scale = resolveAvatarFramingScale({
          avatarWidth: size.x,
          avatarHeight: size.y,
          cameraDistance: Math.abs(camera.position.z),
          verticalFovDegrees: camera.fov,
          aspectRatio: camera.aspect,
        });
        avatarRoot.scale.setScalar(scale);

        const fittedBounds = new Box3().setFromObject(avatarRoot);
        const center = fittedBounds.getCenter(new Vector3());
        avatarRoot.position.x -= center.x;
        avatarRoot.position.y -= center.y;
        avatarRoot.position.z -= center.z;
        scene.add(avatarRoot);
        const hitTest: AvatarHitTest = (clientX, clientY) => {
          if (!avatarRoot) return false;
          const rectangle = canvas.getBoundingClientRect();
          if (
            rectangle.width <= 0 || rectangle.height <= 0 ||
            clientX < rectangle.left || clientX > rectangle.right ||
            clientY < rectangle.top || clientY > rectangle.bottom
          ) return false;
          pointer.set(
            ((clientX - rectangle.left) / rectangle.width) * 2 - 1,
            -((clientY - rectangle.top) / rectangle.height) * 2 + 1,
          );
          scene.updateMatrixWorld(true);
          raycaster.setFromCamera(pointer, camera);
          return raycaster.intersectObject(avatarRoot, true).length > 0;
        };
        onHitTestReadyRef.current?.(hitTest);
        const seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
        const motionController = new AvatarMotionController(
          vrm,
          avatarRoot,
          animationLibrary?.stateRegistrations ?? [],
          {
          autonomousMotionSeed: seed,
            animationLibrary,
          },
        );
        const expressionController = new AvatarExpressionController(vrm, capabilities);
        motionControllerRef.current = motionController;
        expressionControllerRef.current = expressionController;
        motionController.setMotionPersonality(motionPersonalityRef.current);
        const reduced = resolveReducedMotion(
          motionPreferenceRef.current,
          reducedMotionQuery.matches,
        ) || motionPersonalityRef.current.preset === 'paused';
        motionController.setReducedMotion(reduced);
        expressionController.setReducedMotion(reduced);
        motionController.setMode(modeRef.current);
        expressionController.setMode(modeRef.current);
        const currentCommand = await window.desky.animation.getCurrentCommand();
        if (disposed) return;
        if (currentCommand?.kind === 'play') queuedAnimationCommand = currentCommand;
        if (queuedAnimationCommand) await runAnimationCommand(queuedAnimationCommand);
        const pendingMotionCue = motionCueRef.current;
        if (pendingMotionCue && motionController.queueMotionCue(pendingMotionCue.kind, pendingMotionCue.source)) {
          admittedMotionCueIdRef.current = pendingMotionCue.id;
        }
        reportVisibleBounds();

        const readyMessage = animationLibraryWarning
          ? `${avatar.name} · motion fallback (${animationLibraryWarning})`
          : `${avatar.name} · ${animationLibrary?.clipCount ?? 0} admitted motions · ${capabilities.specLabel} · ${avatar.licenseId}`;
        await window.desky.avatar.reportLoad({
          revisionId: avatar.revisionId,
          status: 'ready',
        });
        if (disposed) return;
        readySnapshot = {
          kind: 'ready',
          message: readyMessage,
          textureCount,
        };
        setLoadState(readySnapshot);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Avatar loading failed';
        if (!disposed) {
          await window.desky.avatar.reportLoad({
            revisionId: loadedRevisionId ?? avatarRevisionId,
            status: 'error',
            message,
          }).catch(() => undefined);
        }
        if (disposed) return;
        setLoadState({ kind: 'error', message });
      }
    };

    void load();
    syncRenderLoop();

    return () => {
      disposed = true;
      cancelScheduledFrame();
      loopActive = false;
      if (webglRecoveryTimer) clearTimeout(webglRecoveryTimer);
      if (renderLoopControlRef.current === syncRenderLoop) renderLoopControlRef.current = undefined;
      activePreviewRequestId = undefined;
      removeAnimationCommand();
      resizeObserver.disconnect();
      reducedMotionQuery.removeEventListener('change', updateReducedMotion);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      motionControllerRef.current?.dispose();
      motionControllerRef.current = undefined;
      expressionControllerRef.current?.dispose();
      expressionControllerRef.current = undefined;
      admittedMotionCueIdRef.current = undefined;
      if (avatarRoot) disposeObject(avatarRoot);
      renderer.renderLists.dispose();
      renderer.dispose();
      onVisibleBoundsRef.current?.(undefined);
      onHitTestReadyRef.current?.(undefined);
    };
  }, [avatarRevisionId, graphicsRetryGeneration]);

  return (
    <section
      className="avatar-stage"
      aria-label="Desky avatar"
      data-avatar-state={loadState.kind}
      data-avatar-texture-count={loadState.kind === 'ready' ? loadState.textureCount : undefined}
    >
      <canvas key={graphicsRetryGeneration} ref={canvasRef} />
      <div className={`asset-status asset-status--${loadState.kind}`} role="status">
        {loadState.message}
        {graphicsRetryAvailable ? (
          <button
            type="button"
            data-webgl-retry
            data-desky-interactive="true"
            onClick={() => {
              setGraphicsRetryAvailable(false);
              setLoadState({ kind: 'loading', message: 'Restarting the companion renderer…' });
              setGraphicsRetryGeneration((value) => value + 1);
            }}
          >
            Retry graphics
          </button>
        ) : null}
      </div>
    </section>
  );
}
