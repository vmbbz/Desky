import { describe, expect, it } from 'vitest';

import {
  agentAdapterContractVersion,
  assertAdapterConnectionState,
  assertAdapterDescriptor,
  assertAdapterEvent,
} from '../src/main/adapters/contract';
import { codexAdapterDescriptor, codexFoundationCapabilities } from '../src/shared/codex';
import { openClawCapabilities } from '../src/shared/adapter-capabilities';
import { openClawAdapterDescriptor } from '../src/shared/openclaw';

describe('agent adapter contract v1', () => {
  it('admits the two production descriptors and their normalized states', () => {
    expect(agentAdapterContractVersion).toBe(1);
    assertAdapterDescriptor(openClawAdapterDescriptor);
    assertAdapterDescriptor(codexAdapterDescriptor);
    expect(() => assertAdapterConnectionState({
      schemaVersion: 1,
      adapterId: 'openclaw',
      descriptor: openClawAdapterDescriptor,
      status: 'connected',
      endpoint: 'wss://gateway.example/',
      authenticationMethod: 'token',
      insecureLocal: false,
      message: 'Ready',
      reconnectAttempt: 0,
      sessions: [{ id: 'session-1', label: 'Desky', updatedAt: 1 }],
      capabilities: openClawCapabilities(true),
    }, openClawAdapterDescriptor)).not.toThrow();
    expect(() => assertAdapterConnectionState({
      schemaVersion: 1,
      adapterId: 'codex',
      descriptor: codexAdapterDescriptor,
      status: 'disconnected',
      endpoint: 'Local stdio',
      authenticationMethod: 'codex-account',
      insecureLocal: false,
      message: 'Disconnected',
      reconnectAttempt: 0,
      sessions: [],
      capabilities: codexFoundationCapabilities,
    }, codexAdapterDescriptor)).not.toThrow();
  });

  it('fails closed on identity, capability, and action contradictions', () => {
    expect(() => assertAdapterConnectionState({
      schemaVersion: 1,
      adapterId: 'codex',
      descriptor: codexAdapterDescriptor,
      status: 'connected',
      endpoint: 'Local stdio',
      authenticationMethod: 'codex-account',
      insecureLocal: false,
      message: 'Ready',
      reconnectAttempt: 0,
      sessions: [],
      capabilities: { ...codexFoundationCapabilities, adapterKind: 'hermes' },
    }, codexAdapterDescriptor)).toThrow('contract v1');
    expect(() => assertAdapterDescriptor({
      ...codexAdapterDescriptor,
      distributionProfiles: ['direct', 'direct'],
    })).toThrow('contract v1');
    expect(() => assertAdapterConnectionState({
      schemaVersion: 1,
      adapterId: 'openclaw',
      descriptor: openClawAdapterDescriptor,
      status: 'connected',
      endpoint: '',
      authenticationMethod: 'token',
      insecureLocal: false,
      message: '',
      reconnectAttempt: 0,
      sessions: [],
      capabilities: {
        ...openClawCapabilities(false),
        agentActions: { availability: 'unsupported', transport: 'none', actions: ['jump'] },
      },
    })).toThrow('contract v1');
  });

  it('admits bounded normalized events and rejects oversized payloads', () => {
    expect(() => assertAdapterEvent({
      protocolVersion: 1,
      eventId: 'connection-1:1',
      timestamp: new Date(0).toISOString(),
      connectionId: 'connection-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      type: 'assistant.delta',
      payload: { text: 'Hello' },
    })).not.toThrow();
    expect(() => assertAdapterEvent({
      protocolVersion: 1,
      eventId: 'connection-1:2',
      timestamp: new Date(0).toISOString(),
      connectionId: 'connection-1',
      type: 'assistant.delta',
      payload: { text: 'x'.repeat(17_000) },
    })).toThrow('contract v1');
  });
});
