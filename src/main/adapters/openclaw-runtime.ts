import type { AdapterEvent } from '../../shared/adapter-events';
import type { AgentActionCommand } from '../../shared/agent-actions';
import type {
  AdapterConnectionState,
  AdapterCreateSessionInput,
  AdapterResolveApprovalInput,
} from '../../shared/agent-adapter';
import type {
  OpenClawConnectInput,
  OpenClawConnectionState,
} from '../../shared/openclaw';
import { openClawAdapterDescriptor } from '../../shared/openclaw';
import {
  redactOpenClawError,
  type OpenClawAdapterHost,
} from '../openclaw/host';
import type { AgentAdapterRuntime } from './runtime';
import type {
  VoiceInputAudioChunk,
  VoiceInputEvent,
  VoiceInputSession,
  VoiceInputStopCommand,
} from '../../shared/voice-input';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readOpenClawConfiguration(value: unknown): OpenClawConnectInput {
  if (!isRecord(value)
    || typeof value.gatewayUrl !== 'string' || value.gatewayUrl.length > 2048
    || (value.authKind !== 'token' && value.authKind !== 'password')
    || (value.credential !== undefined
      && (typeof value.credential !== 'string' || value.credential.length > 16_384))
    || typeof value.rememberCredential !== 'boolean') {
    throw new Error('Invalid OpenClaw connection configuration.');
  }
  return {
    gatewayUrl: value.gatewayUrl,
    authKind: value.authKind,
    credential: value.credential,
    rememberCredential: value.rememberCredential,
  };
}

export function mapOpenClawState(state: OpenClawConnectionState): AdapterConnectionState {
  return {
    schemaVersion: 1,
    adapterId: openClawAdapterDescriptor.adapterId,
    descriptor: {
      ...openClawAdapterDescriptor,
      authenticationMethods: openClawAdapterDescriptor.authenticationMethods.map((method) => ({ ...method })),
    },
    status: state.status,
    endpoint: state.gatewayUrl,
    authenticationMethod: state.authKind,
    insecureLocal: state.insecureLoopback,
    message: state.message,
    runtimeVersion: state.serverVersion,
    pairingRequestId: state.pairingRequestId,
    selectedSessionId: state.selectedSessionKey,
    activeTurnId: state.activeRunId,
    reconnectAttempt: state.reconnectAttempt,
    sessions: state.sessions.map((session) => ({
      id: session.key,
      label: session.label,
      updatedAt: session.updatedAt,
    })),
    capabilities: {
      ...state.capabilities,
      voiceInput: { ...state.capabilities.voiceInput },
      agentActions: {
        ...state.capabilities.agentActions,
        actions: [...state.capabilities.agentActions.actions],
      },
    },
  };
}

export class OpenClawRuntime implements AgentAdapterRuntime {
  readonly descriptor = openClawAdapterDescriptor;

  constructor(private readonly host: OpenClawAdapterHost) {}

  getState(): AdapterConnectionState {
    return mapOpenClawState(this.host.getState());
  }

  async connect(configuration: unknown): Promise<AdapterConnectionState> {
    return mapOpenClawState(await this.host.connect(readOpenClawConfiguration(configuration)));
  }

  async disconnect(): Promise<AdapterConnectionState> {
    return mapOpenClawState(await this.host.disconnect());
  }

  async refreshSessions(): Promise<AdapterConnectionState> {
    return mapOpenClawState(await this.host.refreshSessions());
  }

  async createSession(input: AdapterCreateSessionInput): Promise<AdapterConnectionState> {
    return mapOpenClawState(await this.host.createSession(input));
  }

  async selectSession(sessionId: string): Promise<AdapterConnectionState> {
    return mapOpenClawState(await this.host.selectSession(sessionId));
  }

  send(message: string): Promise<void> {
    return this.host.send(message);
  }

  cancel(): Promise<void> {
    return this.host.cancel();
  }

  resolveApproval(input: AdapterResolveApprovalInput): Promise<void> {
    if (input.kind === 'file-change') {
      return Promise.reject(new Error('OpenClaw does not support file-change approvals.'));
    }
    return this.host.resolveApproval({
      requestId: input.requestId,
      kind: input.kind,
      decision: input.decision,
    });
  }

  onState(listener: (state: AdapterConnectionState) => void): () => void {
    return this.host.onState((state) => listener(mapOpenClawState(state)));
  }

  onEvent(listener: (event: AdapterEvent) => void): () => void {
    return this.host.onEvent(listener);
  }

  onAction(listener: (command: AgentActionCommand) => void): () => void {
    return this.host.onAction(listener);
  }

  startVoiceInput(): Promise<VoiceInputSession> {
    return this.host.startVoiceInput();
  }

  appendVoiceInput(input: VoiceInputAudioChunk): Promise<void> {
    return this.host.appendVoiceInput(input.sessionId, input.audioBase64);
  }

  stopVoiceInput(input: VoiceInputStopCommand): Promise<void> {
    return this.host.stopVoiceInput(input.sessionId, input.discard);
  }

  onVoiceInputEvent(listener: (event: VoiceInputEvent) => void): () => void {
    return this.host.onVoiceInputEvent(listener);
  }

  rendererSafeError(error: unknown, operationInput?: unknown): string {
    const credential = isRecord(operationInput) && typeof operationInput.credential === 'string'
      ? operationInput.credential
      : undefined;
    const submittedText = typeof operationInput === 'string' ? operationInput : undefined;
    return redactOpenClawError(error, [credential, submittedText]);
  }
}
