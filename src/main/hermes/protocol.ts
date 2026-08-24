import type { AdapterEvent } from '../../shared/adapter-events';
import type { AdapterSessionSummary, ApprovalDecision } from '../../shared/agent-adapter';

export interface HermesCapabilitiesAdmission {
  model: string;
}

export interface HermesHealthAdmission {
  version: string;
}

export interface HermesRunStart {
  runId: string;
}

export interface HermesApprovalRoute {
  requestId: string;
  runId: string;
  choices: string[];
}

export type HermesNormalization = {
  events: AdapterEvent[];
  approval?: HermesApprovalRoute;
  terminal: boolean;
};

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
    .replace(/(token|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[redacted]')
    .replace(/[A-Za-z]:\\[^\s]+/g, '[path]')
    .replace(/(^|\s)\/(?:[^\s/]+\/)*[^\s]+/g, '$1[path]')
    .slice(0, maximum);
}

const requiredFeatures = [
  'run_submission', 'run_status', 'run_events_sse', 'run_stop',
  'run_approval_response', 'tool_progress_events', 'approval_events',
  'session_resources',
] as const;

const requiredEndpoints: Record<string, { method: string; path: string }> = {
  runs: { method: 'POST', path: '/v1/runs' },
  run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
  run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
  run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' },
  run_stop: { method: 'POST', path: '/v1/runs/{run_id}/stop' },
  sessions: { method: 'GET', path: '/api/sessions' },
  session_create: { method: 'POST', path: '/api/sessions' },
};

export function readHermesCapabilities(value: unknown): HermesCapabilitiesAdmission {
  if (!isRecord(value)
    || value.object !== 'hermes.api_server.capabilities'
    || value.platform !== 'hermes-agent'
    || !readString(value.model, 240)
    || !isRecord(value.auth)
    || value.auth.type !== 'bearer'
    || value.auth.required !== true
    || !isRecord(value.runtime)
    || value.runtime.mode !== 'server_agent'
    || value.runtime.tool_execution !== 'server'
    || value.runtime.split_runtime !== false
    || !isRecord(value.features)
    || !isRecord(value.endpoints)) {
    throw new Error('Hermes API server capability admission failed.');
  }
  for (const feature of requiredFeatures) {
    if (value.features[feature] !== true) {
      throw new Error(`Hermes API server is missing required feature: ${feature}.`);
    }
  }
  for (const [name, expected] of Object.entries(requiredEndpoints)) {
    const endpoint = value.endpoints[name];
    if (!isRecord(endpoint) || endpoint.method !== expected.method || endpoint.path !== expected.path) {
      throw new Error(`Hermes API server endpoint admission failed: ${name}.`);
    }
  }
  return { model: value.model as string };
}

export function readHermesHealth(value: unknown): HermesHealthAdmission {
  if (!isRecord(value)
    || value.status !== 'ok'
    || value.platform !== 'hermes-agent'
    || !readString(value.version, 120)) {
    throw new Error('Hermes API server health admission failed.');
  }
  return { version: value.version as string };
}

export function readHermesSessions(value: unknown): AdapterSessionSummary[] {
  if (!isRecord(value)
    || value.object !== 'list'
    || !Array.isArray(value.data)
    || value.data.length > 200) {
    throw new Error('Hermes returned an invalid session list.');
  }
  const sessions: AdapterSessionSummary[] = [];
  for (const entry of value.data) {
    if (!isRecord(entry)) throw new Error('Hermes returned an invalid session summary.');
    const id = readString(entry.id);
    if (!id) throw new Error('Hermes returned an invalid session summary.');
    const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, 160) : '';
    const preview = typeof entry.preview === 'string' ? entry.preview.trim().slice(0, 160) : '';
    const lastActive = typeof entry.last_active === 'number' && Number.isFinite(entry.last_active)
      ? entry.last_active * 1_000
      : undefined;
    sessions.push({ id, label: title || preview || 'Hermes session', updatedAt: lastActive });
  }
  return sessions;
}

export function readHermesCreatedSession(value: unknown): AdapterSessionSummary {
  if (!isRecord(value) || value.object !== 'hermes.session' || !isRecord(value.session)) {
    throw new Error('Hermes returned an invalid created session.');
  }
  const [session] = readHermesSessions({ object: 'list', data: [value.session] });
  return session;
}

