import { describe, expect, it } from 'vitest';

import {
  hermesApprovalChoice,
  HermesRunNormalizer,
  readHermesCapabilities,
  readHermesCreatedSession,
  readHermesHealth,
  readHermesSessions,
} from '../src/main/hermes/protocol';

export const hermesCapabilitiesFixture = {
  object: 'hermes.api_server.capabilities',
  platform: 'hermes-agent',
  model: 'hermes-agent',
  auth: { type: 'bearer', required: true },
  runtime: { mode: 'server_agent', tool_execution: 'server', split_runtime: false },
  features: {
    run_submission: true,
    run_status: true,
    run_events_sse: true,
    run_stop: true,
    run_approval_response: true,
    tool_progress_events: true,
    approval_events: true,
    session_resources: true,
  },
  endpoints: {
    runs: { method: 'POST', path: '/v1/runs' },
    run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
    run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
    run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' },
    run_stop: { method: 'POST', path: '/v1/runs/{run_id}/stop' },
    sessions: { method: 'GET', path: '/api/sessions' },
    session_create: { method: 'POST', path: '/api/sessions' },
  },
};

describe('Hermes API server protocol admission', () => {
  it('requires the authenticated stable run/session surface and runtime version', () => {
    expect(readHermesCapabilities(hermesCapabilitiesFixture)).toEqual({ model: 'hermes-agent' });
    expect(readHermesHealth({ status: 'ok', platform: 'hermes-agent', version: '0.9.0' }))
      .toEqual({ version: '0.9.0' });
    expect(() => readHermesCapabilities({
      ...hermesCapabilitiesFixture,
      auth: { type: 'bearer', required: false },
    })).toThrow('capability admission failed');
    expect(() => readHermesCapabilities({
      ...hermesCapabilitiesFixture,
      features: { ...hermesCapabilitiesFixture.features, run_stop: false },
    })).toThrow('missing required feature: run_stop');
  });

  it('normalizes bounded session resources', () => {
    const list = readHermesSessions({
      object: 'list',
      data: [{ id: 'session-1', title: 'Desky', preview: 'hello', last_active: 12 }],
    });
    expect(list).toEqual([{ id: 'session-1', label: 'Desky', updatedAt: 12_000 }]);
    expect(readHermesCreatedSession({
      object: 'hermes.session', session: { id: 'session-2', title: null, preview: '' },
    })).toEqual({ id: 'session-2', label: 'Hermes session', updatedAt: undefined });
  });
});

describe('Hermes run normalization', () => {
  it('maps streaming, tools, approval, and terminal success without leaking native frames', () => {
    const normalizer = new HermesRunNormalizer('connection-1', 'session-1', 'run-1');
    const nativeEvents = [
      { event: 'reasoning.available', run_id: 'run-1', timestamp: 1, text: 'private reasoning' },
      { event: 'message.delta', run_id: 'run-1', timestamp: 2, delta: 'Hello ' },
      { event: 'tool.started', run_id: 'run-1', timestamp: 3, tool: 'web_search', preview: 'Searching' },
      { event: 'tool.completed', run_id: 'run-1', timestamp: 4, tool: 'web_search', duration: 1 },
      {
        event: 'approval.request', run_id: 'run-1', timestamp: 5,
        command: 'npm test --token=secret-value', description: 'Run tests',
        choices: ['once', 'session', 'always', 'deny'],
      },
      { event: 'run.completed', run_id: 'run-1', timestamp: 6, output: 'Done' },
    ];
    const results = nativeEvents.map((event) => normalizer.normalize(event));
    const events = results.flatMap((result) => result.events);
    expect(events.map((event) => event.type)).toEqual([
      'agent.thinking', 'assistant.delta', 'tool.started', 'tool.completed',
      'approval.requested', 'turn.completed',
    ]);
    expect(JSON.stringify(events)).not.toContain('private reasoning');
    expect(JSON.stringify(events)).not.toContain('secret-value');
    expect(results[4].approval).toEqual({
      requestId: 'run-1:approval:1', runId: 'run-1',
      choices: ['once', 'session', 'always', 'deny'],
    });
    expect(results[4].events[0].payload).toMatchObject({
      kind: 'exec', allowedDecisions: ['allow-once', 'allow-always', 'deny'],
    });
    expect(normalizer.normalize({
      event: 'message.delta', run_id: 'run-1', delta: 'late',
    }).events).toEqual([]);
  });

  it('maps cancellation exactly once and fails closed on cross-run events', () => {
    const normalizer = new HermesRunNormalizer('connection-1', 'session-1', 'run-1');
    const cancelled = normalizer.normalize({ event: 'run.cancelled', run_id: 'run-1' });
    expect(cancelled.events).toHaveLength(1);
    expect(cancelled.events[0]).toMatchObject({
      type: 'turn.failed', payload: { kind: 'cancelled' },
    });
    expect(normalizer.normalize({ event: 'run.cancelled', run_id: 'run-1' }).events).toEqual([]);
    expect(() => new HermesRunNormalizer('c', 's', 'r').normalize({
      event: 'message.delta', run_id: 'other', delta: 'x',
    })).toThrow('invalid run event');
  });

  it('maps only approval scopes the server offered', () => {
    expect(hermesApprovalChoice('allow-once', ['once', 'deny'])).toBe('once');
    expect(hermesApprovalChoice('deny', ['once', 'deny'])).toBe('deny');
    expect(() => hermesApprovalChoice('allow-always', ['once', 'deny']))
      .toThrow('did not offer');
  });
});
