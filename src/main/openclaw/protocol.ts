import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

import type { AdapterEvent } from '../../shared/adapter-events';
import { OPENCLAW_PROTOCOL_VERSION } from '../../shared/openclaw';

export const OPENCLAW_SCOPES = [
  'operator.read',
  'operator.write',
  'operator.approvals',
] as const;

export const OPENCLAW_CAPABILITIES = [
  'session-scoped-events',
  'tool-events',
  'approvals',
  'exec-approvals',
  'plugin-approvals',
] as const;

export interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface GatewayErrorShape {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
}

export interface GatewayHello {
  type: 'hello-ok';
  protocol: number;
  server: { version: string; connId: string };
  features: { methods: string[]; events: string[]; capabilities?: string[] };
  auth: { deviceToken?: string; role: string; scopes: string[] };
  policy: { maxPayload: number; maxBufferedBytes: number; tickIntervalMs: number };
  snapshot?: unknown;
}

export type GatewayFrame =
  | { type: 'res'; id: string; ok: boolean; payload?: unknown; error?: GatewayErrorShape }
  | { type: 'event'; event: string; payload?: unknown; seq?: number };

export class GatewayRequestError extends Error {
  constructor(
    message: string,
    readonly code = 'GATEWAY_ERROR',
    readonly details?: unknown,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'GatewayRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseGatewayFrame(raw: string): GatewayFrame | undefined {
  if (raw.length > 1_048_576) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value.type === 'res' && readString(value.id) && typeof value.ok === 'boolean') {
    const error = isRecord(value.error) && readString(value.error.message)
      ? {
          code: readString(value.error.code) ?? 'GATEWAY_ERROR',
          message: readString(value.error.message) as string,
          details: value.error.details,
          retryable: value.error.retryable === true,
          retryAfterMs: typeof value.error.retryAfterMs === 'number'
            ? value.error.retryAfterMs
            : undefined,
        }
      : undefined;
    return { type: 'res', id: value.id as string, ok: value.ok, payload: value.payload, error };
  }
  if (value.type === 'event' && readString(value.event)) {
    return {
      type: 'event',
      event: value.event as string,
      payload: value.payload,
      seq: Number.isInteger(value.seq) && (value.seq as number) >= 0
        ? value.seq as number
        : undefined,
    };
  }
  return undefined;
}

export function isGatewayHello(value: unknown): value is GatewayHello {
  if (!isRecord(value) || value.type !== 'hello-ok' || value.protocol !== OPENCLAW_PROTOCOL_VERSION) {
    return false;
  }
  const server = value.server;
  const features = value.features;
  const auth = value.auth;
  const policy = value.policy;
  return isRecord(server) && Boolean(readString(server.version)) && Boolean(readString(server.connId))
    && isRecord(features) && Array.isArray(features.methods) && Array.isArray(features.events)
    && isRecord(auth) && Boolean(readString(auth.role)) && Array.isArray(auth.scopes)
    && isRecord(policy) && typeof policy.maxPayload === 'number'
    && typeof policy.maxBufferedBytes === 'number' && typeof policy.tickIntervalMs === 'number';
}

export function normalizeGatewayUrl(input: string): { url: string; scope: string; insecureLoopback: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error('Enter a valid OpenClaw Gateway WebSocket URL.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Gateway URLs cannot contain credentials, query parameters, or fragments.');
  }
  const host = parsed.hostname.toLowerCase();
  const loopback = host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (parsed.protocol !== 'wss:' && !(parsed.protocol === 'ws:' && loopback)) {
    throw new Error('Use wss:// for remote gateways. Plain ws:// is limited to loopback.');
  }
  parsed.pathname = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '');
  return {
    url: parsed.toString(),
    scope: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
    insecureLoopback: parsed.protocol === 'ws:',
  };
}

export function generateDeviceIdentity(): DeviceIdentity {
  const pair = generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwk = pair.publicKey.export({ format: 'jwk' });
  if (!jwk.x) throw new Error('Unable to export the OpenClaw device public key.');
  const raw = Buffer.from(jwk.x, 'base64url');
  return {
    deviceId: createHash('sha256').update(raw).digest('hex'),
    publicKeyPem,
    privateKeyPem,
  };
}

export function publicKeyRawBase64Url(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem).export({ format: 'jwk' });
  if (!key.x) throw new Error('Invalid Ed25519 public key.');
  return key.x;
}

export function buildDeviceAuthPayload(input: {
  identity: DeviceIdentity;
  nonce: string;
  signedAt: number;
  signatureToken?: string;
  platform: string;
}): string {
  return [
    'v3',
    input.identity.deviceId,
    'gateway-client',
    'backend',
    'operator',
    OPENCLAW_SCOPES.join(','),
    String(input.signedAt),
    input.signatureToken ?? '',
    input.nonce,
    input.platform.trim().toLowerCase(),
    'desktop',
  ].join('|');
}

export function signDeviceAuth(identity: DeviceIdentity, payload: string): string {
  return sign(null, Buffer.from(payload, 'utf8'), identity.privateKeyPem).toString('base64url');
}

