import type { AgentAdapterCapabilities } from './adapter-capabilities';
import type { ApprovalDecision } from './agent-adapter';
import type { AdapterDescriptor } from './agent-adapter';

export const OPENCLAW_PROTOCOL_VERSION = 4 as const;

export const openClawAdapterDescriptor: AdapterDescriptor = Object.freeze({
  schemaVersion: 1,
  adapterId: 'openclaw',
  kind: 'openclaw',
  displayName: 'OpenClaw',
  description: 'Connect to an authenticated OpenClaw Gateway.',
  production: true,
  distributionProfiles: ['direct', 'store'] satisfies AdapterDescriptor['distributionProfiles'],
  sessionSelection: 'required',
  concurrentTurns: false,
  endpointLabel: 'Gateway URL',
  authenticationMethods: [
    { id: 'token', label: 'Gateway token', secret: true },
    { id: 'password', label: 'Gateway password', secret: true },
  ],
});

export type OpenClawAuthKind = 'token' | 'password';
export type { ApprovalDecision } from './agent-adapter';

export interface OpenClawConnectInput {
  gatewayUrl: string;
  authKind: OpenClawAuthKind;
  credential?: string;
  rememberCredential: boolean;
}

export interface OpenClawSessionSummary {
  key: string;
  label: string;
  updatedAt?: number;
}

export type OpenClawConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'pairing'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface OpenClawConnectionState {
  status: OpenClawConnectionStatus;
  gatewayUrl: string;
  authKind: OpenClawAuthKind;
  insecureLoopback: boolean;
  message: string;
  serverVersion?: string;
  pairingRequestId?: string;
  selectedSessionKey?: string;
  activeRunId?: string;
  reconnectAttempt: number;
  sessions: OpenClawSessionSummary[];
  capabilities: AgentAdapterCapabilities;
}

export interface OpenClawResolveApprovalInput {
  requestId: string;
  kind: 'exec' | 'plugin' | 'system-agent';
  decision: ApprovalDecision;
}
