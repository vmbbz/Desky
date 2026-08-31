import type { AdapterEvent } from '../../shared/adapter-events';
import type { AgentActionCommand } from '../../shared/agent-actions';
import type {
  AdapterConnectionState,
  AdapterCreateSessionInput,
  AdapterDescriptor,
  AdapterResolveApprovalInput,
} from '../../shared/agent-adapter';
import type {
  VoiceInputAudioChunk,
  VoiceInputEvent,
  VoiceInputSession,
  VoiceInputStopCommand,
} from '../../shared/voice-input';
import type {
  VoiceConversationAudioChunk,
  VoiceConversationCancelOutputCommand,
  VoiceConversationEvent,
  VoiceConversationMarkCommand,
  VoiceConversationSession,
  VoiceConversationStopCommand,
} from '../../shared/voice-conversation';

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
  startVoiceInput?(): Promise<VoiceInputSession>;
  appendVoiceInput?(input: VoiceInputAudioChunk): Promise<void>;
  stopVoiceInput?(input: VoiceInputStopCommand): Promise<void>;
  onVoiceInputEvent?(listener: (event: VoiceInputEvent) => void): () => void;
  startVoiceConversation?(): Promise<VoiceConversationSession>;
  appendVoiceConversation?(input: VoiceConversationAudioChunk): Promise<void>;
  cancelVoiceConversationOutput?(input: VoiceConversationCancelOutputCommand): Promise<'applied' | 'stale' | 'idle'>;
  acknowledgeVoiceConversationMark?(input: VoiceConversationMarkCommand): Promise<void>;
  stopVoiceConversation?(input: VoiceConversationStopCommand): Promise<void>;
  onVoiceConversationEvent?(listener: (event: VoiceConversationEvent) => void): () => void;
  rendererSafeError(error: unknown, operationInput?: unknown): string;
}
