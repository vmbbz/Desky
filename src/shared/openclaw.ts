import type { AdapterEvent } from './adapter-events';

export const OPENCLAW_PROTOCOL_VERSION = 4 as const;

export type OpenClawAuthKind = 'token' | 'password';
export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

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
}

export interface OpenClawCreateSessionInput {
  label?: string;
}

export interface OpenClawResolveApprovalInput {
  requestId: string;
  kind: 'exec' | 'plugin' | 'system-agent';
  decision: ApprovalDecision;
}

export interface OpenClawBridge {
  getState(): Promise<OpenClawConnectionState>;
  connect(input: OpenClawConnectInput): Promise<OpenClawConnectionState>;
  disconnect(): Promise<OpenClawConnectionState>;
  refreshSessions(): Promise<OpenClawConnectionState>;
  createSession(input: OpenClawCreateSessionInput): Promise<OpenClawConnectionState>;
  selectSession(sessionKey: string): Promise<OpenClawConnectionState>;
  send(message: string): Promise<void>;
  cancel(): Promise<void>;
  resolveApproval(input: OpenClawResolveApprovalInput): Promise<void>;
  onState(listener: (state: OpenClawConnectionState) => void): () => void;
  onEvent(listener: (event: AdapterEvent) => void): () => void;
}
