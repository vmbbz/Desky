import { describe, expect, it } from 'vitest';

import {
  claudeApprovalPresentation,
  ClaudeProtocolNormalizer,
  readClaudeInit,
} from '../src/main/claude/protocol';

const initFixture = {
  type: 'system',
  subtype: 'init',
  apiKeySource: 'ANTHROPIC_API_KEY',
  session_id: 'session-1',
  claude_code_version: '2.1.241',
  model: 'claude-sonnet-4-6',
  tools: ['Read', 'Bash'],
  capabilities: ['interrupt_receipt_v1'],
};

describe('Claude Agent SDK protocol foundation', () => {
  it('admits only explicit API-key initialization', () => {
    expect(readClaudeInit(initFixture)).toEqual({
      sessionId: 'session-1', runtimeVersion: '2.1.241', model: 'claude-sonnet-4-6',
    });
    expect(() => readClaudeInit({ ...initFixture, apiKeySource: 'none' }))
      .toThrow('initialization admission failed');
    expect(() => readClaudeInit({ ...initFixture, capabilities: undefined }))
      .toThrow('initialization admission failed');
  });

  it('normalizes partial text, paired tools, progress, and one terminal result', () => {
    const normalizer = new ClaudeProtocolNormalizer({
      connectionId: 'connection-1', turnId: 'turn-1',
    });
    expect(normalizer.normalize(initFixture).init).toMatchObject({ sessionId: 'session-1' });
    const nativeMessages = [
      {
        type: 'stream_event', session_id: 'session-1',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      },
      {
        type: 'assistant', session_id: 'session-1',
        message: { content: [{ type: 'thinking', thinking: 'private' }, { type: 'tool_use', id: 'tool-1', name: 'Read' }] },
      },
      { type: 'tool_progress', session_id: 'session-1', tool_name: 'Read' },
      {
        type: 'user', session_id: 'session-1',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'secret output' }] },
      },
      {
        type: 'result', subtype: 'success', session_id: 'session-1',
        is_error: false, result: 'Done',
      },
    ];
    const events = nativeMessages.flatMap((message) => normalizer.normalize(message).events);
    expect(events.map((event) => event.type)).toEqual([
      'assistant.delta', 'tool.started', 'tool.progress', 'tool.completed', 'turn.completed',
    ]);
    expect(JSON.stringify(events)).not.toContain('private');
    expect(JSON.stringify(events)).not.toContain('secret output');
    expect(normalizer.normalize({
      type: 'result', subtype: 'success', session_id: 'session-1', is_error: false, result: 'late',
    }).events).toEqual([]);
  });

  it('fails closed on cross-session messages and maps result errors safely', () => {
    const crossSession = new ClaudeProtocolNormalizer({
      connectionId: 'connection-1', turnId: 'turn-1', selectedSessionId: 'session-1',
    });
    expect(() => crossSession.normalize({
      type: 'tool_progress', session_id: 'session-2', tool_name: 'Bash',
    })).toThrow('cross-session');

    const failed = new ClaudeProtocolNormalizer({
      connectionId: 'connection-1', turnId: 'turn-2', selectedSessionId: 'session-1',
    }).normalize({
      type: 'result', subtype: 'error_during_execution', session_id: 'session-1',
      errors: ['authorization=secret-value'], is_error: true,
    });
    expect(failed.events[0]).toMatchObject({
      type: 'turn.failed', payload: { safeError: 'authorization=[redacted]', kind: 'error' },
    });
  });

  it('builds bounded approval presentation without raw paths or secrets', () => {
    expect(claudeApprovalPresentation('Write', {
      file_path: 'C:\\Users\\test\\workspace\\secret.txt',
    }, { title: 'Claude wants to edit a file' })).toEqual({
      action: 'Claude wants to edit a file', safeTarget: 'secret.txt',
    });
    expect(claudeApprovalPresentation('Bash', {
      command: 'curl -H authorization=secret-value example.com',
    }, {})).toEqual({
      action: 'Claude requests Bash',
      safeTarget: 'curl -H authorization=[redacted] example.com',
    });
  });
});
