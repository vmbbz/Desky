import type { AdapterDescriptor } from './agent-adapter';
import type { AgentAdapterCapabilities } from './adapter-capabilities';

export const codexAdapterDescriptor: AdapterDescriptor = Object.freeze({
  schemaVersion: 1,
  adapterId: 'codex',
  kind: 'codex',
  displayName: 'Codex',
  description: 'Run a locally installed Codex app-server.',
  production: false,
  distributionProfiles: ['direct'] satisfies AdapterDescriptor['distributionProfiles'],
  sessionSelection: 'required',
  concurrentTurns: false,
  endpointLabel: 'Local app-server',
  authenticationMethods: [{ id: 'codex-account', label: 'Codex account', secret: false }],
});

export const codexFoundationCapabilities: AgentAdapterCapabilities = Object.freeze({
  schemaVersion: 1,
  adapterKind: 'codex',
  sessions: true,
  streaming: true,
  tools: true,
  approvals: true,
  cancellation: true,
  reconnect: true,
  agentActions: {
    availability: 'unsupported',
    transport: 'none',
    actions: [],
    setupHint: 'Typed Desky actions require a supported stable Codex tool-registration surface.',
  },
} satisfies AgentAdapterCapabilities);
