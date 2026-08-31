import { avatarActionKinds, type AvatarActionKind } from './agent-actions';
import type { VoiceConversationAudioFormat } from './voice-conversation';

export const agentAdapterKinds = ['openclaw', 'codex', 'claude', 'hermes', 'simulation'] as const;
export type AgentAdapterKind = (typeof agentAdapterKinds)[number];

export type AgentActionAvailability = 'available' | 'setup-required' | 'unsupported';
export type VoiceInputAvailability = 'available' | 'setup-required' | 'unsupported';
export type VoiceConversationAvailability = 'available' | 'setup-required' | 'unsupported';

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
  voiceInput: {
    availability: VoiceInputAvailability;
    transport: 'streaming-transcription' | 'none';
    inputEncoding?: 'g711_ulaw';
    inputSampleRateHz?: 8000;
    setupHint?: string;
  };
  voiceConversation: {
    availability: VoiceConversationAvailability;
    transport: 'gateway-relay-realtime' | 'none';
    inputFormats: VoiceConversationAudioFormat[];
    outputFormats: VoiceConversationAudioFormat[];
    supportsBargeIn: boolean;
    setupHint?: string;
  };
  agentActions: {
    availability: AgentActionAvailability;
    transport: 'typed-tool-event' | 'none';
    actions: AvatarActionKind[];
    setupHint?: string;
  };
}

export function openClawCapabilities(
  actionsAvailable: boolean,
  voiceInputAvailable = false,
  voiceConversationAvailable = false,
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
    voiceInput: voiceInputAvailable
      ? {
          availability: 'available',
          transport: 'streaming-transcription',
          inputEncoding: 'g711_ulaw',
          inputSampleRateHz: 8000,
        }
      : {
          availability: 'unsupported',
          transport: 'none',
        },
    voiceConversation: voiceConversationAvailable
      ? {
          availability: 'available',
          transport: 'gateway-relay-realtime',
          inputFormats: [
            { encoding: 'g711_ulaw', sampleRateHz: 8000, channels: 1 },
            { encoding: 'pcm16', sampleRateHz: 24000, channels: 1 },
          ],
          outputFormats: [
            { encoding: 'g711_ulaw', sampleRateHz: 8000, channels: 1 },
            { encoding: 'pcm16', sampleRateHz: 24000, channels: 1 },
          ],
          supportsBargeIn: true,
        }
      : {
          availability: 'unsupported',
          transport: 'none',
          inputFormats: [],
          outputFormats: [],
          supportsBargeIn: false,
        },
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
  voiceInput: {
    availability: 'unsupported',
    transport: 'none',
  },
  voiceConversation: {
    availability: 'unsupported',
    transport: 'none',
    inputFormats: [],
    outputFormats: [],
    supportsBargeIn: false,
  },
  agentActions: {
    availability: 'unsupported',
    transport: 'none',
    actions: [],
  },
} satisfies AgentAdapterCapabilities);
