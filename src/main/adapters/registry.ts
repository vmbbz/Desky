import type { AdapterEvent } from '../../shared/adapter-events';
import type { AgentActionCommand } from '../../shared/agent-actions';
import type { DistributionProfile } from '../../shared/runtime';
import type {
  AdapterConnectCommand,
  AdapterConnectionState,
  AdapterCreateSessionInput,
  AdapterDescriptor,
  AdapterResolveApprovalInput,
} from '../../shared/agent-adapter';
import type { AgentAdapterRuntime } from './runtime';
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
import {
  assertAdapterConnectionState,
  assertAdapterDescriptor,
  assertAdapterEvent,
} from './contract';

type StateListener = (state: AdapterConnectionState) => void;
type EventListener = (event: AdapterEvent) => void;
type ActionListener = (command: AgentActionCommand) => void;
type VoiceInputListener = (event: VoiceInputEvent) => void;
type VoiceConversationListener = (event: VoiceConversationEvent) => void;
const maximumPendingVoiceConversationEvents = 8;

function cloneDescriptor(descriptor: AdapterDescriptor): AdapterDescriptor {
  return {
    ...descriptor,
    distributionProfiles: [...descriptor.distributionProfiles],
    authenticationMethods: descriptor.authenticationMethods.map((method) => ({ ...method })),
  };
}

function cloneConnectionState(
  state: AdapterConnectionState,
  distributionProfile?: DistributionProfile,
): AdapterConnectionState {
  const voiceInput = distributionProfile === 'store'
    ? {
        availability: 'unsupported' as const,
        transport: 'none' as const,
        setupHint: 'Voice input is not included in the current Store package profile.',
      }
    : { ...state.capabilities.voiceInput };
  const voiceConversation = distributionProfile === 'store'
    ? {
        availability: 'unsupported' as const,
        transport: 'none' as const,
        inputFormats: [],
        outputFormats: [],
        supportsBargeIn: false,
        setupHint: 'Conversational voice is not included in the current Store package profile.',
      }
    : {
        ...state.capabilities.voiceConversation,
        inputFormats: state.capabilities.voiceConversation.inputFormats.map((format) => ({ ...format })),
        outputFormats: state.capabilities.voiceConversation.outputFormats.map((format) => ({ ...format })),
      };
  return {
    ...state,
    descriptor: cloneDescriptor(state.descriptor),
    sessions: state.sessions.map((session) => ({ ...session })),
    capabilities: {
      ...state.capabilities,
      voiceInput,
      voiceConversation,
      agentActions: {
        ...state.capabilities.agentActions,
        actions: [...state.capabilities.agentActions.actions],
      },
    },
  };
}

/**
 * Owns runtime selection and is the sole provider-aware object used by IPC.
 * Native transports remain behind AgentAdapterRuntime implementations.
 */
export class AgentAdapterRegistry {
  private readonly runtimes = new Map<string, AgentAdapterRuntime>();
  private readonly stateListeners = new Set<StateListener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly actionListeners = new Set<ActionListener>();
  private readonly voiceInputListeners = new Set<VoiceInputListener>();
  private readonly voiceConversationListeners = new Set<VoiceConversationListener>();
  private readonly unsubscribeRuntimeListeners: Array<() => void> = [];
  private activeVoiceInput?: {
    adapterId: string;
    runtime: AgentAdapterRuntime;
    sessionId: string;
  };
  private activeVoiceConversation?: {
    adapterId: string;
    runtime: AgentAdapterRuntime;
    sessionId: string;
  };
  private pendingVoiceConversation?: {
    adapterId: string;
    runtime: AgentAdapterRuntime;
    events: VoiceConversationEvent[];
    overflowed: boolean;
  };
  private activeAdapterId: string;

