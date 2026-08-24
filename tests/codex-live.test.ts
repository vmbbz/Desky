import { describe, expect, it } from 'vitest';

import { CodexRuntime } from '../src/main/codex/runtime';
import { CODEX_SCHEMA_BASELINE_VERSION } from '../src/main/codex/executable-discovery';

const runLive = process.env.DESKY_CODEX_LIVE === '1'
  || process.env.npm_lifecycle_event === 'test:codex:live';

describe.skipIf(!runLive)('Codex app-server live smoke', () => {
  it('admits the installed CLI, initializes, reads account state, and lists threads', async () => {
    const runtime = new CodexRuntime({ appVersion: '0.1.0' });
    try {
      const connected = await runtime.connect({
        workspaceDirectory: process.cwd(),
        sandbox: 'read-only',
      });
      expect(connected).toMatchObject({
        adapterId: 'codex',
        status: 'connected',
        runtimeVersion: CODEX_SCHEMA_BASELINE_VERSION,
      });
      expect(Array.isArray(connected.sessions)).toBe(true);
    } finally {
      await runtime.disconnect();
    }
  }, 30_000);
});
