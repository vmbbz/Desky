import { useEffect, useMemo, useReducer, useState } from 'react';

import type { OpenClawAuthKind, OpenClawConnectionState } from '../shared/openclaw';
import type { RuntimeInfo } from '../shared/runtime';
import { SimulationAdapter } from './adapters/simulation-adapter';
import { AvatarStage } from './avatar/AvatarStage';
import {
  initialCompanionState,
  reduceCompanionState,
} from './domain/companion-reducer';

const initialGateway: OpenClawConnectionState = {
  status: 'disconnected',
  gatewayUrl: 'ws://127.0.0.1:18789/',
  authKind: 'token',
  insecureLoopback: true,
  message: 'Connect to an OpenClaw Gateway',
  reconnectAttempt: 0,
  sessions: [],
};

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The operation failed.';
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '').slice(0, 240);
}

export function App() {
  const simulation = useMemo(() => new SimulationAdapter(), []);
  const [state, dispatch] = useReducer(reduceCompanionState, initialCompanionState);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>();
  const [adapterMode, setAdapterMode] = useState<'openclaw' | 'simulation'>('openclaw');
  const [gateway, setGateway] = useState<OpenClawConnectionState>(initialGateway);
  const [showConnection, setShowConnection] = useState(true);
  const [gatewayUrl, setGatewayUrl] = useState(initialGateway.gatewayUrl);
  const [authKind, setAuthKind] = useState<OpenClawAuthKind>('token');
  const [credential, setCredential] = useState('');
  const [rememberCredential, setRememberCredential] = useState(true);
  const [prompt, setPrompt] = useState('Inspect the project and tell me what to do next.');
  const [busy, setBusy] = useState(false);
  const [uiError, setUiError] = useState('');

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
    const removeEvents = window.desky.openClaw.onEvent(dispatch);
    return () => {
      removeState();
      removeEvents();
    };
  }, []);

  useEffect(() => {
    if (adapterMode !== 'simulation') return;
    let active = true;
    void (async () => {
      for await (const event of simulation.connect()) {
        if (active) dispatch(event);
      }
    })();
    return () => { active = false; };
  }, [adapterMode, simulation]);

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

  const run = () => withBusy(async () => {
    const text = prompt.trim();
    if (!text) return;
    if (adapterMode === 'simulation') {
      for await (const event of simulation.run(text)) dispatch(event);
      return;
    }
    await window.desky.openClaw.send(text);
  });

  const connected = adapterMode === 'simulation' || gateway.status === 'connected';
  const hasSession = adapterMode === 'simulation' || Boolean(gateway.selectedSessionKey);
  const runtimeLabel = adapterMode === 'simulation' ? 'Simulation' : 'OpenClaw';
  const connectionStatus = adapterMode === 'simulation' ? 'simulation' : gateway.status;
  const statusDetail = adapterMode === 'openclaw' && gateway.status !== 'connected'
    ? gateway.message
    : state.detail;

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
      <main className={`ambient-companion companion--${state.mode}`}>
        <div className="ambient-drag-handle" title="Drag Desky" aria-hidden="true">•••</div>
        <div className="ambient-actions">
          <button type="button" aria-label="Open Desky control center" onClick={() => window.desky.performWindowAction('open-control-center')}>⚙</button>
          <button type="button" aria-label="Close Desky companion" onClick={() => window.desky.performWindowAction('close')}>×</button>
        </div>

        <button
          type="button"
          className={`ambient-status connection-badge connection-badge--${connectionStatus}`}
          onClick={() => window.desky.performWindowAction('open-control-center')}
          title={statusDetail}
        >
          <span className="status-dot" aria-hidden="true" />
          <span>{runtimeLabel} · {connectionStatus}</span>
        </button>

        <section className="ambient-speech-bubble" aria-live="polite">
          <strong>{state.label}</strong>
          <p>{uiError || state.bubbleText || statusDetail || '…'}</p>
        </section>

        <div className="ambient-avatar">
          <AvatarStage mode={state.mode} />
        </div>

        {approvalCard ? <div className="ambient-approval">{approvalCard}</div> : null}

        {connected && hasSession ? (
          <form className="ambient-prompt" onSubmit={(event) => { event.preventDefault(); void run(); }}>
            <label className="sr-only" htmlFor="ambient-prompt">Message</label>
            <input id="ambient-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={busy} autoComplete="off" />
            {adapterMode === 'openclaw' && gateway.activeRunId ? (
              <button className="cancel-button" type="button" disabled={busy} onClick={() => void withBusy(() => window.desky.openClaw.cancel())}>Stop</button>
            ) : (
              <button type="submit" disabled={busy || !prompt.trim()}>{busy ? '…' : 'Send'}</button>
            )}
          </form>
        ) : (
          <button type="button" className="ambient-setup" onClick={() => window.desky.performWindowAction('open-control-center')}>
            {connected ? 'Choose a session' : 'Connect an agent'}
          </button>
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
        <p>{uiError || state.bubbleText || 'Your agent’s short responses will appear here.'}</p>
      </section>

      {approvalCard}

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
        <input id="control-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={busy || !connected || !hasSession} autoComplete="off" />
        {adapterMode === 'openclaw' && gateway.activeRunId ? (
          <button className="cancel-button" type="button" disabled={busy} onClick={() => void withBusy(() => window.desky.openClaw.cancel())}>Stop</button>
        ) : (
          <button type="submit" disabled={busy || !prompt.trim() || !connected || !hasSession}>{busy ? 'Working' : 'Send'}</button>
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