  constructor(
    runtimes: AgentAdapterRuntime[],
    defaultAdapterId: string,
    private readonly distributionProfile: DistributionProfile,
  ) {
    if (runtimes.length === 0) throw new Error('At least one agent adapter runtime is required.');
    for (const runtime of runtimes) {
      assertAdapterDescriptor(runtime.descriptor);
      assertAdapterConnectionState(runtime.getState(), runtime.descriptor);
      const id = runtime.descriptor.adapterId;
      if (!id || this.runtimes.has(id)) throw new Error(`Duplicate or invalid adapter id: ${id}`);
      this.runtimes.set(id, runtime);
      this.unsubscribeRuntimeListeners.push(
        runtime.onState((state) => {
          if (id !== this.activeAdapterId) return;
          assertAdapterConnectionState(state, runtime.descriptor);
          for (const listener of this.stateListeners) {
            listener(cloneConnectionState(state, this.distributionProfile));
          }
        }),
        runtime.onEvent((event) => {
          if (id !== this.activeAdapterId) return;
          assertAdapterEvent(event);
          for (const listener of this.eventListeners) listener(event);
        }),
        runtime.onAction((command) => {
          if (id !== this.activeAdapterId) return;
          for (const listener of this.actionListeners) listener(command);
        }),
        ...(runtime.onVoiceInputEvent
          ? [runtime.onVoiceInputEvent((voiceEvent) => {
              if (id !== this.activeVoiceInput?.adapterId
                || voiceEvent.sessionId !== this.activeVoiceInput.sessionId) return;
              for (const listener of this.voiceInputListeners) listener(voiceEvent);
              if (voiceEvent.type === 'closed') this.activeVoiceInput = undefined;
            })]
          : []),
        ...(runtime.onVoiceConversationEvent
          ? [runtime.onVoiceConversationEvent((voiceEvent) => {
              const pending = this.pendingVoiceConversation;
              if (pending?.adapterId === id && pending.runtime === runtime) {
                if (pending.events.length >= maximumPendingVoiceConversationEvents) {
                  pending.overflowed = true;
                } else {
                  pending.events.push(voiceEvent);
                }
                return;
              }
              this.forwardVoiceConversationEvent(id, voiceEvent);
            })]
          : []),
      );
    }
    if (!this.runtimes.has(defaultAdapterId)) {
      throw new Error(`Default agent adapter is not registered: ${defaultAdapterId}`);
    }
    if (!this.runtimeSupportsProfile(this.runtimes.get(defaultAdapterId) as AgentAdapterRuntime)) {
      throw new Error(`Default agent adapter is unavailable in the ${this.distributionProfile} profile.`);
    }
    this.activeAdapterId = defaultAdapterId;
  }

  list(): AdapterDescriptor[] {
    return [...this.runtimes.values()]
      .filter((runtime) => this.runtimeSupportsProfile(runtime))
      .map((runtime) => cloneDescriptor(runtime.descriptor));
  }

  getState(): AdapterConnectionState {
    const runtime = this.activeRuntime();
    const state = runtime.getState();
    assertAdapterConnectionState(state, runtime.descriptor);
    return cloneConnectionState(state, this.distributionProfile);
  }

  async connect(command: AdapterConnectCommand): Promise<AdapterConnectionState> {
    const next = this.runtime(command.adapterId);
    const current = this.activeRuntime();
    if (next !== current) {
      await this.discardActiveVoiceInput(current);
      await this.discardActiveVoiceConversation(current);
      if (current.getState().status !== 'disconnected') {
        await this.safeCall(current, () => current.disconnect());
      }
    }
    this.activeAdapterId = next.descriptor.adapterId;
    return cloneConnectionState(
      await this.safeCall(next, () => next.connect(command.configuration), command.configuration),
      this.distributionProfile,
    );
  }

  async disconnect(): Promise<AdapterConnectionState> {
    const runtime = this.activeRuntime();
    await this.discardActiveVoiceInput(runtime);
    await this.discardActiveVoiceConversation(runtime);
    return cloneConnectionState(
      await this.safeCall(runtime, () => runtime.disconnect()),
      this.distributionProfile,
    );
  }

  async refreshSessions(): Promise<AdapterConnectionState> {
    const runtime = this.activeRuntime();
    return cloneConnectionState(
      await this.safeCall(runtime, () => runtime.refreshSessions()),
      this.distributionProfile,
    );
  }

  async createSession(input: AdapterCreateSessionInput): Promise<AdapterConnectionState> {
    const runtime = this.activeRuntime();
    return cloneConnectionState(
      await this.safeCall(runtime, () => runtime.createSession(input)),
      this.distributionProfile,
    );
  }

  async selectSession(sessionId: string): Promise<AdapterConnectionState> {
    const runtime = this.activeRuntime();
    await this.discardActiveVoiceInput(runtime);
    await this.discardActiveVoiceConversation(runtime);
    return cloneConnectionState(
      await this.safeCall(runtime, () => runtime.selectSession(sessionId)),
      this.distributionProfile,
    );
  }

  send(message: string): Promise<void> {
    const runtime = this.activeRuntime();
    return this.safeCall(runtime, () => runtime.send(message), message);
  }

  cancel(): Promise<void> {
    const runtime = this.activeRuntime();
    return this.safeCall(runtime, () => runtime.cancel());
  }

  resolveApproval(input: AdapterResolveApprovalInput): Promise<void> {
    const runtime = this.activeRuntime();
    return this.safeCall(runtime, () => runtime.resolveApproval(input));
  }

