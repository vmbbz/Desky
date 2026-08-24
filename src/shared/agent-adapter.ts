import type { AdapterEvent } from './adapter-events';
import type {
  AgentAdapterCapabilities,
  AgentAdapterKind,
} from './adapter-capabilities';
import type { DistributionProfile } from './runtime';

export const adapterConnectionStatuses = [
  'disconnected',
  'connecting',
  'pairing',
  'connected',
  'reconnecting',
  'error',
] as const;

export type AdapterConnectionStatus = (typeof adapterConnectionStatuses)[number];
export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';
export type ApprovalKind = 'exec' | 'file-change' | 'plugin' | 'system-agent';

export interface AdapterAuthenticationMethod {
  id: string;
  label: string;
  secret: boolean;
}

/**
 * Safe, provider-neutral metadata used to enumerate and present adapters.
 * Configuration values and credentials never appear in this descriptor.
 */
export interface AdapterDescriptor {
  schemaVersion: 1;
  adapterId: string;
  kind: AgentAdapterKind;
  displayName: string;
  description: string;
  production: boolean;
  distributionProfiles: DistributionProfile[];
  sessionSelection: 'required' | 'implicit' | 'unsupported';
  concurrentTurns: boolean;
  endpointLabel: string;
  authenticationMethods: AdapterAuthenticationMethod[];
}

export interface AdapterSessionSummary {
  id: string;
  label: string;
  updatedAt?: number;
}

export interface AdapterConnectionState {
  schemaVersion: 1;
  adapterId: string;
  descriptor: AdapterDescriptor;
  status: AdapterConnectionStatus;
  endpoint: string;
  authenticationMethod: string;
  insecureLocal: boolean;
  message: string;
  runtimeVersion?: string;
  pairingRequestId?: string;
  selectedSessionId?: string;
  activeTurnId?: string;
  reconnectAttempt: number;
  sessions: AdapterSessionSummary[];
  capabilities: AgentAdapterCapabilities;
}

/**
 * Generic transport envelope. The selected runtime owns validation of its
 * opaque configuration so provider credentials never become a lowest-common-
 * denominator renderer contract.
 */
export interface AdapterConnectCommand {
  adapterId: string;
  configuration: unknown;
}

export interface AdapterCreateSessionInput {
  label?: string;
}

export interface AdapterResolveApprovalInput {
  requestId: string;
  kind: ApprovalKind;
  decision: ApprovalDecision;
}

export interface AgentAdapterBridge {
  list(): Promise<AdapterDescriptor[]>;
  getState(): Promise<AdapterConnectionState>;
  connect(input: AdapterConnectCommand): Promise<AdapterConnectionState>;
  disconnect(): Promise<AdapterConnectionState>;
  refreshSessions(): Promise<AdapterConnectionState>;
  createSession(input: AdapterCreateSessionInput): Promise<AdapterConnectionState>;
  selectSession(sessionId: string): Promise<AdapterConnectionState>;
  send(message: string): Promise<void>;
  cancel(): Promise<void>;
  resolveApproval(input: AdapterResolveApprovalInput): Promise<void>;
  onState(listener: (state: AdapterConnectionState) => void): () => void;
  onEvent(listener: (event: AdapterEvent) => void): () => void;
}
