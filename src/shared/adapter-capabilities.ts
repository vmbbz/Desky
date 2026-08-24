import { avatarActionKinds, type AvatarActionKind } from './agent-actions';

export const agentAdapterKinds = ['openclaw', 'claude', 'hermes', 'simulation'] as const;
export type AgentAdapterKind = (typeof agentAdapterKinds)[number];

export type AgentActionAvailability = 'available' | 'setup-required' | 'unsupported';

/**
 * Provider-neutral capability contract consumed by Desky's UI and motion host.
 * Adapters translate their native discovery surface into this shape; avatar
 * code never depends on a provider SDK, prompt convention, or tool payload.
 */
export interface AgentAdapterCapabilities {
  schemaVersion: 1;
  adapterKind: AgentAdapterKind;
  sessions: boolean;
  streaming: boolean;
  tools: boolean;
  approvals: boolean;
  cancellation: boolean;
  reconnect: boolean;
  agentActions: {
    availability: AgentActionAvailability;
    transport: 'typed-tool-event' | 'none';
    actions: AvatarActionKind[];
    setupHint?: string;
  };
}

export function openClawCapabilities(
  actionsAvailable: boolean,
): AgentAdapterCapabilities {
  return {
    schemaVersion: 1,
    adapterKind: 'openclaw',
    sessions: true,
    streaming: true,
    tools: true,
    approvals: true,
    cancellation: true,
    reconnect: true,
    agentActions: actionsAvailable
      ? {
          availability: 'available',
          transport: 'typed-tool-event',
          actions: [...avatarActionKinds],
        }
      : {
          availability: 'setup-required',
          transport: 'none',
          actions: [],
          setupHint: 'Install and enable the bundled desky-actions Gateway plugin.',
        },
  };
}

export const simulationCapabilities: AgentAdapterCapabilities = Object.freeze({
  schemaVersion: 1,
  adapterKind: 'simulation',
  sessions: false,
  streaming: true,
  tools: true,
  approvals: false,
  cancellation: false,
  reconnect: false,
  agentActions: {
    availability: 'unsupported',
    transport: 'none',
    actions: [],
  },
} satisfies AgentAdapterCapabilities);
