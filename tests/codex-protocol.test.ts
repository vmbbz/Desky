import { describe, expect, it } from 'vitest';

import {
  codexApprovalDecision,
  CodexProtocolNormalizer,
  readCodexSessions,
  readCodexThreadId,
  readCodexTurnId,
} from '../src/main/codex/protocol';

const context = {
  connectionId: 'codex-connection',
  selectedSessionId: 'thread-1',
  activeTurnId: 'turn-1',
};

describe('Codex protocol admission and normalization', () => {
  it('validates bounded thread/session and active-turn responses', () => {
    expect(readCodexSessions({
      data: [
        { id: 'thread-1', name: 'Desky', preview: 'ignored', updatedAt: 42 },
        { id: 'thread-2', name: null, preview: 'Second thread', updatedAt: 43 },
        { broken: true },
      ],
    })).toEqual([
      { id: 'thread-1', label: 'Desky', updatedAt: 42_000 },
      { id: 'thread-2', label: 'Second thread', updatedAt: 43_000 },
    ]);
    expect(readCodexThreadId({ thread: { id: 'thread-1' } })).toBe('thread-1');
    expect(readCodexTurnId({ turn: { id: 'turn-1', status: 'inProgress' } })).toBe('turn-1');
    expect(() => readCodexSessions({ data: 'bad' })).toThrow('invalid thread list');
    expect(() => readCodexTurnId({ turn: { id: 'turn-1', status: 'failed' } }))
      .toThrow('invalid active turn');
  });

  it('maps accepted input and assistant deltas without exposing reasoning', () => {
    const normalizer = new CodexProtocolNormalizer(() => '2026-08-24T00:00:00.000Z');
    expect(normalizer.userInputAccepted(context, 'thread-1', 'turn-1', 'Hello'))
      .toMatchObject([
        { type: 'user.input.accepted', sessionId: 'thread-1', turnId: 'turn-1', payload: { summary: 'Hello' } },
        { type: 'agent.thinking', payload: { status: 'Codex is working' } },
      ]);
    expect(normalizer.normalizeNotification({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', delta: 'Hi' },
    }, context)).toMatchObject([{ type: 'assistant.delta', payload: { text: 'Hi' } }]);
    expect(normalizer.normalizeNotification({
      method: 'item/reasoning/textDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'private chain of thought' },
    }, context)).toEqual([]);
  });

  it('pairs supported tool lifecycle events and rejects orphan/wrong-session events', () => {
    const normalizer = new CodexProtocolNormalizer();
    const started = normalizer.normalizeNotification({
      method: 'item/started',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: { id: 'command-1', type: 'commandExecution', command: 'secret command' },
      },
    }, context);
    expect(started).toMatchObject([{
      type: 'tool.started',
      payload: { toolName: 'Shell', safeSummary: 'Running a command' },
    }]);
    expect(JSON.stringify(started)).not.toContain('secret command');
    expect(normalizer.normalizeNotification({
      method: 'item/completed',
      params: {
        threadId: 'thread-1', turnId: 'turn-1',
        item: { id: 'command-1', type: 'commandExecution', aggregatedOutput: 'private output' },
      },
    }, context)).toMatchObject([{ type: 'tool.completed', payload: { toolName: 'Shell' } }]);
    expect(normalizer.normalizeNotification({
      method: 'item/completed',
      params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'orphan', type: 'fileChange' } },
    }, context)).toEqual([]);
    expect(normalizer.normalizeNotification({
      method: 'item/agentMessage/delta',
      params: { threadId: 'other', turnId: 'turn-1', delta: 'wrong session' },
    }, context)).toEqual([]);
  });

  it('emits exactly one sanitized terminal event for success, cancellation, or failure', () => {
    const success = new CodexProtocolNormalizer();
    const completed = {
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
    };
    expect(success.normalizeNotification(completed, context)).toMatchObject([
      { type: 'turn.completed', payload: { summary: 'Codex completed the turn' } },
    ]);
    expect(success.normalizeNotification(completed, context)).toEqual([]);

    const interrupted = new CodexProtocolNormalizer();
    expect(interrupted.normalizeNotification({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } },
    }, context)).toMatchObject([{ type: 'turn.failed', payload: { kind: 'cancelled' } }]);

    const failed = new CodexProtocolNormalizer();
    const event = failed.normalizeNotification({
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'failed', error: { message: 'token=secret at C:\\private\\file' } },
      },
    }, context);
    expect(event).toMatchObject([{ type: 'turn.failed', payload: { kind: 'error' } }]);
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(JSON.stringify(event)).not.toContain('private');
  });

  it('maps command and file approvals to scoped routes and finite decisions', () => {
    const normalizer = new CodexProtocolNormalizer();
    const command = normalizer.normalizeApprovalRequest({
      id: 7,
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1',
        command: 'do not expose this', reason: 'Needs network',
      },
    }, context);
    expect(command).toMatchObject({
      route: { requestId: 'codex:7', rpcId: 7, kind: 'exec' },
      event: { type: 'approval.requested', payload: { action: 'Run command', safeTarget: 'Needs network' } },
    });
    expect(JSON.stringify(command)).not.toContain('do not expose this');

    const file = normalizer.normalizeApprovalRequest({
      id: 'file-8',
      method: 'item/fileChange/requestApproval',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-2', grantRoot: 'C:\\repo\\src' },
    }, context);
    expect(file).toMatchObject({
      route: { requestId: 'codex:file-8', kind: 'file-change' },
      event: { payload: { action: 'Change files', safeTarget: 'src' } },
    });
    expect(normalizer.normalizeApprovalRequest({
      id: 9,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'other', turnId: 'turn-1', itemId: 'item-3' },
    }, context)).toBeUndefined();
    expect(codexApprovalDecision('allow-once')).toBe('accept');
    expect(codexApprovalDecision('allow-always')).toBe('acceptForSession');
    expect(codexApprovalDecision('deny')).toBe('decline');
  });
});
