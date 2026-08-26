import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import {
  initialCompanionDraftSnapshot,
  initialCompanionSnapshot,
  reduceCompanionSnapshot,
  type CompanionDraftSnapshot,
  type CompanionSnapshot,
} from '../shared/companion-state';
import type {
  MarketplaceCacheInventory,
  MarketplaceCatalog,
} from '../shared/avatar-marketplace';
import {
  defaultAvatarRevisionId,
  type AvatarSelectionState,
} from '../shared/avatar-assets';
import type { AgentActionCommand } from '../shared/agent-actions';
import { openClawCapabilities } from '../shared/adapter-capabilities';
import type {
  AdapterConnectionState,
  AdapterDescriptor,
} from '../shared/agent-adapter';
import {
  codexSandboxDisclosures,
  type CodexSandboxMode,
  type CodexWorkspaceGrantSummary,
} from '../shared/codex-workspace';
import {
  initialLocalAnimationPreviewState,
  type LocalAnimationPreviewState,
} from '../shared/local-animation';
import {
  openClawAdapterDescriptor,
  type OpenClawAuthKind,
} from '../shared/openclaw';
import { hermesAdapterDescriptor } from '../shared/hermes';
import {
  defaultMotionPersonality,
  motionCategories,
  motionPersonalityForPreset,
  motionPersonalityPresets,
  type MotionCategoryLevel,
  type MotionPersonalityPolicy,
} from '../shared/motion-personality';
import type {
  AmbientSurfaceState,
  DesktopRectangle,
  MotionPreference,
  RuntimeInfo,
} from '../shared/runtime';
import { SimulationAdapter } from './adapters/simulation-adapter';
import { AvatarStage, type AvatarHitTest } from './avatar/AvatarStage';
import { MarketplaceAvatarPreview } from './avatar/MarketplaceAvatarPreview';
import { resolveAvatarDragMode } from './avatar/avatar-manipulation';
import type { MotionCueKind, MotionCueSource } from './avatar/motion-cue-queue';

const initialGateway: AdapterConnectionState = {
  schemaVersion: 1,
  adapterId: 'openclaw',
  descriptor: openClawAdapterDescriptor,
  status: 'disconnected',
  endpoint: 'ws://127.0.0.1:18789/',
  authenticationMethod: 'token',
  insecureLocal: true,
  message: 'Connect to an OpenClaw Gateway',
  reconnectAttempt: 0,
  sessions: [],
  capabilities: openClawCapabilities(false),
};
const visualTestState = new URLSearchParams(window.location.search).get('visualState');
const visualTestExercise = new URLSearchParams(window.location.search).get('visualExercise');
const initialAvatarSelection: AvatarSelectionState = {
  activeAvatarId: '15dce553-3d3c-4288-8c03-c69c65167447',
  activeRevisionId: defaultAvatarRevisionId,
  status: 'ready',
};

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The operation failed.';
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '').slice(0, 240);
}

