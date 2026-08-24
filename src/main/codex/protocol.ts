import { basename } from 'node:path';

import type { AdapterEvent } from '../../shared/adapter-events';
import type {
  AdapterSessionSummary,
  ApprovalDecision,
  ApprovalKind,
} from '../../shared/agent-adapter';
import type {
  CodexServerNotification,
  CodexServerRequest,
} from './app-server-client';

export interface CodexProtocolContext {
  connectionId: string;
  selectedSessionId?: string;
  activeTurnId?: string;
}

export interface CodexApprovalRoute {
  requestId: string;
  rpcId: number | string;
  method: 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval';
  kind: Extract<ApprovalKind, 'exec' | 'file-change'>;
  sessionId: string;
  turnId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, limit = 512): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= limit ? value : undefined;
}

function safeText(value: unknown, fallback: string, limit = 180): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(token|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/(^|\s)\/(?:[^\s/]+\/)*[^\s]+/g, '$1[path]')
    .slice(0, limit);
}

function itemTool(item: Record<string, unknown>): { name: string; summary: string } | undefined {
  switch (item.type) {
    case 'commandExecution': return { name: 'Shell', summary: 'Running a command' };
    case 'fileChange': return { name: 'Files', summary: 'Updating workspace files' };
    case 'mcpToolCall': return { name: 'MCP tool', summary: 'Calling a connected tool' };
    case 'dynamicToolCall': return { name: 'Tool', summary: 'Running a client tool' };
    case 'collabAgentToolCall': return { name: 'Agent', summary: 'Coordinating agent work' };
    case 'webSearch': return { name: 'Web search', summary: 'Searching the web' };
    case 'imageView': return { name: 'Image viewer', summary: 'Inspecting an image' };
    default: return undefined;
  }
}

export function readCodexSessions(value: unknown): AdapterSessionSummary[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error('Codex returned an invalid thread list.');
  }
  const sessions: AdapterSessionSummary[] = [];
  for (const entry of value.data.slice(0, 200)) {
    if (!isRecord(entry)) continue;
    const id = readString(entry.id);
    if (!id) continue;
    const name = readString(entry.name, 100);
    const preview = readString(entry.preview, 100);
    sessions.push({
      id,
      label: name ?? preview ?? 'Codex thread',
      updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt)
        ? entry.updatedAt * 1_000
        : undefined,
    });
  }
  return sessions;
}

export function readCodexThreadId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.thread)) throw new Error('Codex returned an invalid thread.');
  const id = readString(value.thread.id);
  if (!id) throw new Error('Codex returned an invalid thread id.');
  return id;
}

export function readCodexTurnId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.turn)) throw new Error('Codex returned an invalid turn.');
  const id = readString(value.turn.id);
  if (!id || value.turn.status !== 'inProgress') throw new Error('Codex returned an invalid active turn.');
  return id;
}

export function codexApprovalDecision(decision: ApprovalDecision): 'accept' | 'acceptForSession' | 'decline' {
  if (decision === 'allow-once') return 'accept';
  if (decision === 'allow-always') return 'acceptForSession';
  return 'decline';
}

export class CodexProtocolNormalizer {
  private sequence = 0;
  private readonly terminalTurns = new Set<string>();
  private readonly toolItems = new Map<string, { name: string; summary: string }>();

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  connectionReady(context: CodexProtocolContext, runtimeVersion: string): AdapterEvent {
    return this.event(context, 'connection.ready', { runtimeName: `Codex ${runtimeVersion}` });
  }

  userInputAccepted(
    context: CodexProtocolContext,
    sessionId: string,
    turnId: string,
    summary: string,
  ): AdapterEvent[] {
    const accepted = { ...context, selectedSessionId: sessionId, activeTurnId: turnId };
    return [
      this.event(accepted, 'user.input.accepted', { summary: safeText(summary, 'Message accepted', 120) }),
      this.event(accepted, 'agent.thinking', { status: 'Codex is working' }),
    ];
  }