export function readHermesRunStart(value: unknown): HermesRunStart {
  if (!isRecord(value) || value.status !== 'started' || !readString(value.run_id)) {
    throw new Error('Hermes returned an invalid run start response.');
  }
  return { runId: value.run_id as string };
}

export function hermesApprovalChoice(decision: ApprovalDecision, choices: readonly string[]): string {
  const choice = decision === 'allow-once' ? 'once' : decision === 'allow-always' ? 'always' : 'deny';
  if (!choices.includes(choice)) throw new Error('Hermes did not offer the requested approval scope.');
  return choice;
}

export class HermesRunNormalizer {
  private sequence = 0;
  private terminal = false;
  private approvalSequence = 0;

  constructor(
    private readonly connectionId: string,
    private readonly sessionId: string,
    private readonly runId: string,
  ) {}

  normalize(value: unknown): HermesNormalization {
    if (!isRecord(value) || value.run_id !== this.runId || !readString(value.event, 80)) {
      throw new Error('Hermes returned an invalid run event.');
    }
    if (this.terminal) return { events: [], terminal: true };
    const events: AdapterEvent[] = [];
    const emit = (type: AdapterEvent['type'], payload: AdapterEvent['payload']) => {
      this.sequence += 1;
      events.push({
        protocolVersion: 1,
        eventId: `${this.connectionId}:${this.runId}:${this.sequence}`,
        timestamp: typeof value.timestamp === 'number' && Number.isFinite(value.timestamp)
          ? new Date(value.timestamp * 1_000).toISOString()
          : new Date().toISOString(),
        connectionId: this.connectionId,
        sessionId: this.sessionId,
        turnId: this.runId,
        type,
        payload,
      } as AdapterEvent);
    };
    let approval: HermesApprovalRoute | undefined;
    switch (value.event) {
      case 'message.delta': {
        const delta = readString(value.delta, 16_000);
        if (delta) emit('assistant.delta', { text: delta });
        break;
      }
      case 'reasoning.available':
        emit('agent.thinking', { status: 'Reasoning' });
        break;
      case 'tool.started': {
        const toolName = safeText(value.tool, 'Tool', 100);
        emit('tool.started', {
          toolName,
          safeSummary: safeText(value.preview, `Using ${toolName}`),
        });
        break;
      }
      case 'tool.completed': {
        const toolName = safeText(value.tool, 'Tool', 100);
        emit('tool.completed', {
          toolName,
          safeSummary: value.error === true ? `${toolName} returned an error` : `${toolName} completed`,
        });
        break;
      }
      case 'subagent.start':
        emit('tool.started', { toolName: 'Agent', safeSummary: safeText(value.preview, 'Delegating work') });
        break;
      case 'subagent.complete':
        emit('tool.completed', { toolName: 'Agent', safeSummary: safeText(value.summary, 'Delegated work completed') });
        break;
      case 'approval.request': {
        const choices = Array.isArray(value.choices)
          ? value.choices.filter((choice): choice is string => typeof choice === 'string')
          : [];
        if (!choices.includes('once') || !choices.includes('deny')) {
          throw new Error('Hermes returned an invalid approval choice set.');
        }
        this.approvalSequence += 1;
        const requestId = `${this.runId}:approval:${this.approvalSequence}`;
        const allowedDecisions: Array<'allow-once' | 'allow-always' | 'deny'> = ['allow-once'];
        if (choices.includes('always')) allowedDecisions.push('allow-always');
        allowedDecisions.push('deny');
        emit('approval.requested', {
          requestId,
          kind: 'exec',
          action: safeText(value.description, 'Hermes requests permission to run a command'),
          safeTarget: safeText(value.command, 'Protected command'),
          allowedDecisions,
        });
        approval = { requestId, runId: this.runId, choices };
        break;
      }
      case 'approval.responded':
        break;
      case 'run.completed':
        this.terminal = true;
        emit('turn.completed', { summary: safeText(value.output, 'Hermes completed the turn') });
        break;
      case 'run.cancelled':
        this.terminal = true;
        emit('turn.failed', { safeError: 'Hermes turn cancelled.', kind: 'cancelled' });
        break;
      case 'run.failed':
        this.terminal = true;
        emit('turn.failed', { safeError: safeText(value.error, 'Hermes turn failed.'), kind: 'error' });
        break;
      case 'run.steered':
        break;
      default:
        break;
    }
    return { events, approval, terminal: this.terminal };
  }
}