function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeAvatarYaw(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

function DeskyBrandMark() {
  return (
    <span className="brand__mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" focusable="false">
        <path d="M10 19 15 10h18l9 9v27H10Z" fill="#fffdf7" />
        <path d="m33 10 9 9v27l-7-4V18Z" fill="#e5dfd2" />
        <path d="M15 10h19l4 4H12Z" fill="#f3efe4" />
        <rect x="15" y="6" width="19" height="7" rx="2.5" fill="#4e91c6" />
        <path d="M10 34h32v6H10Z" fill="#bceff1" />
        <path d="M10 40h32v6H10Z" fill="#579dcf" />
        <circle cx="21" cy="25" r="2.2" fill="#0a0e17" />
        <circle cx="31" cy="25" r="2.2" fill="#0a0e17" />
        <path
          d="M23 29c2 2 5 2 7 0"
          fill="none"
          stroke="#0a0e17"
          strokeLinecap="round"
          strokeWidth="2.4"
        />
      </svg>
    </span>
  );
}

export function App() {
  const simulation = useMemo(() => new SimulationAdapter(), []);
  const [state, setState] = useState<CompanionSnapshot>(initialCompanionSnapshot);
  const [draft, setDraft] = useState<CompanionDraftSnapshot>(initialCompanionDraftSnapshot);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>();
  const [ambientState, setAmbientState] = useState<AmbientSurfaceState>();
  const [avatarYawDegrees, setAvatarYawDegrees] = useState(0);
  const [avatarBounds, setAvatarBounds] = useState<DesktopRectangle>();
  const [adapterMode, setAdapterMode] = useState<'runtime' | 'simulation'>(
    visualTestState ? 'simulation' : 'runtime',
  );
  const [gateway, setGateway] = useState<AdapterConnectionState>(initialGateway);
  const [availableAdapters, setAvailableAdapters] = useState<AdapterDescriptor[]>([
    openClawAdapterDescriptor,
  ]);
  const [selectedAdapterId, setSelectedAdapterId] = useState(initialGateway.adapterId);
  const [showConnection, setShowConnection] = useState(true);
  const [controlView, setControlView] = useState<'home' | 'companions'>(
    visualTestState === 'marketplace' ? 'companions' : 'home',
  );
  const [marketplaceCatalog, setMarketplaceCatalog] = useState<MarketplaceCatalog>();
  const [marketplaceCache, setMarketplaceCache] = useState<MarketplaceCacheInventory>();
  const [marketplaceError, setMarketplaceError] = useState('');
  const [marketplaceThumbnails, setMarketplaceThumbnails] = useState<Record<string, string>>({});
  const [avatarSelection, setAvatarSelection] = useState<AvatarSelectionState>(initialAvatarSelection);
  const [marketplaceBusyAvatarId, setMarketplaceBusyAvatarId] = useState('');
  const [marketplaceCacheBusyAvatarId, setMarketplaceCacheBusyAvatarId] = useState('');
  const [marketplacePreviewAvatarId, setMarketplacePreviewAvatarId] = useState('');
  const [gatewayUrl, setGatewayUrl] = useState(initialGateway.endpoint);
  const [authKind, setAuthKind] = useState<OpenClawAuthKind>('token');
  const [credential, setCredential] = useState('');
  const [rememberCredential, setRememberCredential] = useState(true);
  const [hermesEndpoint, setHermesEndpoint] = useState('http://127.0.0.1:8642');
  const [hermesToken, setHermesToken] = useState('');
  const [rememberHermesToken, setRememberHermesToken] = useState(true);
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [rememberClaudeApiKey, setRememberClaudeApiKey] = useState(true);
  const [claudePermissionMode, setClaudePermissionMode] = useState<'plan' | 'default'>('plan');
  const [claudeWorkspace, setClaudeWorkspace] = useState<CodexWorkspaceGrantSummary>();
  const [codexWorkspace, setCodexWorkspace] = useState<CodexWorkspaceGrantSummary>();
  const [codexSandbox, setCodexSandbox] = useState<CodexSandboxMode>('read-only');
  const [busy, setBusy] = useState(false);
  const [uiError, setUiError] = useState('');
  const [animationBusy, setAnimationBusy] = useState(false);
  const [animationState, setAnimationState] = useState<LocalAnimationPreviewState>(
    initialLocalAnimationPreviewState,
  );
  const [motionPreference, setMotionPreference] = useState<MotionPreference>('system');
  const [motionPersonality, setMotionPersonality] = useState<MotionPersonalityPolicy>(
    defaultMotionPersonality,
  );
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [composerExpanded, setComposerExpanded] = useState(visualTestState === 'composer');
  const ambientPromptRef = useRef<HTMLInputElement>(null);

  const refreshMarketplaceCache = useCallback(() => window.desky.marketplace.getCacheInventory()
    .then(setMarketplaceCache)
    .catch((error: unknown) => setMarketplaceError(errorMessage(error))), []);

  useEffect(() => {
    if (!marketplacePreviewAvatarId) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMarketplacePreviewAvatarId('');
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [marketplacePreviewAvatarId]);
  const adapterModeRef = useRef(adapterMode);
  const pendingDraftTextRef = useRef<string | null>(null);
  const motionCueSequenceRef = useRef(0);
  const ambientManipulationActiveRef = useRef(false);
  const suppressAvatarClickUntilRef = useRef(0);
  const avatarHitTestRef = useRef<AvatarHitTest | undefined>(undefined);
  const avatarManipulationRef = useRef<{
    moved: boolean;
    mode: 'move' | 'rotate';
    pointerId: number;
    startPointerX: number;
    startPointerY: number;
    currentYawDegrees: number;
    startYawDegrees: number;
  } | undefined>(undefined);
  const [motionCue, setMotionCue] = useState<{
    id: string;
    kind: MotionCueKind;
    source: MotionCueSource;
  }>();

  useEffect(() => {
    void window.desky.getRuntimeInfo().then((info) => {
      document.body.dataset.deskySurface = info.surface;
      setRuntimeInfo(info);
    });
    void window.desky.adapters.getState().then((next) => {
      setGateway(next);
      setSelectedAdapterId(next.adapterId);
      setGatewayUrl(next.endpoint);
      if (next.adapterId === hermesAdapterDescriptor.adapterId && next.endpoint) {
        setHermesEndpoint(next.endpoint);
      }
      if (next.authenticationMethod === 'token' || next.authenticationMethod === 'password') {
        setAuthKind(next.authenticationMethod);
      }
      setShowConnection(next.status !== 'connected');
    });
    void window.desky.adapters.list().then(setAvailableAdapters);
    const removeState = window.desky.adapters.onState(setGateway);
    const acceptCompanionState = (next: CompanionSnapshot) => {
      if (adapterModeRef.current !== 'runtime') return;
      setState((current) => next.revision >= current.revision ? next : current);
    };
    const acceptDraft = (next: CompanionDraftSnapshot) => {
      const pendingText = pendingDraftTextRef.current;
      if (pendingText !== null && next.text !== pendingText) return;
      if (pendingText === next.text) pendingDraftTextRef.current = null;
      setDraft((current) => next.revision >= current.revision ? next : current);
    };
    const removeCompanionState = window.desky.companion.onState(acceptCompanionState);
    const acceptAgentAction = (command: AgentActionCommand) => {
      if (adapterModeRef.current !== 'runtime') return;
      setMotionCue({
        id: command.commandId,
        kind: command.payload.action,
        source: 'agent',
      });
    };
    const removeCompanionAction = window.desky.companion.onAction(acceptAgentAction);
    const removeDraft = window.desky.companion.onDraft(acceptDraft);
    void window.desky.companion.getState().then(acceptCompanionState);
    void window.desky.companion.getDraft().then(acceptDraft);
    void window.desky.getAmbientSurfaceState().then(setAmbientState);
    const removeAmbientState = window.desky.onAmbientSurfaceState(setAmbientState);
    void window.desky.animation.getState().then(setAnimationState);
    const removeAnimationState = window.desky.animation.onState(setAnimationState);
    void window.desky.getMotionPreference().then(setMotionPreference);
    const removeMotionPreference = window.desky.onMotionPreference(setMotionPreference);
    void window.desky.getMotionPersonality().then(setMotionPersonality);
    const removeMotionPersonality = window.desky.onMotionPersonality(setMotionPersonality);
    const acceptAvatarSelection = (next: AvatarSelectionState) => {
      setAvatarSelection(next);
      if (next.error) setMarketplaceError(next.error);
    };
    void window.desky.avatar.getSelectionState().then(acceptAvatarSelection);
    const removeAvatarSelection = window.desky.avatar.onSelectionState(acceptAvatarSelection);
    return () => {
      removeState();
      removeCompanionState();
      removeCompanionAction();
      removeDraft();
      removeAmbientState();
      removeAnimationState();
      removeMotionPreference();
      removeMotionPersonality();
      removeAvatarSelection();
    };
  }, []);

  useEffect(() => {
    if (runtimeInfo?.surface !== 'control-center') return;
    void window.desky.marketplace.getCatalog()
      .then(setMarketplaceCatalog)
      .catch((error: unknown) => setMarketplaceError(errorMessage(error)));
    void refreshMarketplaceCache();
  }, [refreshMarketplaceCache, runtimeInfo?.surface]);

  useEffect(() => {
    if (!marketplaceCatalog) return undefined;
    let disposed = false;
    const objectUrls: string[] = [];
    void Promise.all(marketplaceCatalog.avatars.map(async (avatar) => {
      const thumbnail = await window.desky.marketplace.getThumbnail(avatar.avatarId);
      const objectUrl = URL.createObjectURL(new Blob([thumbnail.bytes], { type: thumbnail.mediaType }));
      objectUrls.push(objectUrl);
      return [avatar.avatarId, objectUrl] as const;
    })).then((entries) => {
      if (!disposed) {
        setMarketplaceThumbnails(Object.fromEntries(entries));
        void refreshMarketplaceCache();
      }
    }).catch((error: unknown) => {
      if (!disposed) setMarketplaceError(errorMessage(error));
    });
    return () => {
      disposed = true;
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl);
    };
  }, [marketplaceCatalog, refreshMarketplaceCache]);

  useEffect(() => {
    adapterModeRef.current = adapterMode;
    if (adapterMode === 'runtime') {
      void window.desky.companion.getState().then((next) => {
        setState(next);
      });
    }
  }, [adapterMode]);

  useEffect(() => {
    if (ambientState && !ambientManipulationActiveRef.current) {
      setAvatarYawDegrees(ambientState.avatarYawDegrees);
    }
  }, [ambientState]);

  useEffect(() => {
    if (runtimeInfo?.surface !== 'ambient' || ambientState?.fullClickThrough) return undefined;
    let lastRegion: 'interactive' | 'transparent' | undefined;
    const reportRegion = (region: 'interactive' | 'transparent') => {
      if (lastRegion === region) return;
      lastRegion = region;
      window.desky.setAmbientPointerRegion(region);
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (ambientManipulationActiveRef.current) {
        reportRegion('interactive');
        return;
      }
      const interactive = document.elementsFromPoint(event.clientX, event.clientY)
        .some((element) => element.closest('[data-desky-interactive="true"]'));
      reportRegion(interactive ? 'interactive' : 'transparent');
    };
    const handleMouseLeave = () => reportRegion('transparent');
    reportRegion('transparent');
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mouseleave', handleMouseLeave, true);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('mouseleave', handleMouseLeave, true);
    };
  }, [ambientState?.fullClickThrough, runtimeInfo?.surface]);

  useEffect(() => {
    if (adapterMode !== 'simulation') return;
    if (visualTestState === 'thinking') {
      setState({
        ...initialCompanionSnapshot,
        revision: 1,
        mode: 'thinking',
        label: 'Thinking',
        detail: 'Reference performance fixture',
        activeTurnId: 'visual-test-thinking',
      });
      return;
    }
    let active = true;
    void (async () => {
      for await (const event of simulation.connect()) {
        if (active) setState((current) => reduceCompanionSnapshot(current, event));
      }
    })();
    return () => { active = false; };
  }, [adapterMode, simulation]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (visualTestState !== 'response' || adapterMode !== 'simulation') return;
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        for await (const event of simulation.run('Show the packaged response bubble.')) {
          if (!active) return;
          setState((current) => reduceCompanionSnapshot(current, event));
        }
      })();
    }, 400);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [adapterMode, simulation]);

  const updateDraft = (text: string) => {
    pendingDraftTextRef.current = text;
    setDraft((current) => ({ ...current, text }));
    void window.desky.companion.setDraft(text).then((next) => {
      if (pendingDraftTextRef.current === next.text) pendingDraftTextRef.current = null;
      setDraft((current) => {
        if (pendingDraftTextRef.current !== null && next.text !== pendingDraftTextRef.current) return current;
        return next.revision >= current.revision ? next : current;
      });
    }).catch((error: unknown) => setUiError(errorMessage(error)));
  };

  const withBusy = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setUiError('');
    try {
      await operation();
    } catch (error) {
      setUiError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const connectOpenClaw = () => withBusy(async () => {
    const next = await window.desky.adapters.connect({
      adapterId: selectedAdapterId,
      configuration: {
        gatewayUrl,
        authKind,
        credential: credential || undefined,
        rememberCredential,
      },
    });
    setGateway(next);
    setSelectedAdapterId(next.adapterId);
    setCredential('');
    setShowConnection(next.status !== 'connected');
  });

  const selectCodexWorkspace = () => withBusy(async () => {
    const selection = await window.desky.codexWorkspace.select(codexSandbox);
    if (selection.status !== 'selected') return;
    const previous = codexWorkspace;
    setCodexWorkspace(selection.grant);
    if (previous && previous.grantId !== selection.grant.grantId) {
      await window.desky.codexWorkspace.revoke(previous.grantId);
    }
  });

  const changeCodexSandbox = (mode: CodexSandboxMode) => {
    if (mode === 'workspace-write'
      && codexWorkspace
      && codexWorkspace.maximumSandbox !== 'workspace-write') {
      void window.desky.codexWorkspace.revoke(codexWorkspace.grantId).catch(() => undefined);
      setCodexWorkspace(undefined);
    }
    setCodexSandbox(mode);
  };

  const connectCodex = () => withBusy(async () => {
    if (!codexWorkspace) throw new Error('Choose a Codex workspace first.');
    const next = await window.desky.adapters.connect({
      adapterId: selectedAdapterId,
      configuration: {
        workspaceGrantId: codexWorkspace.grantId,
        sandbox: codexSandbox,
      },
    });
    setGateway(next);
    setSelectedAdapterId(next.adapterId);
    setShowConnection(next.status !== 'connected');
  });

  const connectHermes = () => withBusy(async () => {
    const next = await window.desky.adapters.connect({
      adapterId: selectedAdapterId,
      configuration: {
        endpoint: hermesEndpoint,
        token: hermesToken || undefined,
        rememberToken: rememberHermesToken,
      },
    });
    setGateway(next);
    setSelectedAdapterId(next.adapterId);
    setHermesToken('');
    setShowConnection(next.status !== 'connected');
  });

  const selectClaudeWorkspace = () => withBusy(async () => {
    const maximumSandbox = claudePermissionMode === 'plan' ? 'read-only' : 'workspace-write';
    const selection = await window.desky.codexWorkspace.select(maximumSandbox);
    if (selection.status !== 'selected') return;
    const previous = claudeWorkspace;
    setClaudeWorkspace(selection.grant);
    if (previous && previous.grantId !== selection.grant.grantId) {
      await window.desky.codexWorkspace.revoke(previous.grantId);
    }
  });

  const changeClaudePermissionMode = (mode: 'plan' | 'default') => {
    if (mode === 'default'
      && claudeWorkspace
      && claudeWorkspace.maximumSandbox !== 'workspace-write') {
      void window.desky.codexWorkspace.revoke(claudeWorkspace.grantId).catch(() => undefined);
      setClaudeWorkspace(undefined);
    }
    setClaudePermissionMode(mode);
  };

  const connectClaude = () => withBusy(async () => {
    if (!claudeWorkspace) throw new Error('Choose a Claude workspace first.');
    const next = await window.desky.adapters.connect({
      adapterId: selectedAdapterId,
      configuration: {
        workspaceGrantId: claudeWorkspace.grantId,
        apiKey: claudeApiKey || undefined,
        rememberApiKey: rememberClaudeApiKey,
        permissionMode: claudePermissionMode,
      },
    });
    setGateway(next);
    setSelectedAdapterId(next.adapterId);
    setClaudeApiKey('');
    setShowConnection(next.status !== 'connected');
  });

  const withAnimationBusy = async (operation: () => Promise<void>) => {
    if (animationBusy) return;
    setAnimationBusy(true);
    try {
      await operation();
    } catch (error) {
      setAnimationState((current) => ({
        ...current,
        status: 'error',
        message: errorMessage(error),
      }));
    } finally {
      setAnimationBusy(false);
    }
  };

  const run = () => withBusy(async () => {
    const text = draft.text.trim();
    if (!text) return;
    if (adapterMode === 'simulation') {
      for await (const event of simulation.run(text)) {
        setState((current) => reduceCompanionSnapshot(current, event));
      }
    } else {
      await window.desky.adapters.send(text);
    }
    updateDraft('');
    setComposerExpanded(false);
  });

  const connected = adapterMode === 'simulation' || gateway.status === 'connected';
  const selectedAdapter = availableAdapters.find(
    (descriptor) => descriptor.adapterId === selectedAdapterId,
  ) ?? gateway.descriptor;
  const selectedAdapterConnected = gateway.adapterId === selectedAdapter.adapterId
    && gateway.status === 'connected';
  const hasSession = adapterMode === 'simulation'
    || gateway.descriptor.sessionSelection !== 'required'
    || Boolean(gateway.selectedSessionId);
  const effectiveReducedMotion = motionPreference === 'reduced'
    || (motionPreference === 'system' && systemReducedMotion)
    || motionPersonality.preset === 'paused';
  const runtimeLabel = adapterMode === 'simulation' ? 'Simulation' : gateway.descriptor.displayName;
  const connectionStatus = adapterMode === 'simulation' ? 'simulation' : gateway.status;
  const statusDetail = adapterMode === 'runtime' && gateway.status !== 'connected'
    ? gateway.message
    : state.detail;
  const recoveryShortcutLabel = runtimeInfo?.platform === 'darwin'
    ? 'Cmd+Shift+D'
    : 'Ctrl+Shift+D';
  const activeRun = adapterMode === 'runtime' && Boolean(gateway.activeTurnId);
  const meaningfulModes = ['listening', 'thinking', 'working', 'approval', 'speaking', 'success', 'cancelled', 'error'];
  const bubbleMessage = uiError || state.bubbleText || (meaningfulModes.includes(state.mode) ? statusDetail : '');
  const showAmbientBubble = Boolean(bubbleMessage)
    && (Boolean(uiError) || meaningfulModes.includes(state.mode));

  const openComposer = () => {
    if (!connected || !hasSession) {
      window.desky.performWindowAction('open-control-center');
      return;
    }
    setComposerExpanded(true);
    requestAnimationFrame(() => ambientPromptRef.current?.focus());
  };

  const requestAvatarMotion = (kind: MotionCueKind) => {
    motionCueSequenceRef.current += 1;
    setMotionCue({
      id: `ambient-${kind}-${motionCueSequenceRef.current}`,
      kind,
      source: 'user',
    });
  };

  const persistAvatarYaw = (degrees: number) => {
    const normalized = normalizeAvatarYaw(degrees);
    setAvatarYawDegrees(normalized);
    window.desky.setAmbientAvatarYaw(normalized);
  };

  const acceptAvatarHitTest = useCallback((hitTest: AvatarHitTest | undefined) => {
    avatarHitTestRef.current = hitTest;
  }, []);

  const beginAvatarManipulation = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const hitAvatar = avatarHitTestRef.current?.(event.clientX, event.clientY) ?? true;
    const mode = resolveAvatarDragMode({
      hitAvatar,
      forceRotate: event.shiftKey || event.altKey,
    });
    avatarManipulationRef.current = {
      moved: false,
      mode,
      pointerId: event.pointerId,
      startPointerX: event.screenX,
      startPointerY: event.screenY,
      currentYawDegrees: avatarYawDegrees,
      startYawDegrees: avatarYawDegrees,
    };
    ambientManipulationActiveRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === 'move') {
      window.desky.dragAmbient({
        phase: 'start',
        pointerX: event.screenX,
        pointerY: event.screenY,
      });
    }
  };

  const continueAvatarManipulation = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const manipulation = avatarManipulationRef.current;
    if (!manipulation || manipulation.pointerId !== event.pointerId) return;
    const deltaX = event.screenX - manipulation.startPointerX;
    const deltaY = event.screenY - manipulation.startPointerY;
    if (!manipulation.moved && Math.hypot(deltaX, deltaY) < 5) return;
    manipulation.moved = true;
    if (manipulation.mode === 'move') {
      window.desky.dragAmbient({
        phase: 'move',
        pointerX: event.screenX,
        pointerY: event.screenY,
      });
      return;
    }
    manipulation.currentYawDegrees = normalizeAvatarYaw(manipulation.startYawDegrees + deltaX * 0.65);
    setAvatarYawDegrees(manipulation.currentYawDegrees);
  };

  const endAvatarManipulation = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const manipulation = avatarManipulationRef.current;
    if (!manipulation || manipulation.pointerId !== event.pointerId) return;
    if (manipulation.mode === 'move') {
      window.desky.dragAmbient({
        phase: 'end',
        pointerX: event.screenX,
        pointerY: event.screenY,
      });
    } else if (manipulation.moved) {
      persistAvatarYaw(manipulation.currentYawDegrees);
    }
    if (manipulation.moved) suppressAvatarClickUntilRef.current = performance.now() + 350;
    avatarManipulationRef.current = undefined;
    ambientManipulationActiveRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const rotateAvatarFromWheel = (event: ReactWheelEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const direction = Math.sign(event.deltaY || event.deltaX);
    if (direction !== 0) persistAvatarYaw(avatarYawDegrees + direction * 12);
  };

  const rotateAvatarFromKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Home') {
      event.preventDefault();
      persistAvatarYaw(0);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    persistAvatarYaw(avatarYawDegrees + (event.key === 'ArrowLeft' ? -15 : 15));
  };

  const resolveApproval = (decision: 'allow-once' | 'allow-always' | 'deny') => {
    const approval = state.pendingApproval;
    if (!approval) return Promise.resolve();
    return window.desky.adapters.resolveApproval({
      requestId: approval.requestId,
      kind: approval.kind,
      decision,
    });
  };

  const approvalCard = state.pendingApproval && adapterMode === 'runtime' ? (
    <section className="approval-card" aria-label="Approval required">
      <strong>{state.pendingApproval.action}</strong>
      <p>{state.pendingApproval.safeTarget}</p>
      <div>
        {state.pendingApproval.allowedDecisions.includes('allow-once') ? (
          <button data-approval-decision="allow-once" type="button" disabled={busy} onClick={() => void withBusy(() => resolveApproval('allow-once'))}>Allow once</button>
        ) : null}
        {state.pendingApproval.allowedDecisions.includes('allow-always') ? (
          <button type="button" disabled={busy} onClick={() => void withBusy(() => resolveApproval('allow-always'))}>Always</button>
        ) : null}
        <button data-approval-decision="deny" className="danger" type="button" disabled={busy} onClick={() => void withBusy(() => resolveApproval('deny'))}>Deny</button>
      </div>
    </section>
  ) : null;

  if (!runtimeInfo) {
    return <main className="surface-loading" aria-label="Starting Desky" />;
  }

  if (runtimeInfo.surface === 'ambient') {
    return (
      <main
        className={`ambient-companion companion--${state.mode}`}
        aria-label="Desky desktop companion"
        data-bubble-placement={ambientState?.bubblePlacement ?? 'above'}
        data-avatar-yaw-degrees={avatarYawDegrees}
        data-bubble-visible={showAmbientBubble}
        data-composer-expanded={composerExpanded}
        data-horizontal-placement={ambientState?.horizontalPlacement ?? 'center'}
        data-recovery-available={ambientState?.recoveryAvailable ?? false}
        data-visibility-recovery-count={ambientState?.visibilityRecoveryCount ?? 0}
      >
        {composerExpanded ? (
          <>
            <div className="ambient-drag-handle" data-desky-interactive="true" title="Drag Desky" aria-label="Drag Desky">•••</div>
            <div className="ambient-actions" data-desky-interactive="true">
              <button type="button" aria-label="Wave hello" title="Wave hello" onClick={() => requestAvatarMotion('wave')}>✦</button>
              <button type="button" aria-label="Open Desky control center" onClick={() => window.desky.performWindowAction('open-control-center')}>⚙</button>
              <button type="button" aria-label="Enable full click-through" title={`Click through everything; recover with the tray or ${recoveryShortcutLabel}`} onClick={() => window.desky.performWindowAction('toggle-full-click-through')}>⇥</button>
              <button type="button" aria-label="Hide Desky companion" onClick={() => window.desky.performWindowAction('hide-ambient')}>×</button>
            </div>

            <button
              type="button"
              className={`ambient-status connection-badge connection-badge--${connectionStatus}`}
              data-desky-interactive="true"
              onClick={() => window.desky.performWindowAction('open-control-center')}
              title={statusDetail}
            >
              <span className="status-dot" aria-hidden="true" />
              <span>{runtimeLabel} · {connectionStatus}</span>
            </button>
          </>
        ) : null}

        {showAmbientBubble ? (
          <section className="ambient-speech-bubble" data-desky-interactive="true" aria-live="polite">
            <strong>{uiError ? 'Needs attention' : state.label}</strong>
            <p>{bubbleMessage}</p>
            {state.pendingApproval && adapterMode === 'runtime' ? (
              <div className="ambient-approval-actions" aria-label="Approval choices">
                {state.pendingApproval.allowedDecisions.includes('allow-once') ? (
                  <button type="button" disabled={busy} onClick={() => void withBusy(() => resolveApproval('allow-once'))}>Allow once</button>
                ) : null}
                <button type="button" className="danger" disabled={busy} onClick={() => void withBusy(() => resolveApproval('deny'))}>Deny</button>
                <button type="button" className="quiet" onClick={() => window.desky.performWindowAction('open-control-center')}>Details</button>
              </div>
            ) : state.bubbleOverflow || uiError ? (
              <button type="button" className="ambient-open-conversation" onClick={() => window.desky.performWindowAction('open-control-center')}>
                Open conversation
              </button>
            ) : null}
          </section>
        ) : null}

        <div className="ambient-avatar">
          <AvatarStage
            avatarRevisionId={avatarSelection.pendingRevisionId ?? avatarSelection.activeRevisionId}
            mode={state.mode}
            motionPersonality={motionPersonality}
            motionPreference={motionPreference}
            motionCue={motionCue}
            onVisibleBounds={setAvatarBounds}
            onHitTestReady={acceptAvatarHitTest}
            powerSuspended={ambientState?.powerSuspended ?? false}
            resumeEpoch={ambientState?.resumeEpoch ?? 0}
            surfaceVisible={ambientState?.visible ?? true}
            viewYawDegrees={avatarYawDegrees}
          />
          {avatarBounds ? (
            <button
              type="button"
              className="ambient-avatar-hitbox"
              data-desky-interactive="true"
              aria-label="Move or rotate the Desky companion"
              title="Drag the character to rotate · drag its transparent gaps or the grip to move · double-click to jump"
              style={{
                left: avatarBounds.x,
                top: avatarBounds.y,
                width: avatarBounds.width,
                height: avatarBounds.height,
              }}
              onPointerDown={beginAvatarManipulation}
              onPointerMove={continueAvatarManipulation}
              onPointerUp={endAvatarManipulation}
              onPointerCancel={endAvatarManipulation}
              onWheel={rotateAvatarFromWheel}
              onKeyDown={rotateAvatarFromKeyboard}
              onClick={() => {
                if (performance.now() < suppressAvatarClickUntilRef.current) return;
                openComposer();
              }}
              onDoubleClick={() => {
                if (performance.now() < suppressAvatarClickUntilRef.current) return;
                requestAvatarMotion('jump');
              }}
            />
          ) : null}
        </div>

        {effectiveReducedMotion ? (
          <button
            type="button"
            className="ambient-motion-status"
            data-desky-interactive="true"
            onClick={() => window.desky.performWindowAction('open-control-center')}
            title={motionPersonality.preset === 'paused'
              ? 'Companion energy is paused. Choose another preset in the control center.'
              : 'Motion is reduced. Review accessibility motion in the control center.'}
          >
            {motionPersonality.preset === 'paused' ? 'Companion paused' : 'Motion reduced'} · Open settings
          </button>
        ) : null}

        {composerExpanded && connected && hasSession ? (
          <form
            className="ambient-prompt ambient-prompt--expanded"
            data-desky-interactive="true"
            onSubmit={(event) => { event.preventDefault(); void run(); }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              setComposerExpanded(false);
            }}
          >
            <label className="sr-only" htmlFor="ambient-prompt">Message</label>
            <input ref={ambientPromptRef} id="ambient-prompt" value={draft.text} onChange={(event) => updateDraft(event.target.value)} disabled={busy} autoComplete="off" placeholder="Ask Desky anything…" />
            {activeRun ? (
              <button className="cancel-button" type="button" disabled={busy} onClick={() => void withBusy(() => window.desky.adapters.cancel())}>Stop</button>
            ) : (
              <button type="submit" disabled={busy || !draft.text.trim()}>{busy ? '…' : 'Send'}</button>
            )}
          </form>
        ) : (
          <div className="ambient-launcher" data-desky-interactive="true">
            {activeRun ? (
              <button className="ambient-stop" type="button" disabled={busy} onClick={() => void withBusy(() => window.desky.adapters.cancel())}>Stop</button>
            ) : (
              <button type="button" onClick={openComposer}>
                {connected ? (hasSession ? 'Ask Desky…' : 'Choose a session') : 'Connect an agent'}
              </button>
            )}
          </div>
        )}
      </main>
    );
  }

  if (controlView === 'companions') {
    const admittedCount = marketplaceCatalog?.avatars.filter(
      (avatar) => avatar.admissionStatus === 'admitted',
    ).length ?? 0;
    const previewAvatar = marketplaceCatalog?.avatars.find(
      (avatar) => avatar.avatarId === marketplacePreviewAvatarId,
    );
    return (
      <main
        className="companion control-center marketplace-view"
        data-avatar-selection={avatarSelection.status}
        data-active-avatar-id={avatarSelection.activeAvatarId}
      >
        <header className="control-center__header">
          <div className="brand">
            <DeskyBrandMark />
            <div><strong>Companions</strong><span>Desky Marketplace foundation</span></div>
          </div>
          <div className="control-center__actions">
            <button type="button" onClick={() => setControlView('home')}>Back to control center</button>
            <button type="button" onClick={() => window.desky.performWindowAction('show-ambient')}>Show companion</button>
          </div>
        </header>

        <section className="marketplace-hero" aria-labelledby="marketplace-title">
          <div>
            <span className="marketplace-kicker">Commerce disabled · free foundation</span>
            <h1 id="marketplace-title">Choose a companion you can trust.</h1>
            <p>Every visible companion must pass rights, VRM, motion, performance, and provenance admission. Locked offers will not appear until human-approved checkout and durable restore are implemented.</p>
          </div>
          <dl>
            <div><dt>Admitted now</dt><dd>{admittedCount}</dd></div>
            <div><dt>Free launch target</dt><dd>{marketplaceCatalog?.targetFreeAvatarCount ?? 3}</dd></div>
            <div><dt>Payment rails</dt><dd>Off</dd></div>
          </dl>
        </section>

        {marketplaceError ? <p className="marketplace-error" role="alert">{marketplaceError}</p> : null}
        {!marketplaceCatalog && !marketplaceError ? <p className="marketplace-loading" role="status">Loading the verified local catalog…</p> : null}

        {marketplaceCache ? (
          <section
            className="marketplace-storage"
            aria-label="Companion storage"
            data-cache-total-bytes={marketplaceCache.totalBytes}
            data-cache-maximum-bytes={marketplaceCache.maximumBytes}
          >
            <div>
              <span>Offline model storage</span>
              <strong>{formatStorageBytes(marketplaceCache.totalBytes)}</strong>
              <small>of {formatStorageBytes(marketplaceCache.maximumBytes)} cache ceiling</small>
            </div>
            <p>Removing a model download never removes the companion from your library. Active, rollback, and pending models stay protected; any removed model is verified again before reuse.</p>
          </section>
        ) : null}

        {previewAvatar ? (
          <section className="marketplace-preview" role="dialog" aria-modal="true" aria-labelledby="marketplace-preview-title">
            <button
              type="button"
              className="marketplace-preview__backdrop"
              aria-label="Close companion preview"
              onClick={() => setMarketplacePreviewAvatarId('')}
            />
            <div className="marketplace-preview__panel">
              <div className="marketplace-preview__visual">
                <MarketplaceAvatarPreview
                  avatarId={previewAvatar.avatarId}
                  onReady={refreshMarketplaceCache}
                />
              </div>
              <div className="marketplace-preview__details">
                <div className="marketplace-preview__heading">
                  <span>Verified local preview</span>
                  <button type="button" onClick={() => setMarketplacePreviewAvatarId('')} aria-label="Close preview">×</button>
                </div>
                <h2 id="marketplace-preview-title">{previewAvatar.name}</h2>
                <p>{previewAvatar.description}</p>
                <dl>
                  <div><dt>Creator</dt><dd>{previewAvatar.creator}</dd></div>
                  <div><dt>Licence</dt><dd>{previewAvatar.licenseId}</dd></div>
                  <div><dt>Runtime</dt><dd>VRM {previewAvatar.vrmVersion}</dd></div>
                  <div><dt>Footprint</dt><dd>{previewAvatar.performanceClass}</dd></div>
                </dl>
                <p className="marketplace-attribution">{previewAvatar.attribution}</p>
                <div className="marketplace-preview__actions">
                  <button type="button" onClick={() => void window.desky.marketplace.openSource(previewAvatar.avatarId)
                    .catch((error: unknown) => setMarketplaceError(errorMessage(error)))}>Source & licence</button>
                  <button
                    type="button"
                    disabled={marketplaceBusyAvatarId.length > 0
                      || previewAvatar.avatarId === avatarSelection.activeAvatarId}
                    onClick={() => {
                      setMarketplaceError('');
                      setMarketplaceBusyAvatarId(previewAvatar.avatarId);
                      void window.desky.marketplace.activate(previewAvatar.avatarId)
                        .then(setAvatarSelection)
                        .then(() => refreshMarketplaceCache())
                        .then(() => {
                          setMarketplacePreviewAvatarId('');
                          return window.desky.performWindowAction('show-ambient');
                        })
                        .catch((error: unknown) => setMarketplaceError(errorMessage(error)))
                        .finally(() => setMarketplaceBusyAvatarId(''));
                    }}
                  >{previewAvatar.avatarId === avatarSelection.activeAvatarId
                      ? 'Active companion' : marketplaceBusyAvatarId ? 'Switching…' : 'Use companion'}</button>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="marketplace-grid" aria-label="Available companions">
          {marketplaceCatalog?.avatars.map((avatar) => {
            const active = avatar.avatarId === avatarSelection.activeAvatarId
              && avatarSelection.pendingAvatarId === undefined;
            const pending = avatar.avatarId === avatarSelection.pendingAvatarId;
            const cacheEntry = marketplaceCache?.entries.find(
              (entry) => entry.avatarId === avatar.avatarId,
            );
            const storageLabel = cacheEntry?.modelStatus === 'verified'
              ? `${formatStorageBytes(cacheEntry.modelBytes)} offline`
              : cacheEntry?.modelStatus === 'corrupt' ? 'Repair needed' : 'Online only';
            return (
            <article
              className={`marketplace-avatar-card marketplace-avatar-card--${avatar.productId.replace('avatar.', '')}`}
              key={avatar.avatarId}
              data-avatar-card-id={avatar.avatarId}
              data-avatar-cache-status={cacheEntry?.modelStatus ?? 'loading'}
              data-avatar-cache-protected={String(Boolean(cacheEntry?.protectionReasons.length))}
            >
              <div className="marketplace-avatar-card__visual" aria-hidden="true">
                {marketplaceThumbnails[avatar.avatarId]
                  ? <img src={marketplaceThumbnails[avatar.avatarId]} alt="" />
                  : <span>{avatar.name.slice(0, 1)}</span>}
                <small>{avatar.vrmVersion}</small>
              </div>
              <div className="marketplace-avatar-card__body">
                <div className="marketplace-avatar-card__title">
                  <div><h2>{avatar.name}</h2><span>{avatar.creator}</span></div>
                  <span className="marketplace-chip marketplace-chip--free">Free</span>
                </div>
                <p>{avatar.description}</p>
                <div className="marketplace-avatar-card__facts">
                  <span>{avatar.licenseId}</span>
                  <span>{avatar.performanceClass} footprint</span>
                  <span>85 admitted motions</span>
                </div>
                <p className="marketplace-attribution">{avatar.attribution}</p>
                <div className="marketplace-avatar-card__storage">
                  <span>{storageLabel}</span>
                  {cacheEntry?.protectionReasons.length
                    ? <small>{cacheEntry.protectionReasons.join(' + ')} protected</small>
                    : <button
                        type="button"
                        data-avatar-remove-id={avatar.avatarId}
                        disabled={!cacheEntry?.removable
                          || marketplaceCacheBusyAvatarId.length > 0
                          || marketplaceBusyAvatarId.length > 0}
                        onClick={() => {
                          setMarketplaceError('');
                          setMarketplaceCacheBusyAvatarId(avatar.avatarId);
                          void window.desky.marketplace.removeDownload(avatar.avatarId)
                            .then(setMarketplaceCache)
                            .catch((error: unknown) => setMarketplaceError(errorMessage(error)))
                            .finally(() => setMarketplaceCacheBusyAvatarId(''));
                        }}
                      >{marketplaceCacheBusyAvatarId === avatar.avatarId ? 'Removing…' : 'Remove model'}</button>}
                </div>
                <div className="marketplace-avatar-card__actions">
                  <button
                    type="button"
                    data-avatar-preview-id={avatar.avatarId}
                    onClick={() => setMarketplacePreviewAvatarId(avatar.avatarId)}
                  >3D preview</button>
                  <button
                    type="button"
                    data-avatar-id={avatar.avatarId}
                    disabled={active || pending || marketplaceBusyAvatarId.length > 0}
                    onClick={() => {
                      setMarketplaceError('');
                      setMarketplaceBusyAvatarId(avatar.avatarId);
                      void window.desky.marketplace.activate(avatar.avatarId)
                        .then(setAvatarSelection)
                        .then(() => refreshMarketplaceCache())
                        .then(() => window.desky.performWindowAction('show-ambient'))
                        .catch((error: unknown) => setMarketplaceError(errorMessage(error)))
                        .finally(() => setMarketplaceBusyAvatarId(''));
                    }}
                  >{pending || marketplaceBusyAvatarId === avatar.avatarId
                      ? 'Switching…'
                      : active ? 'Active companion' : 'Use companion'}</button>
                </div>
              </div>
            </article>
            );
          })}
          {Array.from({ length: Math.max(0, 3 - admittedCount) }, (_, index) => (
            <article className="marketplace-avatar-card marketplace-avatar-card--candidate" key={`candidate-${index}`}>
              <div className="marketplace-avatar-card__candidate-icon" aria-hidden="true">+</div>
              <h2>Free companion slot {admittedCount + index + 1}</h2>
              <p>Reserved for a real CC0 avatar after binary compatibility, embedded-rights, motion, and packaged performance review.</p>
              <span>Admission in progress</span>
            </article>
          ))}
        </section>

        <section className="marketplace-payment-explainer" aria-labelledby="marketplace-payment-title">
          <div>
            <span>Future paid catalog</span>
            <h2 id="marketplace-payment-title">The person initiates every payment.</h2>
          </div>
          <ol>
            <li><strong>Discover</strong><span>Choose here, or ask an agent to search and prepare an offer.</span></li>
            <li><strong>Verify</strong><span>Desky independently loads the exact product, USDC amount, network, merchant, and expiry.</span></li>
            <li><strong>Approve</strong><span>You confirm in Desky and sign in your wallet. Agents never receive wallet authority.</span></li>
          </ol>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`companion control-center companion--${state.mode}`}
      data-active-adapter-id={gateway.adapterId}
      data-adapter-status={gateway.status}
      data-active-turn-id={gateway.activeTurnId ?? ''}
      data-companion-mode={state.mode}
      data-selected-adapter-id={selectedAdapter.adapterId}
    >
      <header className="control-center__header">
        <div className="brand">
          <DeskyBrandMark />
          <div><strong>Desky</strong><span>Control Center</span></div>
        </div>
        <div className="control-center__actions">
          <button type="button" onClick={() => setControlView('companions')}>Companions</button>
          <button type="button" onClick={() => window.desky.performWindowAction('show-ambient')}>Show companion</button>
          <button
            type="button"
            className={`connection-badge connection-badge--${connectionStatus}`}
            onClick={() => setShowConnection((value) => !value)}
          >
            {runtimeLabel} · {connectionStatus}
          </button>
        </div>
      </header>

      <div className="status-row control-center__status" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <strong>{state.label}</strong>
        <span>{statusDetail}</span>
      </div>

      <section className="speech-bubble control-center__bubble" aria-live="polite">
        {state.responseTruncated ? <span className="response-truncation">Earlier response content was omitted from this live view.</span> : null}
        <p>{uiError || state.responseText || state.bubbleText || 'Your agent’s current response will appear here.'}</p>
      </section>

      {approvalCard}

      <section className="desktop-presence-card" aria-label="Desktop presence controls">
        <div>
          <strong>Desktop presence</strong>
          <span>
            Drag the character itself to rotate it. Drag transparent space inside its bounds or the grip to move Desky; Shift/Alt, scroll, and arrow keys also rotate. Outer transparent areas pass clicks. Full click-through is session-only and can always be reversed with {recoveryShortcutLabel} or the tray.
          </span>
        </div>
        <div className="desktop-presence-card__actions">
          <button
            type="button"
            aria-pressed={ambientState?.alwaysOnTop ?? true}
            onClick={() => window.desky.performWindowAction('toggle-always-on-top')}
          >
            Always on top: {ambientState?.alwaysOnTop === false ? 'Off' : 'On'}
          </button>
          <button
            type="button"
            aria-pressed={ambientState?.fullClickThrough ?? false}
            onClick={() => window.desky.performWindowAction('toggle-full-click-through')}
          >
            Full click-through: {ambientState?.fullClickThrough ? 'On' : 'Off'}
          </button>
          <button type="button" onClick={() => window.desky.performWindowAction('reset-ambient-position')}>Reset position</button>
          <button type="button" onClick={() => window.desky.performWindowAction('hide-ambient')}>Hide companion</button>
        </div>
        <p className="desktop-presence-card__status" role="status">
          Companion {ambientState?.visible ? 'visible' : ambientState?.desiredVisible ? 'recovering' : 'hidden'}
          {ambientState?.visibilityRecoveryCount
            ? ` · recovered ${ambientState.visibilityRecoveryCount} time${ambientState.visibilityRecoveryCount === 1 ? '' : 's'}`
            : ''}
        </p>
      </section>

      <section className="motion-personality-card" aria-labelledby="motion-personality-title">
        <div className="motion-personality-card__header">
          <div>
            <strong id="motion-personality-title">Companion energy</strong>
            <span>Choose a temperament. Agent state and reduced-motion safety always take priority.</span>
          </div>
          <span className="motion-personality-card__saved">Saved</span>
        </div>
        <div className="motion-personality-presets" role="group" aria-label="Companion energy preset">
          {motionPersonalityPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={motionPersonality.preset === preset}
              disabled={animationBusy}
              onClick={() => void withAnimationBusy(async () => {
                const next = preset === 'custom'
                  ? { ...motionPersonality, preset: 'custom' as const }
                  : motionPersonalityForPreset(preset);
                setMotionPersonality(await window.desky.setMotionPersonality(next));
              })}
            >{preset[0].toUpperCase()}{preset.slice(1)}</button>
          ))}
        </div>
        <p className="motion-personality-description">
          {motionPersonality.preset === 'paused'
            ? 'Static readable states; autonomous and conversational body motion are paused.'
            : motionPersonality.preset === 'quiet'
              ? 'Calm presence with longer quiet intervals and no playful or roaming breaks.'
              : motionPersonality.preset === 'balanced'
                ? 'Living idle, clear work states, occasional reactions, and rare playful moments.'
                : motionPersonality.preset === 'lively'
                  ? 'More frequent admitted reactions and variety without changing safety priority.'
                  : 'Fine-tune semantic categories; individual animation files remain admission-controlled.'}
        </p>
        {motionPersonality.preset === 'custom' ? (
          <div className="motion-category-grid">
            {motionCategories.map((category) => (
              <label key={category}>
                <span>{category === 'locomotion' ? 'Locomotion & fantasy' : `${category[0].toUpperCase()}${category.slice(1)}`}</span>
                <select
                  value={motionPersonality.categories[category]}
                  disabled={animationBusy}
                  onChange={(event) => void withAnimationBusy(async () => {
                    const level = Number(event.target.value) as MotionCategoryLevel;
                    const next: MotionPersonalityPolicy = {
                      schemaVersion: 1,
                      preset: 'custom',
                      categories: { ...motionPersonality.categories, [category]: level },
                    };
                    setMotionPersonality(await window.desky.setMotionPersonality(next));
                  })}
                >
                  <option value={0}>Off</option>
                  <option value={1}>Low</option>
                  <option value={2}>Normal</option>
                  <option value={3}>High</option>
                </select>
              </label>
            ))}
          </div>
        ) : null}
      </section>

      <section className="animation-preview-card" aria-label="Local animation preview">
        <div className="animation-preview-card__copy">
          <div className="animation-preview-card__title">
            <strong>Local animation preview</strong>
            <span>Session only</span>
          </div>
          <p>Test a rights-cleared <code>.vrma</code> on the current avatar. The file stays in memory and is never added to Desky’s distributable assets.</p>
          <div className="motion-preference" role="group" aria-label="Avatar motion preference">
            <span>Motion</span>
            {(['system', 'full', 'reduced'] as const).map((preference) => (
              <button
                key={preference}
                type="button"
                aria-pressed={motionPreference === preference}
                disabled={animationBusy}
                onClick={() => void withAnimationBusy(async () => {
                  setMotionPreference(await window.desky.setMotionPreference(preference));
                })}
              >{preference === 'system' ? 'System' : preference === 'full' ? 'Full' : 'Reduced'}</button>
            ))}
          </div>
          <span className={`animation-preview-card__status animation-preview-card__status--${animationState.status}`} role="status">
            {animationState.selection ? `${animationState.selection.fileName} · ` : ''}{animationState.message}
          </span>
        </div>
        <div className="animation-preview-card__actions">
          <button
            type="button"
            disabled={animationBusy}
            onClick={() => void withAnimationBusy(async () => {
              const result = await window.desky.animation.select();
              setAnimationState(result.state);
            })}
          >
            {animationBusy ? 'Opening…' : animationState.selection ? 'Choose another' : 'Choose .vrma'}
          </button>
          {animationState.selection ? (
            <>
              <button
                type="button"
                disabled={animationBusy || animationState.status === 'loading' || animationState.status === 'playing'}
                onClick={() => void withAnimationBusy(async () => {
                  setAnimationState(await window.desky.animation.play());
                })}
              >Play again</button>
              <button
                type="button"
                disabled={animationBusy}
                onClick={() => void withAnimationBusy(async () => {
                  setAnimationState(await window.desky.animation.clear());
                })}
              >Clear</button>
            </>
          ) : null}
        </div>
      </section>

      {adapterMode === 'runtime' && gateway.status === 'connected' ? (
        <div className="session-row">
          <label className="sr-only" htmlFor="adapter-session">{gateway.descriptor.displayName} session</label>
          <select
            id="adapter-session"
            value={gateway.selectedSessionId ?? ''}
            disabled={busy}
            onChange={(event) => void withBusy(async () => { setGateway(await window.desky.adapters.selectSession(event.target.value)); })}
          >
            <option value="" disabled>Select a session</option>
            {gateway.sessions.map((session) => <option key={session.id} value={session.id}>{session.label}</option>)}
          </select>
          <button
            type="button"
            data-session-new="true"
            disabled={busy}
            onClick={() => void withBusy(async () => {
              const label = visualTestExercise === 'codex-ui'
                || visualTestExercise === 'hermes-ui'
                || visualTestExercise === 'hermes-ui-saved'
                || visualTestExercise === 'claude-ui'
                || visualTestExercise === 'claude-ui-saved'
                ? `Desky conformance packaged ${new Date().toISOString()}`
                : 'Desky';
              setGateway(await window.desky.adapters.createSession({ label }));
            })}
          >New</button>
          <button type="button" aria-label="Refresh sessions" disabled={busy} onClick={() => void withBusy(async () => { setGateway(await window.desky.adapters.refreshSessions()); })}>↻</button>
        </div>
      ) : null}

      <form className="prompt-bar" onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <label className="sr-only" htmlFor="control-prompt">Message</label>
        <input id="control-prompt" value={draft.text} onChange={(event) => updateDraft(event.target.value)} disabled={busy || !connected || !hasSession} autoComplete="off" placeholder="Ask Desky anything…" />
        {adapterMode === 'runtime' && gateway.activeTurnId ? (
          <button className="cancel-button" type="button" disabled={busy} onClick={() => void withBusy(() => window.desky.adapters.cancel())}>Stop</button>
        ) : (
          <button type="submit" disabled={busy || !draft.text.trim() || !connected || !hasSession}>{busy ? 'Working' : 'Send'}</button>
        )}
      </form>

      {showConnection ? (
        <section className="connection-sheet connection-sheet--inline" aria-label="Agent connection">
          <div className="connection-sheet__header">
            <div><strong>Agent connection</strong><span>Credentials stay in Desky’s main process.</span></div>
            <button type="button" aria-label="Close connection settings" onClick={() => setShowConnection(false)}>×</button>
          </div>
          <div className="mode-switch" role="group" aria-label="Adapter mode">
            <button type="button" className={adapterMode === 'runtime' ? 'active' : ''} onClick={() => setAdapterMode('runtime')}>Agent</button>
            <button type="button" className={adapterMode === 'simulation' ? 'active' : ''} onClick={() => { setAdapterMode('simulation'); setShowConnection(false); }}>Simulation</button>
          </div>
          {adapterMode === 'runtime' ? (
            <div className="provider-switch" role="radiogroup" aria-label="Agent provider">
              {availableAdapters.map((descriptor) => (
                <button
                  key={descriptor.adapterId}
                  type="button"
                  role="radio"
                  aria-checked={selectedAdapter.adapterId === descriptor.adapterId}
                  className={selectedAdapter.adapterId === descriptor.adapterId ? 'active' : ''}
                  data-adapter-id={descriptor.adapterId}
                  data-adapter-selected={selectedAdapter.adapterId === descriptor.adapterId ? 'true' : 'false'}
                  onClick={() => {
                    setSelectedAdapterId(descriptor.adapterId);
                    setUiError('');
                  }}
                >
                  <strong>{descriptor.displayName}</strong>
                  <span>{descriptor.kind === 'codex'
                    ? 'Local app-server'
                    : descriptor.kind === 'hermes'
                      ? 'API server'
                      : descriptor.kind === 'claude' ? 'Local Agent SDK' : 'Gateway'}</span>
                </button>
              ))}
            </div>
          ) : null}
          {adapterMode === 'runtime'
            && selectedAdapter.adapterId !== gateway.adapterId
            && gateway.status === 'connected' ? (
              <p className="connection-note">{gateway.descriptor.displayName} remains connected until you connect {selectedAdapter.displayName}.</p>
            ) : null}
          {adapterMode === 'runtime' && selectedAdapter.kind === 'openclaw' ? (
            <form data-provider-form="openclaw" onSubmit={(event) => { event.preventDefault(); void connectOpenClaw(); }}>
              <label htmlFor="gateway-url">Gateway URL</label>
              <input id="gateway-url" value={gatewayUrl} onChange={(event) => setGatewayUrl(event.target.value)} autoCapitalize="none" spellCheck={false} />
              <label htmlFor="auth-kind">Authentication</label>
              <select id="auth-kind" value={authKind} onChange={(event) => setAuthKind(event.target.value as OpenClawAuthKind)}>
                <option value="token">Gateway token</option>
                <option value="password">Gateway password</option>
              </select>
              <label htmlFor="gateway-credential">{authKind === 'token' ? 'Token' : 'Password'}</label>
              <input id="gateway-credential" type="password" value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="Leave blank to use saved access" autoComplete="off" />
              <label className="remember-row"><input type="checkbox" checked={rememberCredential} onChange={(event) => setRememberCredential(event.target.checked)} /> Store with OS credential encryption</label>
              {gateway.insecureLocal ? <p className="connection-warning">Plain WebSocket is accepted only because this is a loopback address.</p> : null}
              {selectedAdapterConnected ? (
                <p className={`adapter-capability adapter-capability--${gateway.capabilities.agentActions.availability}`}>
                  Avatar actions: {gateway.capabilities.agentActions.availability === 'available'
                    ? 'typed Jump and Wave ready'
                    : 'Gateway plugin setup required'}
                </p>
              ) : null}
              {selectedAdapterConnected && gateway.pairingRequestId ? <p className="pairing-id">Pairing request: <code>{gateway.pairingRequestId}</code></p> : null}
              {uiError ? <p className="connection-error">{uiError}</p> : null}
              <div className="connection-actions">
                {selectedAdapterConnected ? <button type="button" className="secondary" onClick={() => void withBusy(async () => { setGateway(await window.desky.adapters.disconnect()); })}>Disconnect</button> : null}
                <button type="submit" disabled={busy}>{busy ? 'Connecting…' : selectedAdapterConnected ? 'Reconnect' : 'Connect'}</button>
              </div>
            </form>
          ) : null}
          {adapterMode === 'runtime' && selectedAdapter.kind === 'codex' ? (
            <form data-provider-form="codex" onSubmit={(event) => { event.preventDefault(); void connectCodex(); }}>
              <div className="workspace-consent">
                <div>
                  <strong>Workspace</strong>
                  <span>{codexWorkspace?.label ?? 'No folder selected'}</span>
                </div>
                <button type="button" className="secondary" disabled={busy} onClick={() => void selectCodexWorkspace()}>
                  {codexWorkspace ? 'Change' : 'Choose folder'}
                </button>
              </div>
              <p className="connection-note">Folder access is session-only. The renderer sends only an opaque approval; Desky’s main process resolves the canonical folder for Codex.</p>
              <fieldset className="sandbox-options">
                <legend>Codex permissions</legend>
                {(['read-only', 'workspace-write'] as const).map((mode) => {
                  const disclosure = codexSandboxDisclosures[mode];
                  return (
                    <label key={mode} className={codexSandbox === mode ? 'active' : ''}>
                      <input type="radio" name="codex-sandbox" value={mode} checked={codexSandbox === mode} onChange={() => changeCodexSandbox(mode)} />
                      <span>
                        <strong>{disclosure.label}{disclosure.recommended ? ' · Recommended' : ''}</strong>
                        <small>{disclosure.summary} {disclosure.approvalBehavior}</small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
              <p className="connection-warning">Approval policy remains On request. Desky never offers unrestricted filesystem access.</p>
              <p className="adapter-capability adapter-capability--unsupported">Avatar actions are unavailable because Codex client tools are currently experimental.</p>
              {uiError ? <p className="connection-error">{uiError}</p> : null}
              <div className="connection-actions">
                {selectedAdapterConnected ? <button type="button" className="secondary" onClick={() => void withBusy(async () => { setGateway(await window.desky.adapters.disconnect()); })}>Disconnect</button> : null}
                <button type="submit" disabled={busy || !codexWorkspace}>{busy ? 'Connecting…' : selectedAdapterConnected ? 'Reconnect' : 'Connect'}</button>
              </div>
            </form>
          ) : null}
          {adapterMode === 'runtime' && selectedAdapter.kind === 'hermes' ? (
            <form data-provider-form="hermes" onSubmit={(event) => { event.preventDefault(); void connectHermes(); }}>
              <label htmlFor="hermes-endpoint">Hermes API server</label>
              <input id="hermes-endpoint" value={hermesEndpoint} onChange={(event) => setHermesEndpoint(event.target.value)} autoCapitalize="none" spellCheck={false} />
              <label htmlFor="hermes-token">API server token</label>
              <input id="hermes-token" type="password" value={hermesToken} onChange={(event) => setHermesToken(event.target.value)} placeholder="Leave blank to use saved access" autoComplete="off" />
              <label className="remember-row"><input id="hermes-remember-token" type="checkbox" checked={rememberHermesToken} onChange={(event) => setRememberHermesToken(event.target.checked)} /> Store with OS credential encryption</label>
              <p className="connection-note">Saved access is accepted only for this exact server. To remove it, uncheck storage and connect successfully once.</p>
              {hermesEndpoint.startsWith('http://') ? <p className="connection-warning">Plain HTTP is accepted only on the loopback interface.</p> : null}
              <p className="adapter-capability adapter-capability--unsupported">Avatar actions are unavailable until Hermes exposes an admitted typed action transport.</p>
              {uiError ? <p className="connection-error">{uiError}</p> : null}
              <div className="connection-actions">
                {selectedAdapterConnected ? <button type="button" className="secondary" onClick={() => void withBusy(async () => { setGateway(await window.desky.adapters.disconnect()); })}>Disconnect</button> : null}
                <button type="submit" disabled={busy}>{busy ? 'Connecting…' : selectedAdapterConnected ? 'Reconnect' : 'Connect'}</button>
              </div>
            </form>
          ) : null}
          {adapterMode === 'runtime' && selectedAdapter.kind === 'claude' ? (
            <form data-provider-form="claude" onSubmit={(event) => { event.preventDefault(); void connectClaude(); }}>
              <div className="workspace-consent">
                <div>
                  <strong>Workspace</strong>
                  <span>{claudeWorkspace?.label ?? 'No folder selected'}</span>
                </div>
                <button type="button" className="secondary" disabled={busy} onClick={() => void selectClaudeWorkspace()}>
                  {claudeWorkspace ? 'Change' : 'Choose folder'}
                </button>
              </div>
              <p className="connection-note">Folder access is session-only. Claude receives the canonical path only from Desky’s main-process grant broker.</p>
              <fieldset className="sandbox-options">
                <legend>Claude permissions</legend>
                <label className={claudePermissionMode === 'plan' ? 'active' : ''}>
                  <input type="radio" name="claude-permissions" value="plan" checked={claudePermissionMode === 'plan'} onChange={() => changeClaudePermissionMode('plan')} />
                  <span><strong>Plan · Recommended</strong><small>Inspect the selected workspace without executing changes.</small></span>
                </label>
                <label className={claudePermissionMode === 'default' ? 'active' : ''}>
                  <input type="radio" name="claude-permissions" value="default" checked={claudePermissionMode === 'default'} onChange={() => changeClaudePermissionMode('default')} />
                  <span><strong>On request</strong><small>Claude may request tool approval inside the selected workspace.</small></span>
                </label>
              </fieldset>
              <label htmlFor="claude-api-key">Anthropic API key</label>
              <input id="claude-api-key" type="password" value={claudeApiKey} onChange={(event) => setClaudeApiKey(event.target.value)} placeholder="Leave blank to use saved access" autoComplete="off" />
              <label className="remember-row"><input id="claude-remember-api-key" type="checkbox" checked={rememberClaudeApiKey} onChange={(event) => setRememberClaudeApiKey(event.target.checked)} /> Store with OS credential encryption after a successful turn</label>
              <p className="connection-note">Local session discovery does not verify the key. New access is saved, or old access removed, only after the first successful API-key-authenticated turn.</p>
              <p className="adapter-capability adapter-capability--unsupported">Avatar actions are unavailable. No separate MCP helper is required for Claude chat and tools.</p>
              {uiError ? <p className="connection-error">{uiError}</p> : null}
              <div className="connection-actions">
                {selectedAdapterConnected ? <button type="button" className="secondary" onClick={() => void withBusy(async () => { setGateway(await window.desky.adapters.disconnect()); })}>Disconnect</button> : null}
                <button type="submit" disabled={busy || !claudeWorkspace}>{busy ? 'Connecting…' : selectedAdapterConnected ? 'Reconnect' : 'Connect'}</button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      <footer>
        <span>{gateway.insecureLocal && adapterMode === 'runtime' ? 'Local transport · development only' : `${runtimeInfo.distributionProfile} build`}</span>
        <span>v{runtimeInfo.version}</span>
      </footer>
    </main>
  );
}
