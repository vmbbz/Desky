import { describe, expect, it, vi } from 'vitest';

import {
  HermesApiError,
  HermesApiClient,
  HermesSseDecoder,
  isHermesReconnectableError,
  readHermesEndpoint,
} from '../src/main/hermes/api-client';
import { hermesCapabilitiesFixture } from './hermes-protocol.test';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HermesApiClient', () => {
  it('admits HTTPS or loopback HTTP but rejects remote plaintext and URL credentials', () => {
    expect(readHermesEndpoint('http://127.0.0.1:8642/')).toEqual({
      baseUrl: 'http://127.0.0.1:8642', insecureLocal: true,
    });
    expect(readHermesEndpoint('https://hermes.example/agent/')).toEqual({
      baseUrl: 'https://hermes.example/agent', insecureLocal: false,
    });
    expect(() => readHermesEndpoint('http://hermes.example')).toThrow('requires HTTPS');
    expect(() => readHermesEndpoint('https://token@hermes.example')).toThrow('cannot contain credentials');
  });

  it('authenticates, admits capabilities, and uses structured session/run endpoints', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/health')) {
        return jsonResponse({ status: 'ok', platform: 'hermes-agent', version: '0.9.0' });
      }
      if (url.endsWith('/v1/capabilities')) return jsonResponse(hermesCapabilitiesFixture);
      if (url.includes('/api/sessions?')) {
        return jsonResponse({ object: 'list', data: [{ id: 'session-1', title: 'Desky' }] });
      }
      if (url.endsWith('/api/sessions')) {
        return jsonResponse({ object: 'hermes.session', session: { id: 'session-2', title: 'New' } }, 201);
      }
      if (url.endsWith('/v1/runs')) return jsonResponse({ run_id: 'run-1', status: 'started' }, 202);
      if (url.endsWith('/approval')) {
        return jsonResponse({ object: 'hermes.run.approval_response', run_id: 'run-1', choice: 'once', resolved: 1 });
      }
      if (url.endsWith('/stop')) return jsonResponse({ run_id: 'run-1', status: 'stopping' });
      throw new Error(`Unexpected test URL: ${url}`);
    });
    const client = new HermesApiClient(
      'https://hermes.example', 'top-secret-token', fetcher as typeof fetch,
    );
    await expect(client.admit()).resolves.toEqual({ version: '0.9.0', model: 'hermes-agent' });
    await expect(client.listSessions()).resolves.toEqual([
      { id: 'session-1', label: 'Desky', updatedAt: undefined },
    ]);
    await expect(client.createSession('New')).resolves.toMatchObject({ id: 'session-2', label: 'New' });
    await expect(client.startRun('session-1', 'Hello')).resolves.toBe('run-1');
    await client.resolveApproval('run-1', 'once');
    await client.stopRun('run-1');
    expect(requests.every((request) => new Headers(request.init?.headers).get('Authorization')
      === 'Bearer top-secret-token')).toBe(true);
    expect(requests.find((request) => request.url.endsWith('/v1/runs'))?.init?.body)
      .toBe(JSON.stringify({ input: 'Hello', session_id: 'session-1' }));
  });

  it('decodes fragmented SSE, ignores comments, and rejects oversized frames', () => {
    const decoder = new HermesSseDecoder();
    expect(decoder.push(': keepalive\n\ndata: {"event":"message.')).toEqual([]);
    expect(decoder.push('delta","run_id":"run-1","delta":"Hi"}\n\n')).toEqual([
      { event: 'message.delta', run_id: 'run-1', delta: 'Hi' },
    ]);
    decoder.finish();
    expect(() => new HermesSseDecoder().push(`data: ${'x'.repeat(300_000)}`))
      .toThrow('oversized SSE frame');
  });

  it('streams typed events from the response body', async () => {
    const fetcher = vi.fn(async () => new Response(
      ': keepalive\n\ndata: {"event":"message.delta","run_id":"run-1","delta":"Hi"}\n\n'
      + 'data: {"event":"run.completed","run_id":"run-1","output":"Hi"}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    ));
    const client = new HermesApiClient(
      'https://hermes.example', 'token', fetcher as typeof fetch,
    );
    const events: unknown[] = [];
    await client.streamRun('run-1', (event) => events.push(event), new AbortController().signal);
    expect(events).toEqual([
      { event: 'message.delta', run_id: 'run-1', delta: 'Hi' },
      { event: 'run.completed', run_id: 'run-1', output: 'Hi' },
    ]);
  });

  it('classifies only transport and retryable HTTP failures for reconnect', async () => {
    const unavailable = new HermesApiClient(
      'https://hermes.example', 'token', vi.fn(async () => {
        throw new TypeError('connection reset with token=private');
      }) as typeof fetch,
    );
    const networkError = await unavailable.listSessions().catch((error: unknown) => error);
    expect(networkError).toEqual(new HermesApiError('Hermes transport is unavailable.', true));
    expect(isHermesReconnectableError(networkError)).toBe(true);
    expect(String(networkError)).not.toContain('private');

    const certificateCause = Object.assign(new Error('self signed private-certificate'), {
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
    const invalidCertificate = new HermesApiClient(
      'https://hermes.example', 'token', vi.fn(async () => {
        throw new TypeError('fetch failed', { cause: certificateCause });
      }) as typeof fetch,
    );
    const certificateError = await invalidCertificate.listSessions().catch(
      (error: unknown) => error,
    );
    expect(certificateError).toEqual(
      new HermesApiError('Hermes TLS certificate validation failed.', false),
    );
    expect(isHermesReconnectableError(certificateError)).toBe(false);
    expect(String(certificateError)).not.toContain('private-certificate');

    for (const [status, reconnectable] of [[503, true], [401, false]] as const) {
      const client = new HermesApiClient(
        'https://hermes.example', 'token',
        vi.fn(async () => jsonResponse({ error: 'nope' }, status)) as typeof fetch,
      );
      const error = await client.listSessions().catch((caught: unknown) => caught);
      expect(isHermesReconnectableError(error)).toBe(reconnectable);
    }

    const malformed = new HermesApiClient(
      'https://hermes.example', 'token',
      vi.fn(async () => new Response('{broken', { status: 200 })) as typeof fetch,
    );
    const protocolError = await malformed.listSessions().catch((error: unknown) => error);
    expect(isHermesReconnectableError(protocolError)).toBe(false);
  });
});
