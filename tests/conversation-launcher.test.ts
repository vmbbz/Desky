import { describe, expect, it, vi } from 'vitest';

import { ConversationLauncher } from '../src/main/conversation-launcher';
import type { AdapterConnectionState } from '../src/shared/agent-adapter';
import {
  simulationCapabilities,
  type AgentAdapterKind,
} from '../src/shared/adapter-capabilities';

function adapterState(adapterId: string): AdapterConnectionState {
  return {
    schemaVersion: 1,
    adapterId,
    descriptor: {
      schemaVersion: 1,
      adapterId,
      kind: adapterId as AgentAdapterKind,
      displayName: adapterId,
      description: 'test adapter',
      production: true,
      distributionProfiles: ['direct'],
      sessionSelection: 'required',
      concurrentTurns: false,
      endpointLabel: 'Endpoint',
      authenticationMethods: [],
    },
    status: 'connected',
    endpoint: 'local',
    authenticationMethod: 'none',
    insecureLocal: true,
    message: 'Ready',
    reconnectAttempt: 0,
    sessions: [],
    capabilities: {
      ...simulationCapabilities,
      adapterKind: adapterId as AgentAdapterKind,
    },
  };
}

describe('ConversationLauncher', () => {
  it('opens the installed OpenClaw client through the fixed admitted route', async () => {
    const openExternal = vi.fn(async () => undefined);
    const openDeskii = vi.fn();
    const launcher = new ConversationLauncher({
      getAdapterState: () => adapterState('openclaw'),
      getProtocolHandlerName: () => 'OpenClaw Companion',
      openExternal,
      openDeskii,
    });

    await expect(launcher.open()).resolves.toEqual({
      destination: 'provider-client',
      reason: 'provider-client-opened',
      adapterId: 'openclaw',
      clientName: 'OpenClaw Companion',
    });
    expect(openExternal).toHaveBeenCalledWith('openclaw://chat');
    expect(openDeskii).not.toHaveBeenCalled();
  });

  it('falls back to Deskii when the provider client is not installed', async () => {
    const openDeskii = vi.fn();
    const launcher = new ConversationLauncher({
      getAdapterState: () => adapterState('openclaw'),
      getProtocolHandlerName: () => '',
      openExternal: vi.fn(async () => undefined),
      openDeskii,
    });

    await expect(launcher.open()).resolves.toMatchObject({
      destination: 'deskii',
      reason: 'provider-client-not-installed',
    });
    expect(openDeskii).toHaveBeenCalledOnce();
  });

  it('does not invent unsupported Hermes, Claude, or Codex launch routes', async () => {
    for (const adapterId of ['hermes', 'claude', 'codex']) {
      const openExternal = vi.fn(async () => undefined);
      const openDeskii = vi.fn();
      const launcher = new ConversationLauncher({
        getAdapterState: () => adapterState(adapterId),
        getProtocolHandlerName: () => 'Untrusted handler',
        openExternal,
        openDeskii,
      });

      await expect(launcher.open()).resolves.toMatchObject({
        destination: 'deskii',
        reason: 'no-admitted-provider-route',
        adapterId,
      });
      expect(openExternal).not.toHaveBeenCalled();
      expect(openDeskii).toHaveBeenCalledOnce();
    }
  });
});
