import { describe, expect, it } from 'vitest';

import type { AdapterEvent } from '../src/shared/adapter-events';
import {
  initialCompanionState,
  reduceCompanionState,
} from '../src/renderer/domain/companion-reducer';

const context = {
  protocolVersion: 1 as const,
  eventId: 'event-1',
  timestamp: '2026-08-22T00:00:00.000Z',
  connectionId: 'test-connection',
  sessionId: 'test-session',
  turnId: 'test-turn',
};

describe('reduceCompanionState', () => {
  it('maps a complete turn into legible companion states', () => {
    const events: AdapterEvent[] = [
      { ...context, type: 'connection.ready', payload: { runtimeName: 'Test Agent' } },
      { ...context, type: 'user.input.accepted', payload: { summary: 'Start' } },
      { ...context, type: 'agent.thinking', payload: { status: 'Planning' } },
      {
        ...context,
        type: 'tool.started',
        payload: { toolName: 'Files', safeSummary: 'Reading files' },
      },
      { ...context, type: 'assistant.delta', payload: { text: 'Finished.' } },
      { ...context, type: 'turn.completed', payload: { summary: 'Done' } },
    ];

    const modes = [];
    let state = initialCompanionState;
    for (const event of events) {
      state = reduceCompanionState(state, event);
      modes.push(state.mode);
    }

    expect(modes).toEqual(['idle', 'listening', 'thinking', 'working', 'speaking', 'success']);
    expect(state.detail).toBe('Done');
    expect(state.activeTurnId).toBeUndefined();
  });

  it('fails closed into an explicit error state', () => {
    const state = reduceCompanionState(initialCompanionState, {
      ...context,
      type: 'turn.failed',
      payload: { safeError: 'Connection interrupted' },
    });

    expect(state.mode).toBe('error');
    expect(state.detail).toBe('Connection interrupted');
    expect(state.bubbleText).not.toContain('undefined');
  });

  it('distinguishes an intentional cancellation from an operational error', () => {
    const state = reduceCompanionState(initialCompanionState, {
      ...context,
      type: 'turn.failed',
      payload: { safeError: 'Turn cancelled', kind: 'cancelled' },
    });

    expect(state).toMatchObject({
      mode: 'cancelled',
      label: 'Cancelled',
      detail: 'Turn cancelled',
      activeTurnId: undefined,
      pendingApproval: undefined,
    });
    expect(state.bubbleText).toBe('That turn was cancelled.');
  });

  it('clears only the approval named by an authoritative terminal event', () => {
    const pending = reduceCompanionState(initialCompanionState, {
      ...context,
      type: 'approval.requested',
      payload: {
        requestId: 'approval-1',
        kind: 'exec',
        action: 'Run command',
        safeTarget: 'npm test',
        allowedDecisions: ['allow-once', 'deny'],
      },
    });
    const unrelated = reduceCompanionState(pending, {
      ...context,
      type: 'approval.resolved',
      payload: { requestId: 'approval-old', status: 'expired' },
    });
    expect(unrelated).toBe(pending);

    const resolved = reduceCompanionState(pending, {
      ...context,
      type: 'approval.resolved',
      payload: { requestId: 'approval-1', status: 'denied' },
    });
    expect(resolved).toMatchObject({
      mode: 'idle',
      label: 'Approval closed',
      detail: 'The runtime marked the request denied.',
      pendingApproval: undefined,
    });
  });
});
