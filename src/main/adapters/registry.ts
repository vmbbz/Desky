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
import {
  assertAdapterConnectionState,
  assertAdapterDescriptor,
  assertAdapterEvent,
} from './contract';

type StateListener = (state: AdapterConnectionState) => void;
type EventListener = (event: AdapterEvent) => void;
type ActionListener = (command: AgentActionCommand) => void;
type VoiceInputListener = (event: VoiceInputEvent) => void;

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
  return {
    ...state,
    descriptor: cloneDescriptor(state.descriptor),
    sessions: state.sessions.map((session) => ({ ...session })),
    capabilities: {
      ...state.capabilities,
      voiceInput,
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
  private readonly unsubscribeRuntimeListeners: Array<() => void> = [];
  private activeVoiceInput?: {
    adapterId: string;
    runtime: AgentAdapterRuntime;
    sessionId: string;
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
    if (this.activeVoiceInput) {
      throw new Error('Voice input is already active.');
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

  async dispose(): Promise<void> {
    await this.discardActiveVoiceInput();
    for (const unsubscribe of this.unsubscribeRuntimeListeners.splice(0)) unsubscribe();
    this.stateListeners.clear();
    this.eventListeners.clear();
    this.actionListeners.clear();
    this.voiceInputListeners.clear();
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
