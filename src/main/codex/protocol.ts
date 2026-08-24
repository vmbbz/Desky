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

function readNullableString(value: unknown, limit = 512): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value.length <= limit ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function protocolMismatch(method: string): never {
  throw new Error(`Codex protocol validation failed for ${method}.`);
}

const accountTypes = new Set(['apiKey', 'chatgpt', 'amazonBedrock']);
const planTypes = new Set([
  'free', 'go', 'plus', 'pro', 'prolite', 'team', 'self_serve_business_usage_based',
  'business', 'enterprise_cbp_usage_based', 'enterprise', 'edu', 'unknown',
]);
const threadItemTypes = new Set([
  'userMessage', 'hookPrompt', 'agentMessage', 'plan', 'reasoning', 'commandExecution',
  'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'subAgentActivity',
  'webSearch', 'imageView', 'sleep', 'imageGeneration', 'enteredReviewMode',
  'exitedReviewMode', 'contextCompaction',
]);
const terminalTurnStatuses = new Set(['completed', 'interrupted', 'failed']);
const consumedNotificationMethods = new Set([
  'turn/started',
  'item/agentMessage/delta',
  'item/started',
  'item/completed',
  'turn/completed',
]);

export function readCodexInitializeResponse(value: unknown): { userAgent: string } {
  if (!isRecord(value)
    || !readString(value.userAgent, 240)
    || !readString(value.codexHome, 2_048)
    || !readString(value.platformFamily, 80)
    || !readString(value.platformOs, 80)) {
    throw new Error('Codex returned an invalid initialize response.');
  }
  return { userAgent: value.userAgent as string };
}

export function readCodexAccountState(value: unknown): { authenticated: boolean; requiresOpenaiAuth: boolean } {
  if (!isRecord(value) || typeof value.requiresOpenaiAuth !== 'boolean') {
    throw new Error('Codex returned an invalid account state.');
  }
  if (value.account === null) {
    return { authenticated: false, requiresOpenaiAuth: value.requiresOpenaiAuth };
  }
  if (!isRecord(value.account)
    || typeof value.account.type !== 'string'
    || !accountTypes.has(value.account.type)) {
    throw new Error('Codex returned an invalid account state.');
  }
  if (value.account.type === 'chatgpt'
    && (readNullableString(value.account.email, 320) === undefined
      || typeof value.account.planType !== 'string'
      || !planTypes.has(value.account.planType))) {
    throw new Error('Codex returned an invalid account state.');
  }
  if (value.account.type === 'amazonBedrock'
    && typeof value.account.usesCodexManagedCredentials !== 'boolean') {
    throw new Error('Codex returned an invalid account state.');
  }
  return { authenticated: true, requiresOpenaiAuth: value.requiresOpenaiAuth };
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
  if (!isRecord(value)
    || !Array.isArray(value.data)
    || value.data.length > 200
    || readNullableString(value.nextCursor) === undefined
    || readNullableString(value.backwardsCursor) === undefined) {
    throw new Error('Codex returned an invalid thread list.');
  }
  const sessions: AdapterSessionSummary[] = [];
  for (const entry of value.data) {
    if (!isRecord(entry)
      || typeof entry.preview !== 'string'
      || (entry.name !== null && typeof entry.name !== 'string')
      || readFiniteNumber(entry.updatedAt) === undefined
      || (entry.updatedAt as number) < 0) {
      throw new Error('Codex returned an invalid thread summary.');
    }
    const id = readString(entry.id);
    if (!id) throw new Error('Codex returned an invalid thread summary.');
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 100) : '';
    const preview = entry.preview.trim().slice(0, 100);
    sessions.push({
      id,
      label: name || preview || 'Codex thread',
      updatedAt: (entry.updatedAt as number) * 1_000,
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
    if (!consumedNotificationMethods.has(notification.method)) return [];
    if (!isRecord(notification.params)) protocolMismatch(notification.method);
    const params = notification.params;
    const sessionId = readString(params.threadId);
    const turn = isRecord(params.turn) ? params.turn : undefined;
    const turnId = readString(params.turnId) ?? readString(turn?.id);
    if (!sessionId) protocolMismatch(notification.method);
    if (notification.method === 'turn/started') {
      if (!turnId || !turn || turn.status !== 'inProgress') protocolMismatch(notification.method);
    } else if (notification.method === 'turn/completed') {
      if (!turnId || !turn || !terminalTurnStatuses.has(String(turn.status))) {
        protocolMismatch(notification.method);
      }
      if (turn.error !== null && !isRecord(turn.error)) protocolMismatch(notification.method);
      if (turn.status === 'failed'
        && (!isRecord(turn.error) || typeof turn.error.message !== 'string')) {
        protocolMismatch(notification.method);
      }
    } else if (notification.method === 'item/agentMessage/delta') {
      if (!turnId || !readString(params.itemId) || typeof params.delta !== 'string'
        || params.delta.length > 100_000) protocolMismatch(notification.method);
    } else {
      const lifecycleTimestamp = notification.method === 'item/started'
        ? params.startedAtMs
        : params.completedAtMs;
      if (!turnId
        || readFiniteNumber(lifecycleTimestamp) === undefined
        || !isRecord(params.item)
        || !readString(params.item.id)
        || typeof params.item.type !== 'string'
        || !threadItemTypes.has(params.item.type)) {
        protocolMismatch(notification.method);
      }
    }
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
      return params.delta
        ? [this.event(scoped, 'assistant.delta', { text: params.delta as string })]
        : [];
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
    const itemId = readString(request.params.itemId);
    if (!sessionId || !turnId || !itemId
      || readFiniteNumber(request.params.startedAtMs) === undefined
      || sessionId !== context.selectedSessionId
      || turnId !== context.activeTurnId) return undefined;
    const requestId = `codex:${typeof request.id}:${String(request.id)}`;
    if (request.method === 'item/commandExecution/requestApproval') {
      if (request.params.reason !== undefined
        && readNullableString(request.params.reason, 2_000) === undefined) return undefined;
      if (request.params.environmentId !== null
        && readString(request.params.environmentId) === undefined) return undefined;
      const networkValue = request.params.networkApprovalContext;
      const network = isRecord(networkValue)
        && readString(networkValue.host, 253)
        && ['http', 'https', 'socks5Tcp', 'socks5Udp'].includes(String(networkValue.protocol));
      if (networkValue !== undefined && networkValue !== null && !network) return undefined;
      const networkTarget = network
        ? `${String(networkValue.protocol)}://${safeText(networkValue.host, 'requested host', 253)}`
        : undefined;
      return {
        route: { requestId, rpcId: request.id, method: request.method, kind: 'exec', sessionId, turnId },
        event: this.event(context, 'approval.requested', {
          requestId,
          kind: 'exec',
          action: network ? 'Allow network access' : 'Run command',
          safeTarget: networkTarget ?? safeText(request.params.reason, 'Codex command'),
          allowedDecisions: ['allow-once', 'allow-always', 'deny'],
        }),
      };
    }
    if (request.method === 'item/fileChange/requestApproval') {
      if (request.params.reason !== undefined
        && readNullableString(request.params.reason, 2_000) === undefined) return undefined;
      if (request.params.grantRoot !== undefined
        && readNullableString(request.params.grantRoot, 2_048) === undefined) return undefined;
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