  normalizeNotification(
    notification: CodexServerNotification,
    context: CodexProtocolContext,
  ): AdapterEvent[] {
    if (!isRecord(notification.params)) return [];
    const params = notification.params;
    const sessionId = readString(params.threadId);
    const turn = isRecord(params.turn) ? params.turn : undefined;
    const turnId = readString(params.turnId) ?? readString(turn?.id);
    if (sessionId && context.selectedSessionId && sessionId !== context.selectedSessionId) return [];
    if (turnId && context.activeTurnId && turnId !== context.activeTurnId) return [];
    const scoped = {
      ...context,
      selectedSessionId: sessionId ?? context.selectedSessionId,
      activeTurnId: turnId ?? context.activeTurnId,
    };

    if (notification.method === 'turn/started' && turnId) {
      return [this.event(scoped, 'agent.thinking', { status: 'Codex is working' })];
    }
    if (notification.method === 'item/agentMessage/delta') {
      const delta = readString(params.delta, 100_000);
      return delta ? [this.event(scoped, 'assistant.delta', { text: delta })] : [];
    }
    if ((notification.method === 'item/started' || notification.method === 'item/completed')
      && isRecord(params.item)) {
      const itemId = readString(params.item.id);
      const tool = itemTool(params.item);
      if (!itemId || !tool) return [];
      if (notification.method === 'item/started') {
        if (this.toolItems.size >= 256) this.toolItems.delete(this.toolItems.keys().next().value as string);
        this.toolItems.set(itemId, tool);
        return [this.event(scoped, 'tool.started', { toolName: tool.name, safeSummary: tool.summary })];
      }
      const started = this.toolItems.get(itemId);
      if (!started) return [];
      this.toolItems.delete(itemId);
      return [this.event(scoped, 'tool.completed', {
        toolName: started.name,
        safeSummary: `${started.summary} completed`,
      })];
    }
    if (notification.method === 'turn/completed' && turnId && turn) {
      if (this.terminalTurns.has(turnId)) return [];
      if (this.terminalTurns.size >= 1_024) {
        this.terminalTurns.delete(this.terminalTurns.values().next().value as string);
      }
      this.terminalTurns.add(turnId);
      if (turn.status === 'completed') {
        return [this.event(scoped, 'turn.completed', { summary: 'Codex completed the turn' })];
      }
      if (turn.status === 'interrupted') {
        return [this.event(scoped, 'turn.failed', {
          safeError: 'The Codex turn was cancelled.',
          kind: 'cancelled',
        })];
      }
      if (turn.status === 'failed') {
        const message = isRecord(turn.error) ? turn.error.message : undefined;
        return [this.event(scoped, 'turn.failed', {
          safeError: safeText(message, 'The Codex turn failed.'),
          kind: 'error',
        })];
      }
    }
    return [];
  }

  normalizeApprovalRequest(
    request: CodexServerRequest,
    context: CodexProtocolContext,
  ): { route: CodexApprovalRoute; event: AdapterEvent } | undefined {
    if (!isRecord(request.params)) return undefined;
    const sessionId = readString(request.params.threadId);
    const turnId = readString(request.params.turnId);
    if (!sessionId || !turnId
      || sessionId !== context.selectedSessionId
      || turnId !== context.activeTurnId) return undefined;
    const requestId = `codex:${String(request.id)}`;
    if (request.method === 'item/commandExecution/requestApproval') {
      const network = isRecord(request.params.networkApprovalContext);
      return {
        route: { requestId, rpcId: request.id, method: request.method, kind: 'exec', sessionId, turnId },
        event: this.event(context, 'approval.requested', {
          requestId,
          kind: 'exec',
          action: network ? 'Allow network access' : 'Run command',
          safeTarget: safeText(request.params.reason, network ? 'Requested network destination' : 'Codex command'),
          allowedDecisions: ['allow-once', 'allow-always', 'deny'],
        }),
      };
    }
    if (request.method === 'item/fileChange/requestApproval') {
      const grantRoot = readString(request.params.grantRoot, 2_048);
      return {
        route: { requestId, rpcId: request.id, method: request.method, kind: 'file-change', sessionId, turnId },
        event: this.event(context, 'approval.requested', {
          requestId,
          kind: 'file-change',
          action: 'Change files',
          safeTarget: grantRoot ? basename(grantRoot) : 'Workspace files',
          allowedDecisions: ['allow-once', 'allow-always', 'deny'],
        }),
      };
    }
    return undefined;
  }

  private event<T extends AdapterEvent['type']>(
    context: CodexProtocolContext,
    type: T,
    payload: Extract<AdapterEvent, { type: T }>['payload'],
  ): Extract<AdapterEvent, { type: T }> {
    this.sequence += 1;
    return {
      protocolVersion: 1,
      eventId: `${context.connectionId}:${this.sequence}`,
      timestamp: this.now(),
      connectionId: context.connectionId,
      sessionId: context.selectedSessionId,
      turnId: context.activeTurnId,
      type,
      payload,
    } as Extract<AdapterEvent, { type: T }>;
  }
}
