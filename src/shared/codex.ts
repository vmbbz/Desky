import type { AdapterDescriptor } from './agent-adapter';
import type { AgentAdapterCapabilities } from './adapter-capabilities';

/**
 * Production policy for the admitted app-server protocol. Client-registered
 * tools currently require Codex's experimental API, so Desky must neither
 * advertise nor initialize that surface. A separately configured MCP server
 * is a possible future integration, not an equivalent local registration API.
 */
export const codexTypedActionPolicy = Object.freeze({
  availability: 'unsupported',
  clientRegistration: 'experimental-only',
  experimentalApi: false,
  dynamicTools: false,
  stableAlternative: 'external-mcp',
} as const);

export const codexAdapterDescriptor: AdapterDescriptor = Object.freeze({
  schemaVersion: 1,
  adapterId: 'codex',
  kind: 'codex',
  displayName: 'Codex',
  description: 'Run a locally installed Codex app-server.',
  production: true,
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
    availability: codexTypedActionPolicy.availability,
    transport: 'none',
    actions: [],
    setupHint: 'Codex client-registered actions are unavailable because its current dynamic-tool surface is experimental.',
  },
} satisfies AgentAdapterCapabilities);
