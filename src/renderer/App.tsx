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
import type { AgentActionCommand } from '../shared/agent-actions';
import {
  initialLocalAnimationPreviewState,
  type LocalAnimationPreviewState,
} from '../shared/local-animation';
import type { OpenClawAuthKind, OpenClawConnectionState } from '../shared/openclaw';
import type {
  AmbientSurfaceState,
  DesktopRectangle,
  MotionPreference,
  RuntimeInfo,
} from '../shared/runtime';
import { SimulationAdapter } from './adapters/simulation-adapter';
import { AvatarStage, type AvatarHitTest } from './avatar/AvatarStage';
import { resolveAvatarDragMode } from './avatar/avatar-manipulation';
import type { MotionCueKind, MotionCueSource } from './avatar/motion-cue-queue';

const initialGateway: OpenClawConnectionState = {
  status: 'disconnected',
  gatewayUrl: 'ws://127.0.0.1:18789/',
  authKind: 'token',
  insecureLoopback: true,
  message: 'Connect to an OpenClaw Gateway',
  reconnectAttempt: 0,
  sessions: [],
};
const visualTestState = new URLSearchParams(window.location.search).get('visualState');

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The operation failed.';
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '').slice(0, 240);
}

function normalizeAvatarYaw(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

export function App() {
  const simulation = useMemo(() => new SimulationAdapter(), []);
  const [state, setState] = useState<CompanionSnapshot>(initialCompanionSnapshot);
  const [draft, setDraft] = useState<CompanionDraftSnapshot>(initialCompanionDraftSnapshot);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>();
  const [ambientState, setAmbientState] = useState<AmbientSurfaceState>();
  const [avatarYawDegrees, setAvatarYawDegrees] = useState(0);
  const [avatarBounds, setAvatarBounds] = useState<DesktopRectangle>();
  const [adapterMode, setAdapterMode] = useState<'openclaw' | 'simulation'>(
    visualTestState ? 'simulation' : 'openclaw',
  );
  const [gateway, setGateway] = useState<OpenClawConnectionState>(initialGateway);
  const [showConnection, setShowConnection] = useState(true);
  const [gatewayUrl, setGatewayUrl] = useState(initialGateway.gatewayUrl);
  const [authKind, setAuthKind] = useState<OpenClawAuthKind>('token');
  const [credential, setCredential] = useState('');
  const [rememberCredential, setRememberCredential] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uiError, setUiError] = useState('');
  const [animationBusy, setAnimationBusy] = useState(false);
  const [animationState, setAnimationState] = useState<LocalAnimationPreviewState>(
    initialLocalAnimationPreviewState,
  );
  const [motionPreference, setMotionPreference] = useState<MotionPreference>('system');
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [composerExpanded, setComposerExpanded] = useState(visualTestState === 'composer');
  const ambientPromptRef = useRef<HTMLInputElement>(null);
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
    void window.desky.openClaw.getState().then((next) => {
      setGateway(next);
      setGatewayUrl(next.gatewayUrl);
      setAuthKind(next.authKind);
      setShowConnection(next.status !== 'connected');
    });
    const removeState = window.desky.openClaw.onState(setGateway);
    const acceptCompanionState = (next: CompanionSnapshot) => {
      if (adapterModeRef.current !== 'openclaw') return;
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
      if (adapterModeRef.current !== 'openclaw') return;
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
    return () => {
      removeState();
      removeCompanionState();
      removeCompanionAction();
      removeDraft();
      removeAmbientState();
      removeAnimationState();
      removeMotionPreference();
    };
  }, []);

  useEffect(() => {
    adapterModeRef.current = adapterMode;
    if (adapterMode === 'openclaw') {
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

  const connect = () => withBusy(async () => {
    const next = await window.desky.openClaw.connect({
      gatewayUrl,
      authKind,
      credential: credential || undefined,
      rememberCredential,
    });
    setGateway(next);
    setCredential('');
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
      await window.desky.openClaw.send(text);
    }
    updateDraft('');
    setComposerExpanded(false);
  });

  const connected = adapterMode === 'simulation' || gateway.status === 'connected';
  const hasSession = adapterMode === 'simulation' || Boolean(gateway.selectedSessionKey);
  const effectiveReducedMotion = motionPreference === 'reduced'
    || (motionPreference === 'system' && systemReducedMotion);
  const runtimeLabel = adapterMode === 'simulation' ? 'Simulation' : 'OpenClaw';
  const connectionStatus = adapterMode === 'simulation' ? 'simulation' : gateway.status;
  const statusDetail = adapterMode === 'openclaw' && gateway.status !== 'connected'
    ? gateway.message
    : state.detail;
  const recoveryShortcutLabel = runtimeInfo?.platform === 'darwin'
    ? 'Cmd+Shift+D'
    : 'Ctrl+Shift+D';
  const activeRun = adapterMode === 'openclaw' && Boolean(gateway.activeRunId);
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
    return window.desky.openClaw.resolveApproval({
      requestId: approval.requestId,
      kind: approval.kind,
      decision,
    });
  };

  const approvalCard = state.pendingApproval && adapterMode === 'openclaw' ? (
    <section className="approval-card" aria-label="Approval required">
      <strong>{state.pendingApproval.action}</strong>
      <p>{state.pendingApproval.safeTarget}</p>
      <div>
        {state.pendingApproval.allowedDecisions.includes('allow-once') ? (
          <button type="button" disabled={busy} onClick={() => void withBusy(() => resolveApproval('allow-once'))}>Allow once</button>
        ) : null}
        {state.pendingApproval.allowedDecisions.includes('allow-always') ? (
          <button type="button" disabled={busy} onClick={() => void withBusy(() => resolveApproval('allow-always'))}>Always</button>
        ) : null}
        <button className="danger" type="button" disabled={busy} onClick={() => void withBusy(() => resolveApproval('deny'))}>Deny</button>
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
        data-bubble-placement={ambientState?.bubblePlacement ?? 'above'}
        data-avatar-yaw-degrees={avatarYawDegrees}
        data-bubble-visible={showAmbientBubble}
        data-composer-expanded={composerExpanded}
        data-horizontal-placement={ambientState?.horizontalPlacement ?? 'center'}
        data-recovery-available={ambientState?.recoveryAvailable ?? false}
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
            {state.pendingApproval && adapterMode === 'openclaw' ? (
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
            mode={state.mode}
            motionPreference={motionPreference}
            motionCue={motionCue}
            onVisibleBounds={setAvatarBounds}
            onHitTestReady={acceptAvatarHitTest}
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
            title="Motion is reduced. Choose Full in the control center to enable avatar animation."
          >
            Motion paused · Open settings
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
              <button className="cancel-button" type="button" disabled={busy} onClick={() => void withBusy(() => window.desky.openClaw.cancel())}>Stop</button>
            ) : (
              <button type="submit" disabled={busy || !draft.text.trim()}>{busy ? '…' : 'Send'}</button>
            )}
          </form>
        ) : (
          <div className="ambient-launcher" data-desky-interactive="true">
            {activeRun ? (
              <button className="ambient-stop" type="button" disabled={busy} onClick={() => void withBusy(() => window.desky.openClaw.cancel())}>Stop</button>
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

  return (
    <main className={`companion control-center companion--${state.mode}`}>
      <header className="control-center__header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">D</span>
          <div><strong>Desky</strong><span>Control Center</span></div>
        </div>
        <div className="control-center__actions">
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

      {adapterMode === 'openclaw' && gateway.status === 'connected' ? (
        <div className="session-row">
          <label className="sr-only" htmlFor="openclaw-session">OpenClaw session</label>
          <select
            id="openclaw-session"
            value={gateway.selectedSessionKey ?? ''}
            disabled={busy}
            onChange={(event) => void withBusy(async () => { setGateway(await window.desky.openClaw.selectSession(event.target.value)); })}
          >
            <option value="" disabled>Select a session</option>
            {gateway.sessions.map((session) => <option key={session.key} value={session.key}>{session.label}</option>)}
          </select>
          <button type="button" disabled={busy} onClick={() => void withBusy(async () => { setGateway(await window.desky.openClaw.createSession({ label: 'Desky' })); })}>New</button>
          <button type="button" aria-label="Refresh sessions" disabled={busy} onClick={() => void withBusy(async () => { setGateway(await window.desky.openClaw.refreshSessions()); })}>↻</button>
        </div>
      ) : null}

      <form className="prompt-bar" onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <label className="sr-only" htmlFor="control-prompt">Message</label>
        <input id="control-prompt" value={draft.text} onChange={(event) => updateDraft(event.target.value)} disabled={busy || !connected || !hasSession} autoComplete="off" placeholder="Ask Desky anything…" />
        {adapterMode === 'openclaw' && gateway.activeRunId ? (
          <button className="cancel-button" type="button" disabled={busy} onClick={() => void withBusy(() => window.desky.openClaw.cancel())}>Stop</button>
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
            <button type="button" className={adapterMode === 'openclaw' ? 'active' : ''} onClick={() => setAdapterMode('openclaw')}>OpenClaw</button>
            <button type="button" className={adapterMode === 'simulation' ? 'active' : ''} onClick={() => { setAdapterMode('simulation'); setShowConnection(false); }}>Simulation</button>
          </div>
          {adapterMode === 'openclaw' ? (
            <form onSubmit={(event) => { event.preventDefault(); void connect(); }}>
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
              {gateway.insecureLoopback ? <p className="connection-warning">Plain WebSocket is accepted only because this is a loopback address.</p> : null}
              {gateway.pairingRequestId ? <p className="pairing-id">Pairing request: <code>{gateway.pairingRequestId}</code></p> : null}
              {uiError ? <p className="connection-error">{uiError}</p> : null}
              <div className="connection-actions">
                {gateway.status === 'connected' ? <button type="button" className="secondary" onClick={() => void withBusy(async () => { setGateway(await window.desky.openClaw.disconnect()); })}>Disconnect</button> : null}
                <button type="submit" disabled={busy}>{busy ? 'Connecting…' : gateway.status === 'connected' ? 'Reconnect' : 'Connect'}</button>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      <footer>
        <span>{gateway.insecureLoopback && adapterMode === 'openclaw' ? 'Local ws · development only' : `${runtimeInfo.distributionProfile} build`}</span>
        <span>v{runtimeInfo.version}</span>
      </footer>
    </main>
  );
}