  async startVoiceInput(): Promise<VoiceInputSession> {
    const runtime = this.activeRuntime();
    if (this.activeVoiceInput || this.activeVoiceConversation) {
      throw new Error('A voice session is already active.');
    }
    if (cloneConnectionState(runtime.getState(), this.distributionProfile)
      .capabilities.voiceInput.availability !== 'available'
      || !runtime.startVoiceInput) {
      throw new Error('Voice input is unavailable for the active agent.');
    }
    const session = await this.safeCall(
      runtime,
      () => runtime.startVoiceInput?.() as Promise<VoiceInputSession>,
    );
    if (!session.sessionId || session.sessionId.length > 512
      || session.inputEncoding !== 'g711_ulaw'
      || session.inputSampleRateHz !== 8000) {
      await runtime.stopVoiceInput?.({ sessionId: session.sessionId, discard: true }).catch(() => undefined);
      throw new Error('The active agent returned an invalid voice-input session.');
    }
    this.activeVoiceInput = {
      adapterId: runtime.descriptor.adapterId,
      runtime,
      sessionId: session.sessionId,
    };
    return session;
  }

  appendVoiceInput(input: VoiceInputAudioChunk): Promise<void> {
    const active = this.activeVoiceInput;
    if (!active || active.sessionId !== input.sessionId || !active.runtime.appendVoiceInput) {
      return Promise.reject(new Error('Voice input is unavailable for the active agent.'));
    }
    return this.safeCall(
      active.runtime,
      () => active.runtime.appendVoiceInput?.(input) as Promise<void>,
    );
  }

  async stopVoiceInput(input: VoiceInputStopCommand): Promise<void> {
    const active = this.activeVoiceInput;
    if (!active || active.sessionId !== input.sessionId || !active.runtime.stopVoiceInput) return;
    try {
      await this.safeCall(
        active.runtime,
        () => active.runtime.stopVoiceInput?.(input) as Promise<void>,
      );
    } finally {
      if (this.activeVoiceInput === active) this.activeVoiceInput = undefined;
    }
  }

  async startVoiceConversation(): Promise<VoiceConversationSession> {
    const runtime = this.activeRuntime();
    if (this.activeVoiceInput || this.activeVoiceConversation) {
      throw new Error('A voice session is already active.');
    }
    if (cloneConnectionState(runtime.getState(), this.distributionProfile)
      .capabilities.voiceConversation.availability !== 'available'
      || !runtime.startVoiceConversation) {
      throw new Error('Voice conversation is unavailable for the active agent.');
    }
    const pending = {
      adapterId: runtime.descriptor.adapterId,
      runtime,
      events: [] as VoiceConversationEvent[],
      overflowed: false,
    };
    this.pendingVoiceConversation = pending;
    let session: VoiceConversationSession;
    try {
      session = await this.safeCall(
        runtime,
        () => runtime.startVoiceConversation?.() as Promise<VoiceConversationSession>,
      );
    } catch (error) {
      if (this.pendingVoiceConversation === pending) this.pendingVoiceConversation = undefined;
      throw error;
    }
    if (!session.sessionId || session.sessionId.length > 512
      || !session.input || !session.output
      || session.input.channels !== 1 || session.output.channels !== 1) {
      if (this.pendingVoiceConversation === pending) this.pendingVoiceConversation = undefined;
      await runtime.stopVoiceConversation?.({ sessionId: session.sessionId }).catch(() => undefined);
      throw new Error('The active agent returned an invalid voice-conversation session.');
    }
    if (pending.overflowed) {
      if (this.pendingVoiceConversation === pending) this.pendingVoiceConversation = undefined;
      await runtime.stopVoiceConversation?.({ sessionId: session.sessionId }).catch(() => undefined);
      throw new Error('The active agent emitted too many voice events while starting.');
    }
    this.activeVoiceConversation = {
      adapterId: runtime.descriptor.adapterId,
      runtime,
      sessionId: session.sessionId,
    };
    if (this.pendingVoiceConversation === pending) this.pendingVoiceConversation = undefined;
    for (const event of pending.events) {
      this.forwardVoiceConversationEvent(runtime.descriptor.adapterId, event);
    }
    return session;
  }

  appendVoiceConversation(input: VoiceConversationAudioChunk): Promise<void> {
    const active = this.activeVoiceConversation;
    if (!active || active.sessionId !== input.sessionId || !active.runtime.appendVoiceConversation) {
      return Promise.reject(new Error('Voice conversation is unavailable for the active agent.'));
    }
    return this.safeCall(
      active.runtime,
      () => active.runtime.appendVoiceConversation?.(input) as Promise<void>,
    );
  }

  cancelVoiceConversationOutput(
    input: VoiceConversationCancelOutputCommand,
  ): Promise<'applied' | 'stale' | 'idle'> {
    const active = this.activeVoiceConversation;
    if (!active || active.sessionId !== input.sessionId || !active.runtime.cancelVoiceConversationOutput) {
      return Promise.resolve('idle');
    }
    return this.safeCall(
      active.runtime,
      () => active.runtime.cancelVoiceConversationOutput?.(input) as Promise<'applied' | 'stale' | 'idle'>,
    );
  }

