import { basename } from 'node:path';

import type { AdapterEvent } from '../../shared/adapter-events';
import { CLAUDE_CODE_VERSION } from './sdk-client';

export interface ClaudeProtocolContext {
  connectionId: string;
  turnId: string;
  selectedSessionId?: string;
  expectedCwd?: string;
  expectedPermissionMode?: 'plan' | 'default';
}

export interface ClaudeInitAdmission {
  sessionId: string;
  runtimeVersion: string;
  model: string;
}

export interface ClaudeNormalization {
  events: AdapterEvent[];
  init?: ClaudeInitAdmission;
  terminal: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, maximum = 512): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
    ? value
    : undefined;
}

function safeText(value: unknown, fallback: string, maximum = 180): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(token|password|authorization|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/(^|\s)\/(?:[^\s/]+\/)*[^\s]+/g, '$1[path]')
    .slice(0, maximum);
}

export function readClaudeInit(
  value: unknown,
  expected: Pick<ClaudeProtocolContext, 'expectedCwd' | 'expectedPermissionMode'> = {},
): ClaudeInitAdmission {
  if (!isRecord(value)
    || value.type !== 'system'
    || value.subtype !== 'init'
    || value.apiKeySource !== 'ANTHROPIC_API_KEY'
    || !readString(value.session_id)
    || value.claude_code_version !== CLAUDE_CODE_VERSION
    || !readString(value.model, 240)
    || !Array.isArray(value.tools)
    || !Array.isArray(value.capabilities)
    || (expected.expectedCwd !== undefined && value.cwd !== expected.expectedCwd)
    || (expected.expectedPermissionMode !== undefined
      && value.permissionMode !== expected.expectedPermissionMode)
    || (value.mcp_servers !== undefined
      && (!Array.isArray(value.mcp_servers) || value.mcp_servers.length !== 0))) {
    throw new Error('Claude Agent SDK initialization admission failed.');
  }
  return {
    sessionId: value.session_id as string,
    runtimeVersion: value.claude_code_version as string,
    model: value.model as string,
  };
}

function safeToolTarget(toolName: string, input: Record<string, unknown>): string {
  for (const key of ['file_path', 'path', 'command', 'query', 'url']) {
    const candidate = input[key];
    if (typeof candidate !== 'string' || !candidate.trim()) continue;
    if (key === 'file_path' || key === 'path') return basename(candidate).slice(0, 180);
    return safeText(candidate, toolName);
  }
  return toolName;
}

export function claudeApprovalPresentation(
  toolNameValue: unknown,
  inputValue: unknown,
  contextValue: unknown,
): { action: string; safeTarget: string } {
  const toolName = safeText(toolNameValue, 'Tool', 100);
  const input = isRecord(inputValue) ? inputValue : {};
  const context = isRecord(contextValue) ? contextValue : {};
  return {
    action: safeText(context.title, safeText(context.description, `Claude requests ${toolName}`)),
    safeTarget: typeof context.blockedPath === 'string'
      ? basename(context.blockedPath).slice(0, 180)
      : safeToolTarget(toolName, input),
  };
}

export class ClaudeProtocolNormalizer {
  private sequence = 0;
  private terminal = false;
  private sessionId?: string;
  private readonly activeTools = new Map<string, string>();

  constructor(private readonly context: ClaudeProtocolContext) {
    this.sessionId = context.selectedSessionId;
  }

  normalize(value: unknown): ClaudeNormalization {
    if (!isRecord(value) || !readString(value.type, 80)) {
      throw new Error('Claude Agent SDK returned an invalid message.');
    }
    if (this.terminal) return { events: [], terminal: true };
    const events: AdapterEvent[] = [];
    const emit = (type: AdapterEvent['type'], payload: AdapterEvent['payload']) => {
      this.sequence += 1;
      events.push({
        protocolVersion: 1,
        eventId: `${this.context.connectionId}:${this.context.turnId}:${this.sequence}`,
        timestamp: new Date().toISOString(),
        connectionId: this.context.connectionId,
        sessionId: this.sessionId,
        turnId: this.context.turnId,
        type,
        payload,
      } as AdapterEvent);
    };
    let init: ClaudeInitAdmission | undefined;
    if (value.type === 'system' && value.subtype === 'init') {
      init = readClaudeInit(value, this.context);
      this.sessionId = init.sessionId;
      return { events, init, terminal: false };
    }
    if (value.session_id !== undefined && value.session_id !== this.sessionId) {
      throw new Error('Claude Agent SDK returned a cross-session message.');
    }
    if (value.type === 'stream_event' && isRecord(value.event)) {
      const event = value.event;
      if (event.type === 'content_block_delta' && isRecord(event.delta)
        && event.delta.type === 'text_delta') {
        const text = readString(event.delta.text, 16_000);
        if (text) emit('assistant.delta', { text });
      }
    } else if (value.type === 'assistant' && isRecord(value.message)
      && Array.isArray(value.message.content)) {
      for (const block of value.message.content) {
        if (!isRecord(block) || block.type !== 'tool_use') continue;
        const id = readString(block.id);
        const name = safeText(block.name, 'Tool', 100);
        if (!id || this.activeTools.has(id)) continue;
        this.activeTools.set(id, name);
        emit('tool.started', { toolName: name, safeSummary: `Using ${name}` });
      }
    } else if (value.type === 'user' && isRecord(value.message)
      && Array.isArray(value.message.content)) {
      for (const block of value.message.content) {
        if (!isRecord(block) || block.type !== 'tool_result') continue;
        const id = readString(block.tool_use_id);
        if (!id) continue;
        const name = this.activeTools.get(id) ?? 'Tool';
        this.activeTools.delete(id);
        emit('tool.completed', {
          toolName: name,
          safeSummary: block.is_error === true ? `${name} returned an error` : `${name} completed`,
        });
      }
    } else if (value.type === 'tool_progress') {
      emit('tool.progress', {
        safeSummary: `${safeText(value.tool_name, 'Tool', 100)} is still working`,
      });
    } else if (value.type === 'system' && value.subtype === 'permission_denied') {
      emit('tool.completed', {
        toolName: safeText(value.tool_name, 'Tool', 100),
        safeSummary: 'Tool permission denied',
      });
    } else if (value.type === 'result') {
      this.terminal = true;
      if (value.subtype === 'success' && value.is_error === false) {
        emit('turn.completed', { summary: safeText(value.result, 'Claude completed the turn') });
      } else {
        const errors = Array.isArray(value.errors)
          ? value.errors.filter((error): error is string => typeof error === 'string').join(' ')
          : value.result;
        emit('turn.failed', { safeError: safeText(errors, 'Claude turn failed.'), kind: 'error' });
      }
    }
    return { events, init, terminal: this.terminal };
  }
}
