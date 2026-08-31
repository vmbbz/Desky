import type { AgentAdapterCapabilities } from './adapter-capabilities';
import type { AdapterDescriptor } from './agent-adapter';

export const hermesAdapterDescriptor: AdapterDescriptor = Object.freeze({
  schemaVersion: 1,
  adapterId: 'hermes',
  kind: 'hermes',
  displayName: 'Hermes',
  description: 'Connect to an authenticated Hermes Agent API server.',
  production: true,
  distributionProfiles: ['direct'] satisfies AdapterDescriptor['distributionProfiles'],
  sessionSelection: 'required',
  concurrentTurns: false,
  endpointLabel: 'Hermes API server',
  authenticationMethods: [{ id: 'bearer-token', label: 'API server token', secret: true }],
});

export const hermesFoundationCapabilities: AgentAdapterCapabilities = Object.freeze({
  schemaVersion: 1,
  adapterKind: 'hermes',
  sessions: true,
  streaming: true,
  tools: true,
  approvals: true,
  cancellation: true,
  reconnect: true,
  voiceInput: {
    availability: 'unsupported',
    transport: 'none',
    setupHint: 'Hermes voice input has not been admitted into the Deskiii adapter contract.',
  },
  voiceConversation: {
    availability: 'unsupported',
    transport: 'none',
    inputFormats: [],
    outputFormats: [],
    supportsBargeIn: false,
    setupHint: 'Hermes realtime audio has not been admitted into the Deskiii adapter contract.',
  },
  agentActions: {
    availability: 'unsupported',
    transport: 'none',
    actions: [],
    setupHint: 'Hermes has no admitted Desky action tool yet.',
  },
} satisfies AgentAdapterCapabilities);

export interface HermesConnectInput {
  endpoint: string;
  token?: string;
  rememberToken?: boolean;
}
