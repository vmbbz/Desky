import type { AgentAdapterCapabilities } from './adapter-capabilities';
import type { AdapterDescriptor } from './agent-adapter';

export const claudeAdapterDescriptor: AdapterDescriptor = Object.freeze({
  schemaVersion: 1,
  adapterId: 'claude',
  kind: 'claude',
  displayName: 'Claude Agent',
  description: 'Run the supported Claude Agent SDK with an Anthropic API key.',
  production: false,
  distributionProfiles: ['direct'] satisfies AdapterDescriptor['distributionProfiles'],
  sessionSelection: 'implicit',
  concurrentTurns: false,
  endpointLabel: 'Local Agent SDK',
  authenticationMethods: [{ id: 'anthropic-api-key', label: 'Anthropic API key', secret: true }],
});

export const claudeFoundationCapabilities: AgentAdapterCapabilities = Object.freeze({
  schemaVersion: 1,
  adapterKind: 'claude',
  sessions: true,
  streaming: true,
  tools: true,
  approvals: true,
  cancellation: true,
  reconnect: false,
  voiceInput: {
    availability: 'unsupported',
    transport: 'none',
    setupHint: 'Claude CLI dictation is not a programmatic Agent SDK audio transport; voice is not admitted.',
  },
  voiceConversation: {
    availability: 'unsupported',
    transport: 'none',
    inputFormats: [],
    outputFormats: [],
    supportsBargeIn: false,
    setupHint: 'Claude Agent SDK has no admitted speech-output or full-duplex audio transport in Deskiii.',
  },
  agentActions: {
    availability: 'unsupported',
    transport: 'none',
    actions: [],
    setupHint: 'A Desky MCP action server has not been admitted for Claude yet.',
  },
} satisfies AgentAdapterCapabilities);
