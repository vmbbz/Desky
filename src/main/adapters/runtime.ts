import type { AdapterEvent } from '../../shared/adapter-events';
import type { AgentActionCommand } from '../../shared/agent-actions';
import type {
  AdapterConnectionState,
  AdapterCreateSessionInput,
  AdapterDescriptor,
  AdapterResolveApprovalInput,
} from '../../shared/agent-adapter';

export interface AgentAdapterRuntime {
  readonly descriptor: AdapterDescriptor;
  getState(): AdapterConnectionState;
  connect(configuration: unknown): Promise<AdapterConnectionState>;
  disconnect(): Promise<AdapterConnectionState>;
  refreshSessions(): Promise<AdapterConnectionState>;
  createSession(input: AdapterCreateSessionInput): Promise<AdapterConnectionState>;
  selectSession(sessionId: string): Promise<AdapterConnectionState>;
  send(message: string): Promise<void>;
  cancel(): Promise<void>;
  resolveApproval(input: AdapterResolveApprovalInput): Promise<void>;
  onState(listener: (state: AdapterConnectionState) => void): () => void;
  onEvent(listener: (event: AdapterEvent) => void): () => void;
  onAction(listener: (command: AgentActionCommand) => void): () => void;
  rendererSafeError(error: unknown, operationInput?: unknown): string;
}