function safeText(value: unknown, fallback: string, limit = 180): string {
  const text = typeof value === 'string' ? value : fallback;
  return text.replace(/[\r\n\t]+/g, ' ').replace(/(?:[A-Za-z]:\\|\/)[^\s"']+/g, '[path]')
    .slice(0, limit);
}

function eventContext(connectionId: string, sessionId?: string, turnId?: string) {
  return {
    protocolVersion: 1 as const,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
    connectionId,
    sessionId,
    turnId,
  };
}

export function normalizeOpenClawEvent(
  connectionId: string,
  nativeEvent: string,
  payload: unknown,
): AdapterEvent[] {
  if (!isRecord(payload)) return [];
  const sessionId = readString(payload.sessionKey) ?? readString(payload.key);
  const turnId = readString(payload.runId);
  const context = eventContext(connectionId, sessionId, turnId);

  if (nativeEvent === 'chat') {
    if (payload.state === 'status') {
      return [{ ...context, type: 'agent.thinking', payload: { status: safeText(payload.phase, 'Preparing') } }];
    }
    if (payload.state === 'delta' && typeof payload.deltaText === 'string') {
      return [{ ...context, type: 'assistant.delta', payload: { text: payload.deltaText.slice(0, 32_000) } }];
    }
    if (payload.state === 'final') {
      return [{ ...context, type: 'turn.completed', payload: { summary: safeText(payload.stopReason, 'Turn completed') } }];
    }
    if (payload.state === 'aborted' || payload.state === 'error') {
      return [{
        ...context,
        type: 'turn.failed',
        payload: {
          safeError: safeText(payload.errorMessage, payload.state === 'aborted' ? 'Turn cancelled' : 'Turn failed'),
          kind: payload.state === 'aborted' ? 'cancelled' : 'error',
        },
      }];
    }
  }

  if (nativeEvent === 'agent') {
    const data = isRecord(payload.data) ? payload.data : payload;
    const phase = readString(data.phase);
    const name = safeText(data.name ?? data.toolName, 'Tool', 80);
    if (payload.stream === 'lifecycle' && phase === 'start') {
      return [{ ...context, type: 'agent.thinking', payload: { status: 'Agent is working' } }];
    }
    if (payload.stream === 'tool' && phase === 'start') {
      return [{ ...context, type: 'tool.started', payload: { toolName: name, safeSummary: `Using ${name}` } }];
    }
    if (payload.stream === 'tool' && (phase === 'update' || phase === 'progress')) {
      return [{ ...context, type: 'tool.progress', payload: { safeSummary: safeText(data.summary, `${name} is working`) } }];
    }
    if (payload.stream === 'tool' && (phase === 'result' || phase === 'end')) {
      return [{ ...context, type: 'tool.completed', payload: { toolName: name, safeSummary: `${name} completed` } }];
    }
  }

  if (nativeEvent === 'session.tool') {
    const phase = readString(payload.phase);
    const name = safeText(payload.toolName ?? payload.name, 'Tool', 80);
    if (phase === 'start') return [{ ...context, type: 'tool.started', payload: { toolName: name, safeSummary: `Using ${name}` } }];
    if (phase === 'progress' || phase === 'update') return [{ ...context, type: 'tool.progress', payload: { safeSummary: safeText(payload.summary, `${name} is working`) } }];
    if (phase === 'end' || phase === 'result') return [{ ...context, type: 'tool.completed', payload: { toolName: name, safeSummary: `${name} completed` } }];
  }

  if (nativeEvent === 'session.approval' && payload.phase === 'pending' && isRecord(payload.approval)) {
    const approval = payload.approval;
    const presentation = isRecord(approval.presentation) ? approval.presentation : {};
    const kind = presentation.kind === 'plugin' || presentation.kind === 'system-agent' ? presentation.kind : 'exec';
    const allowed = Array.isArray(presentation.allowedDecisions)
      ? presentation.allowedDecisions.filter((item): item is 'allow-once' | 'allow-always' | 'deny' => item === 'allow-once' || item === 'allow-always' || item === 'deny')
      : ['allow-once', 'deny'] as Array<'allow-once' | 'allow-always' | 'deny'>;
    return [{
      ...context,
      type: 'approval.requested',
      payload: {
        requestId: readString(approval.id) ?? 'invalid-approval',
        kind,
        action: safeText(presentation.title, kind === 'exec' ? 'Run command' : 'Sensitive action'),
        safeTarget: safeText(presentation.commandText ?? presentation.description, 'Review required'),
        allowedDecisions: allowed.includes('deny') ? allowed : [...allowed, 'deny'],
      },
    }];
  }

  if (nativeEvent === 'session.approval' && payload.phase === 'terminal' && isRecord(payload.approval)) {
    const approval = payload.approval;
    const terminalStatuses = ['allowed', 'denied', 'expired', 'cancelled'] as const;
    const status = terminalStatuses.find((candidate) => candidate === approval.status);
    const requestId = readString(approval.id);
    if (!status || !requestId) return [];
    return [{ ...context, type: 'approval.resolved', payload: { requestId, status } }];
  }

  if (nativeEvent === 'exec.approval.requested') {
    const command = safeText(payload.command ?? (isRecord(payload.systemRunPlan) ? payload.systemRunPlan.commandText : undefined), 'Command hidden');
    return [{ ...context, type: 'approval.requested', payload: { requestId: readString(payload.id) ?? 'invalid-approval', kind: 'exec', action: 'Run command', safeTarget: command, allowedDecisions: ['allow-once', 'allow-always', 'deny'] } }];
  }
  return [];
}

export function findPairingRequestId(details: unknown): string | undefined {
  if (!isRecord(details)) return undefined;
  return readString(details.requestId) ?? readString(details.pairingRequestId)
    ?? (isRecord(details.pairing) ? readString(details.pairing.requestId) : undefined);
}
