import { useEffect, useMemo, useReducer, useState } from 'react';

import type { RuntimeInfo } from '../shared/runtime';
import { SimulationAdapter } from './adapters/simulation-adapter';
import { AvatarStage } from './avatar/AvatarStage';
import {
  initialCompanionState,
  reduceCompanionState,
} from './domain/companion-reducer';

export function App() {
  const adapter = useMemo(() => new SimulationAdapter(), []);
  const [state, dispatch] = useReducer(reduceCompanionState, initialCompanionState);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo>();
  const [prompt, setPrompt] = useState('Inspect the project and tell me what to do next.');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void window.desky.getRuntimeInfo().then(setRuntimeInfo);
    void (async () => {
      for await (const event of adapter.connect()) dispatch(event);
    })();
  }, [adapter]);

  const runSimulation = async () => {
    if (!prompt.trim() || running) return;
    setRunning(true);
    try {
      for await (const event of adapter.run(prompt.trim())) dispatch(event);
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className={`companion companion--${state.mode}`}>
      <header className="titlebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">D</span>
          <span>Desky</span>
          <span className="simulation-badge">Simulation</span>
        </div>
        <div className="window-actions">
          <button
            type="button"
            aria-label="Minimize Desky"
            onClick={() => window.desky.performWindowAction('minimize')}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Close Desky"
            onClick={() => window.desky.performWindowAction('close')}
          >
            ×
          </button>
        </div>
      </header>

      <div className="status-row" aria-live="polite">
        <span className="status-dot" aria-hidden="true" />
        <strong>{state.label}</strong>
        <span>{state.detail}</span>
      </div>

      <AvatarStage mode={state.mode} />

      <section className="speech-bubble" aria-live="polite">
        <p>{state.bubbleText || '…'}</p>
      </section>

      <form
        className="prompt-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void runSimulation();
        }}
      >
        <label className="sr-only" htmlFor="desky-prompt">Message</label>
        <input
          id="desky-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={running}
          autoComplete="off"
        />
        <button type="submit" disabled={running || !prompt.trim()}>
          {running ? 'Working' : 'Send'}
        </button>
      </form>

      <footer>
        <span>{runtimeInfo?.distributionProfile ?? '…'} build</span>
        <span>{runtimeInfo ? `v${runtimeInfo.version}` : 'starting'}</span>
      </footer>
    </main>
  );
}
