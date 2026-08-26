import {
  readHermesCapabilities,
  readHermesCreatedSession,
  readHermesHealth,
  readHermesRunStart,
  readHermesSessions,
  type HermesCapabilitiesAdmission,
  type HermesHealthAdmission,
} from './protocol';
import type { AdapterSessionSummary } from '../../shared/agent-adapter';
import { secureTransportError } from '../secure-transport';

const maximumJsonBytes = 512 * 1024;
const maximumSseFrameBytes = 256 * 1024;

export interface HermesApiAdmission extends HermesCapabilitiesAdmission, HermesHealthAdmission {}

export class HermesApiError extends Error {
  constructor(message: string, readonly reconnectable: boolean) {
    super(message);
    this.name = 'HermesApiError';
  }
}

export function isHermesReconnectableError(error: unknown): boolean {
  return error instanceof HermesApiError && error.reconnectable;
}

export interface HermesApiClientPort {
  admit(): Promise<HermesApiAdmission>;
  listSessions(): Promise<AdapterSessionSummary[]>;
  createSession(label?: string): Promise<AdapterSessionSummary>;
  startRun(sessionId: string, input: string): Promise<string>;
  streamRun(runId: string, onEvent: (event: unknown) => void, signal: AbortSignal): Promise<void>;
  resolveApproval(runId: string, choice: string): Promise<void>;
  stopRun(runId: string): Promise<void>;
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function readHermesEndpoint(value: string): { baseUrl: string; insecureLocal: boolean } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Hermes endpoint must be a valid URL.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Hermes endpoint cannot contain credentials, query parameters, or a fragment.');
  }
  const insecureLocal = url.protocol === 'http:' && isLoopback(url.hostname);
  if (url.protocol !== 'https:' && !insecureLocal) {
    throw new Error('Hermes requires HTTPS except on the loopback interface.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return { baseUrl: url.toString().replace(/\/$/, ''), insecureLocal };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumJsonBytes) {
    throw new Error('Hermes returned an oversized JSON response.');
  }
  if (!response.ok) {
    throw new HermesApiError(
      `Hermes request failed with HTTP ${response.status}.`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Hermes returned malformed JSON.');
  }
  return value;
}

export class HermesSseDecoder {
  private buffer = '';

  push(chunk: string): unknown[] {
    this.buffer += chunk.replace(/\r\n/g, '\n');
    if (new TextEncoder().encode(this.buffer).byteLength > maximumSseFrameBytes) {
      throw new Error('Hermes returned an oversized SSE frame.');
    }
    const events: unknown[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = frame.split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) {
        try {
          events.push(JSON.parse(data));
        } catch {
          throw new Error('Hermes returned malformed SSE event data.');
        }
      }
      boundary = this.buffer.indexOf('\n\n');
    }
    return events;
  }

  finish(): void {
    if (this.buffer.trim() && !this.buffer.trim().startsWith(':')) {
      throw new Error('Hermes closed an incomplete SSE frame.');
    }
    this.buffer = '';
  }
}

export class HermesApiClient implements HermesApiClientPort {
  private readonly baseUrl: string;

  constructor(
    endpoint: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = readHermesEndpoint(endpoint).baseUrl;
    if (!token || token.length > 16_384) throw new Error('Hermes bearer token is required.');
  }

  async admit(): Promise<HermesApiAdmission> {
    const [health, capabilities] = await Promise.all([
      this.json('/health'),
      this.json('/v1/capabilities'),
    ]);
    return { ...readHermesHealth(health), ...readHermesCapabilities(capabilities) };
  }

  async listSessions(): Promise<AdapterSessionSummary[]> {
    return readHermesSessions(await this.json('/api/sessions?limit=200'));
  }

  async createSession(label?: string): Promise<AdapterSessionSummary> {
    return readHermesCreatedSession(await this.json('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(label?.trim() ? { title: label.trim().slice(0, 160) } : {}),
    }));
  }

  async startRun(sessionId: string, input: string): Promise<string> {
    const result = readHermesRunStart(await this.json('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ input, session_id: sessionId }),
    }));
    return result.runId;
  }

  async streamRun(runId: string, onEvent: (event: unknown) => void, signal: AbortSignal): Promise<void> {
    const response = await this.request(this.url(`/v1/runs/${encodeURIComponent(runId)}/events`), {
      method: 'GET', headers: this.headers(), signal,
    });
    if (!response.ok) {
      throw new HermesApiError(
        `Hermes run stream failed with HTTP ${response.status}.`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    if (!response.body
      || !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      throw new Error('Hermes run stream returned an invalid content type.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const sse = new HermesSseDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of sse.push(decoder.decode(value, { stream: true }))) onEvent(event);
    }
    for (const event of sse.push(decoder.decode())) onEvent(event);
    sse.finish();
  }

  async resolveApproval(runId: string, choice: string): Promise<void> {
    await this.json(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: 'POST', body: JSON.stringify({ choice }),
    });
  }

  async stopRun(runId: string): Promise<void> {
    const value = await this.json(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
    if (typeof value !== 'object' || value === null
      || (value as Record<string, unknown>).run_id !== runId
      || (value as Record<string, unknown>).status !== 'stopping') {
      throw new Error('Hermes returned an invalid stop acknowledgement.');
    }
  }

  private async json(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.request(this.url(path), {
      ...init,
      headers: { ...this.headers(), ...(init.headers ?? {}) },
    });
    return readJsonResponse(response);
  }

  private async request(input: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(input, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      const tlsError = secureTransportError('Hermes', error);
      if (tlsError) {
        throw new HermesApiError(tlsError.message, false);
      }
      throw new HermesApiError('Hermes transport is unavailable.', true);
    }
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}