  acknowledgeVoiceConversationMark(input: VoiceConversationMarkCommand): Promise<void> {
    const active = this.activeVoiceConversation;
    if (!active || active.sessionId !== input.sessionId || !active.runtime.acknowledgeVoiceConversationMark) {
      return Promise.resolve();
    }
    return this.safeCall(
      active.runtime,
      () => active.runtime.acknowledgeVoiceConversationMark?.(input) as Promise<void>,
    );
  }

  async stopVoiceConversation(input: VoiceConversationStopCommand): Promise<void> {
    const active = this.activeVoiceConversation;
    if (!active || active.sessionId !== input.sessionId || !active.runtime.stopVoiceConversation) return;
    try {
      await this.safeCall(
        active.runtime,
        () => active.runtime.stopVoiceConversation?.(input) as Promise<void>,
      );
    } finally {
      if (this.activeVoiceConversation === active) this.activeVoiceConversation = undefined;
    }
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onAction(listener: ActionListener): () => void {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  onVoiceInputEvent(listener: VoiceInputListener): () => void {
    this.voiceInputListeners.add(listener);
    return () => this.voiceInputListeners.delete(listener);
  }

  onVoiceConversationEvent(listener: VoiceConversationListener): () => void {
    this.voiceConversationListeners.add(listener);
    return () => this.voiceConversationListeners.delete(listener);
  }

  async dispose(): Promise<void> {
    await this.discardActiveVoiceInput();
    await this.discardActiveVoiceConversation();
    for (const unsubscribe of this.unsubscribeRuntimeListeners.splice(0)) unsubscribe();
    this.stateListeners.clear();
    this.eventListeners.clear();
    this.actionListeners.clear();
    this.voiceInputListeners.clear();
    this.voiceConversationListeners.clear();
    await Promise.allSettled([...this.runtimes.values()].map((runtime) => runtime.disconnect()));
  }

  private activeRuntime(): AgentAdapterRuntime {
    return this.runtime(this.activeAdapterId);
  }

  private runtime(adapterId: string): AgentAdapterRuntime {
    const runtime = this.runtimes.get(adapterId);
    if (!runtime) throw new Error('Unknown agent adapter.');
    if (!this.runtimeSupportsProfile(runtime)) {
      throw new Error('Agent adapter is unavailable in this distribution profile.');
    }
    return runtime;
  }

  private runtimeSupportsProfile(runtime: AgentAdapterRuntime): boolean {
    return runtime.descriptor.distributionProfiles.includes(this.distributionProfile);
  }

  private async discardActiveVoiceInput(runtime?: AgentAdapterRuntime): Promise<void> {
    const active = this.activeVoiceInput;
    if (!active || (runtime && active.runtime !== runtime)) return;
    this.activeVoiceInput = undefined;
    if (!active.runtime.stopVoiceInput) return;
    await this.safeCall(active.runtime, () => active.runtime.stopVoiceInput?.({
      sessionId: active.sessionId,
      discard: true,
    }) as Promise<void>);
  }

  private async discardActiveVoiceConversation(runtime?: AgentAdapterRuntime): Promise<void> {
    const active = this.activeVoiceConversation;
    if (!active || (runtime && active.runtime !== runtime)) return;
    this.activeVoiceConversation = undefined;
    if (!active.runtime.stopVoiceConversation) return;
    await this.safeCall(active.runtime, () => active.runtime.stopVoiceConversation?.({
      sessionId: active.sessionId,
    }) as Promise<void>);
  }

  private forwardVoiceConversationEvent(adapterId: string, event: VoiceConversationEvent): void {
    if (adapterId !== this.activeVoiceConversation?.adapterId
      || event.sessionId !== this.activeVoiceConversation.sessionId) return;
    for (const listener of this.voiceConversationListeners) listener(event);
    if (event.type === 'closed') this.activeVoiceConversation = undefined;
  }

  private async safeCall<T>(
    runtime: AgentAdapterRuntime,
    operation: () => T | Promise<T>,
    operationInput?: unknown,
  ): Promise<T> {
    try {
      const result = await operation();
      if (isConnectionState(result)) assertAdapterConnectionState(result, runtime.descriptor);
      return result;
    } catch (error) {
      throw new Error(runtime.rendererSafeError(error, operationInput));
    }
  }
}

function isConnectionState(value: unknown): value is AdapterConnectionState {
  return typeof value === 'object' && value !== null && 'schemaVersion' in value
    && 'adapterId' in value && 'status' in value && 'capabilities' in value;
}
