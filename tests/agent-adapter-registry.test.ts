import { describe, expect, it, vi } from 'vitest';

import { AgentAdapterRegistry } from '../src/main/adapters/registry';
import type { AgentAdapterRuntime } from '../src/main/adapters/runtime';
import type { AdapterEvent } from '../src/shared/adapter-events';
import type { AgentActionCommand } from '../src/shared/agent-actions';
import type {
  AdapterConnectionState,
  AdapterDescriptor,
} from '../src/shared/agent-adapter';
import { openClawCapabilities } from '../src/shared/adapter-capabilities';

class FixtureRuntime implements AgentAdapterRuntime {
  readonly calls: string[] = [];
  readonly descriptor: AdapterDescriptor;
  private readonly stateListeners = new Set<(state: AdapterConnectionState) => void>();
  private readonly eventListeners = new Set<(event: AdapterEvent) => void>();
  private readonly actionListeners = new Set<(command: AgentActionCommand) => void>();
  private state: AdapterConnectionState;

  constructor(
    adapterId: string,
    displayName: string,
    distributionProfiles: AdapterDescriptor['distributionProfiles'] = ['direct'],
  ) {
    this.descriptor = {
      schemaVersion: 1,
      adapterId,
      kind: 'openclaw',
      displayName,
      description: `${displayName} fixture`,
      production: true,
      distributionProfiles,
      sessionSelection: 'required',
      concurrentTurns: false,
      endpointLabel: 'Endpoint',
      authenticationMethods: [{ id: 'token', label: 'Token', secret: true }],
    };
    this.state = {
      schemaVersion: 1,
      adapterId,
      descriptor: this.descriptor,
      status: 'disconnected',
      endpoint: '',
      authenticationMethod: 'token',
      insecureLocal: false,
      message: 'Disconnected',
      reconnectAttempt: 0,
      sessions: [],
      capabilities: openClawCapabilities(false),
    };
  }

  getState() { return this.state; }

  async connect(configuration: unknown) {
    this.calls.push(`connect:${JSON.stringify(configuration)}`);
    this.state = { ...this.state, status: 'connected', message: 'Ready' };
    this.emitState();
    return this.state;
  }

  async disconnect() {
    this.calls.push('disconnect');
    this.state = { ...this.state, status: 'disconnected', message: 'Disconnected' };
    this.emitState();
    return this.state;
  }

  async refreshSessions() { this.calls.push('refresh'); return this.state; }
  async createSession() { this.calls.push('create'); return this.state; }
  async selectSession(sessionId: string) { this.calls.push(`select:${sessionId}`); return this.state; }
  async send(message: string) { this.calls.push(`send:${message}`); }
  async cancel() { this.calls.push('cancel'); }
  async resolveApproval(input: { requestId: string }) { this.calls.push(`approval:${input.requestId}`); }

  onState(listener: (state: AdapterConnectionState) => void) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onEvent(listener: (event: AdapterEvent) => void) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onAction(listener: (command: AgentActionCommand) => void) {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  rendererSafeError(error: unknown, operationInput?: unknown): string {
    const raw = error instanceof Error ? error.message : 'failed';
    return typeof operationInput === 'string' ? raw.replaceAll(operationInput, '[redacted]') : raw;
  }

  emitEvent(event: AdapterEvent) {
    for (const listener of this.eventListeners) listener(event);
  }

  emitAction(command: AgentActionCommand) {
    for (const listener of this.actionListeners) listener(command);
  }

  private emitState() {
    for (const listener of this.stateListeners) listener(this.state);
  }
}

const readyEvent: AdapterEvent = {
  protocolVersion: 1,
  eventId: 'event-1',
  timestamp: '2026-08-24T00:00:00.000Z',
  connectionId: 'connection-1',
  type: 'connection.ready',
  payload: { runtimeName: 'Fixture' },
};

const waveCommand: AgentActionCommand = {
  protocolVersion: 1,
  commandId: 'command-1',
  timestamp: '2026-08-24T00:00:00.000Z',
  connectionId: 'connection-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  type: 'avatar.perform',
  payload: { action: 'wave' },
};

describe('AgentAdapterRegistry', () => {
  it('enumerates safe descriptors and routes the complete command surface', async () => {
    const runtime = new FixtureRuntime('openclaw', 'OpenClaw');
    const registry = new AgentAdapterRegistry([runtime], 'openclaw', 'direct');

    const listed = registry.list();
    listed[0].authenticationMethods[0].label = 'mutated';
    expect(registry.list()[0].authenticationMethods[0].label).toBe('Token');

    await registry.connect({ adapterId: 'openclaw', configuration: { gatewayUrl: 'ws://local' } });
    await registry.refreshSessions();
    await registry.createSession({ label: 'Desky' });
    await registry.selectSession('session-1');
    await registry.send('hello');
    await registry.cancel();
    await registry.resolveApproval({ requestId: 'approval-1', kind: 'exec', decision: 'deny' });
    await registry.disconnect();

    expect(runtime.calls).toEqual([
      'connect:{"gatewayUrl":"ws://local"}',
      'refresh',
      'create',
      'select:session-1',
      'send:hello',
      'cancel',
      'approval:approval-1',
      'disconnect',
    ]);
  });

  it('disconnects before switching and emits only the active runtime', async () => {
    const first = new FixtureRuntime('first', 'First');
    const second = new FixtureRuntime('second', 'Second');
    const registry = new AgentAdapterRegistry([first, second], 'first', 'direct');
    const eventListener = vi.fn();
    const actionListener = vi.fn();
    registry.onEvent(eventListener);
    registry.onAction(actionListener);

    await registry.connect({ adapterId: 'first', configuration: {} });
    second.emitEvent(readyEvent);
    second.emitAction(waveCommand);
    expect(eventListener).not.toHaveBeenCalled();
    expect(actionListener).not.toHaveBeenCalled();

    await registry.connect({ adapterId: 'second', configuration: {} });
    expect(first.calls.at(-1)).toBe('disconnect');
    first.emitEvent(readyEvent);
    second.emitEvent(readyEvent);
    second.emitAction(waveCommand);
    expect(eventListener).toHaveBeenCalledTimes(1);
    expect(actionListener).toHaveBeenCalledTimes(1);
    expect(registry.getState().adapterId).toBe('second');
  });

  it('rejects unknown runtimes and redacts operation input from errors', async () => {
    const runtime = new FixtureRuntime('openclaw', 'OpenClaw');
    runtime.send = async (message: string) => { throw new Error(`failed to send ${message}`); };
    const registry = new AgentAdapterRegistry([runtime], 'openclaw', 'direct');

    await expect(registry.connect({ adapterId: 'missing', configuration: {} }))
      .rejects.toThrow('Unknown agent adapter.');
    await expect(registry.send('private prompt')).rejects.toThrow('failed to send [redacted]');
  });

  it('filters and rejects runtimes outside the packaged distribution profile', async () => {
    const available = new FixtureRuntime('available', 'Available', ['direct', 'store']);
    const directOnly = new FixtureRuntime('direct-only', 'Direct only', ['direct']);
    const registry = new AgentAdapterRegistry([available, directOnly], 'available', 'store');

    expect(registry.list().map((descriptor) => descriptor.adapterId)).toEqual(['available']);
    await expect(registry.connect({ adapterId: 'direct-only', configuration: {} }))
      .rejects.toThrow('Agent adapter is unavailable in this distribution profile.');
  });
});
