import { describe, expect, it, vi } from 'vitest';

import {
  mapOpenClawState,
  OpenClawRuntime,
  readOpenClawConfiguration,
} from '../src/main/adapters/openclaw-runtime';
import type { OpenClawAdapterHost } from '../src/main/openclaw/host';
import { openClawCapabilities } from '../src/shared/adapter-capabilities';
import type { OpenClawConnectionState } from '../src/shared/openclaw';

const nativeState: OpenClawConnectionState = {
  status: 'connected',
  gatewayUrl: 'wss://gateway.example/',
  authKind: 'token',
  insecureLoopback: false,
  message: 'Ready for a message',
  serverVersion: '2026.8.24',
  pairingRequestId: 'pair-1',
  selectedSessionKey: 'agent:main:desky',
  activeRunId: 'run-1',
  reconnectAttempt: 2,
  sessions: [{ key: 'agent:main:desky', label: 'Desky', updatedAt: 42 }],
  capabilities: openClawCapabilities(true),
};

describe('OpenClawRuntime', () => {
  it('validates provider configuration inside the runtime boundary', () => {
    expect(readOpenClawConfiguration({
      gatewayUrl: 'ws://127.0.0.1:18789/',
      authKind: 'token',
      credential: 'secret',
      rememberCredential: true,
    })).toEqual({
      gatewayUrl: 'ws://127.0.0.1:18789/',
      authKind: 'token',
      credential: 'secret',
      rememberCredential: true,
    });
    expect(() => readOpenClawConfiguration({ gatewayUrl: 'ws://local', authKind: 'oauth' }))
      .toThrow('Invalid OpenClaw connection configuration.');
  });

  it('normalizes all connection, session, turn, and capability fields', () => {
    const state = mapOpenClawState(nativeState);
    expect(state).toMatchObject({
      schemaVersion: 1,
      adapterId: 'openclaw',
      status: 'connected',
      endpoint: 'wss://gateway.example/',
      authenticationMethod: 'token',
      insecureLocal: false,
      runtimeVersion: '2026.8.24',
      selectedSessionId: 'agent:main:desky',
      activeTurnId: 'run-1',
      sessions: [{ id: 'agent:main:desky', label: 'Desky', updatedAt: 42 }],
    });
    state.sessions[0].label = 'mutated';
    state.capabilities.agentActions.actions.length = 0;
    expect(nativeState.sessions[0].label).toBe('Desky');
    expect(nativeState.capabilities.agentActions.actions).toEqual(['wave', 'jump']);
  });

  it('delegates native operations without exposing credentials in safe errors', async () => {
    const host = {
      getState: () => nativeState,
      connect: vi.fn(async () => nativeState),
      disconnect: vi.fn(async () => nativeState),
      refreshSessions: vi.fn(async () => nativeState),
      createSession: vi.fn(async () => nativeState),
      selectSession: vi.fn(async () => nativeState),
      send: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      resolveApproval: vi.fn(async () => undefined),
      onState: vi.fn(() => () => undefined),
      onEvent: vi.fn(() => () => undefined),
      onAction: vi.fn(() => () => undefined),
    } as unknown as OpenClawAdapterHost;
    const runtime = new OpenClawRuntime(host);
    const configuration = {
      gatewayUrl: 'ws://127.0.0.1:18789/',
      authKind: 'token' as const,
      credential: 'top-secret-token',
      rememberCredential: false,
    };

    await runtime.connect(configuration);
    await runtime.createSession({ label: 'Desky' });
    await runtime.selectSession('session-1');
    await runtime.send('hello');
    await runtime.cancel();
    await runtime.resolveApproval({ requestId: 'approval-1', kind: 'exec', decision: 'allow-once' });
    await runtime.disconnect();
    expect(host.connect).toHaveBeenCalledWith(configuration);
    expect(host.selectSession).toHaveBeenCalledWith('session-1');
    expect(runtime.rendererSafeError(
      new Error('token=top-secret-token'),
      configuration,
    )).toBe('token=[redacted]');
  });
});
