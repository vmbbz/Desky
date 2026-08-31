import { avatarActionKinds } from '../../shared/agent-actions';
import { agentAdapterKinds } from '../../shared/adapter-capabilities';
import { adapterConnectionStatuses } from '../../shared/agent-adapter';
import type {
  AdapterConnectionState,
  AdapterDescriptor,
} from '../../shared/agent-adapter';
import type { AdapterEvent } from '../../shared/adapter-events';
import { isVoiceConversationAudioFormat } from '../../shared/voice-conversation';

export const agentAdapterContractVersion = 1 as const;

const distributionProfiles = new Set(['direct', 'store']);
const adapterKinds = new Set<string>(agentAdapterKinds);
const connectionStatuses = new Set<string>(adapterConnectionStatuses);
const actionKinds = new Set<string>(avatarActionKinds);
const actionAvailability = new Set(['available', 'setup-required', 'unsupported']);
const actionTransports = new Set(['typed-tool-event', 'none']);
const eventTypes = new Set<AdapterEvent['type']>([
  'connection.ready', 'connection.closed', 'user.input.accepted', 'agent.thinking',
  'assistant.delta', 'tool.started', 'tool.progress', 'tool.completed',
  'approval.requested', 'approval.resolved', 'turn.completed', 'turn.failed',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= maximum
    && (allowEmpty || value.trim().length > 0);
}

function contractError(subject: string): never {
  throw new Error(`Agent adapter contract v${agentAdapterContractVersion} rejected ${subject}.`);
}

export function assertAdapterDescriptor(value: unknown): asserts value is AdapterDescriptor {
  if (!isRecord(value)
    || value.schemaVersion !== agentAdapterContractVersion
    || !isBoundedString(value.adapterId, 80)
    || !adapterKinds.has(String(value.kind))
    || !isBoundedString(value.displayName, 80)
    || !isBoundedString(value.description, 240)
    || typeof value.production !== 'boolean'
    || !Array.isArray(value.distributionProfiles)
    || value.distributionProfiles.length === 0
    || value.distributionProfiles.length > distributionProfiles.size
    || new Set(value.distributionProfiles).size !== value.distributionProfiles.length
    || value.distributionProfiles.some((profile) => !distributionProfiles.has(String(profile)))
    || !['required', 'implicit', 'unsupported'].includes(String(value.sessionSelection))
    || typeof value.concurrentTurns !== 'boolean'
    || !isBoundedString(value.endpointLabel, 80)
    || !Array.isArray(value.authenticationMethods)
    || value.authenticationMethods.length === 0
    || value.authenticationMethods.length > 8) {
    contractError('an adapter descriptor');
  }
  const authenticationIds = new Set<string>();
  for (const method of value.authenticationMethods) {
    if (!isRecord(method)
      || !isBoundedString(method.id, 80)
      || authenticationIds.has(method.id)
      || !isBoundedString(method.label, 80)
      || typeof method.secret !== 'boolean') {
      contractError('an authentication descriptor');
    }
    authenticationIds.add(method.id);
  }
}

export function assertAdapterConnectionState(
  value: unknown,
  descriptor?: AdapterDescriptor,
): asserts value is AdapterConnectionState {
  if (!isRecord(value)
    || value.schemaVersion !== agentAdapterContractVersion
    || !isBoundedString(value.adapterId, 80)
    || !connectionStatuses.has(String(value.status))
    || !isBoundedString(value.endpoint, 2_048, true)
    || !isBoundedString(value.authenticationMethod, 80)
    || typeof value.insecureLocal !== 'boolean'
    || !isBoundedString(value.message, 480, true)
    || !Number.isSafeInteger(value.reconnectAttempt)
    || Number(value.reconnectAttempt) < 0
    || Number(value.reconnectAttempt) > 100
    || !Array.isArray(value.sessions)
    || value.sessions.length > 200
    || !isRecord(value.capabilities)) {
    contractError('connection state');
  }
  assertAdapterDescriptor(value.descriptor);
  if (value.adapterId !== value.descriptor.adapterId
    || (descriptor && value.adapterId !== descriptor.adapterId)) {
    contractError('mismatched adapter identity');
  }
  const optionalIds = ['pairingRequestId', 'selectedSessionId', 'activeTurnId'] as const;
  for (const key of optionalIds) {
    if (value[key] !== undefined && !isBoundedString(value[key], 512)) {
      contractError(`connection state's ${key}`);
    }
  }
  if (value.runtimeVersion !== undefined && !isBoundedString(value.runtimeVersion, 240)) {
    contractError("connection state's runtimeVersion");
  }
  const sessionIds = new Set<string>();
  for (const session of value.sessions) {
    if (!isRecord(session)
      || !isBoundedString(session.id, 512)
      || sessionIds.has(session.id)
      || !isBoundedString(session.label, 160)
      || (session.updatedAt !== undefined
        && (typeof session.updatedAt !== 'number' || !Number.isFinite(session.updatedAt)))) {
      contractError('a session summary');
    }
    sessionIds.add(session.id);
  }
  const capabilities = value.capabilities;
  if (capabilities.schemaVersion !== agentAdapterContractVersion
    || capabilities.adapterKind !== value.descriptor.kind
    || typeof capabilities.sessions !== 'boolean'
    || typeof capabilities.streaming !== 'boolean'
    || typeof capabilities.tools !== 'boolean'
    || typeof capabilities.approvals !== 'boolean'
    || typeof capabilities.cancellation !== 'boolean'
    || typeof capabilities.reconnect !== 'boolean'
    || !isRecord(capabilities.voiceInput)
    || !actionAvailability.has(String(capabilities.voiceInput.availability))
    || !['streaming-transcription', 'none'].includes(String(capabilities.voiceInput.transport))
    || (capabilities.voiceInput.setupHint !== undefined
      && !isBoundedString(capabilities.voiceInput.setupHint, 240))
    || !isRecord(capabilities.voiceConversation)
    || !actionAvailability.has(String(capabilities.voiceConversation.availability))
    || !['gateway-relay-realtime', 'none'].includes(String(capabilities.voiceConversation.transport))
    || !Array.isArray(capabilities.voiceConversation.inputFormats)
    || capabilities.voiceConversation.inputFormats.length > 4
    || capabilities.voiceConversation.inputFormats.some((format) => !isVoiceConversationAudioFormat(format))
    || !Array.isArray(capabilities.voiceConversation.outputFormats)
    || capabilities.voiceConversation.outputFormats.length > 4
    || capabilities.voiceConversation.outputFormats.some((format) => !isVoiceConversationAudioFormat(format))
    || typeof capabilities.voiceConversation.supportsBargeIn !== 'boolean'
    || (capabilities.voiceConversation.setupHint !== undefined
      && !isBoundedString(capabilities.voiceConversation.setupHint, 240))
    || !isRecord(capabilities.agentActions)
    || !actionAvailability.has(String(capabilities.agentActions.availability))
    || !actionTransports.has(String(capabilities.agentActions.transport))
    || !Array.isArray(capabilities.agentActions.actions)
    || capabilities.agentActions.actions.some((action) => !actionKinds.has(String(action)))
    || new Set(capabilities.agentActions.actions).size !== capabilities.agentActions.actions.length
    || (capabilities.agentActions.setupHint !== undefined
      && !isBoundedString(capabilities.agentActions.setupHint, 240))) {
    contractError('adapter capabilities');
  }
  if (capabilities.voiceInput.availability === 'available') {
    if (capabilities.voiceInput.transport !== 'streaming-transcription'
      || capabilities.voiceInput.inputEncoding !== 'g711_ulaw'
      || capabilities.voiceInput.inputSampleRateHz !== 8000) {
      contractError('available voice input without an admitted transport');
    }
  } else if (capabilities.voiceInput.transport !== 'none'
    || capabilities.voiceInput.inputEncoding !== undefined
    || capabilities.voiceInput.inputSampleRateHz !== undefined) {
    contractError('unavailable voice input with an advertised transport');
  }
  if (capabilities.voiceConversation.availability === 'available') {
    if (capabilities.voiceConversation.transport !== 'gateway-relay-realtime'
      || capabilities.voiceConversation.inputFormats.length === 0
      || capabilities.voiceConversation.outputFormats.length === 0) {
      contractError('available voice conversation without an admitted transport');
    }
  } else if (capabilities.voiceConversation.transport !== 'none'
    || capabilities.voiceConversation.inputFormats.length !== 0
    || capabilities.voiceConversation.outputFormats.length !== 0
    || capabilities.voiceConversation.supportsBargeIn) {
    contractError('unavailable voice conversation with an advertised transport');
  }
  if (capabilities.agentActions.availability === 'available'
    && (capabilities.agentActions.transport === 'none'
      || capabilities.agentActions.actions.length === 0)) {
    contractError('available agent actions without a transport and action set');
  }
  if (capabilities.agentActions.availability !== 'available'
    && capabilities.agentActions.actions.length > 0) {
    contractError('unavailable agent actions with advertised actions');
  }
}

export function assertAdapterEvent(value: unknown): asserts value is AdapterEvent {
  if (!isRecord(value)
    || value.protocolVersion !== agentAdapterContractVersion
    || !isBoundedString(value.eventId, 512)
    || !isBoundedString(value.timestamp, 80)
    || Number.isNaN(Date.parse(value.timestamp))
    || !isBoundedString(value.connectionId, 512)
    || (value.sessionId !== undefined && !isBoundedString(value.sessionId, 512))
    || (value.turnId !== undefined && !isBoundedString(value.turnId, 512))
    || !eventTypes.has(value.type as AdapterEvent['type'])
    || !isRecord(value.payload)
    || JSON.stringify(value.payload).length > 16_384) {
    contractError('an adapter event');
  }
}
