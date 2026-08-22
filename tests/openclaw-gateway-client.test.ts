import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

import { OpenClawGatewayClient } from '../src/main/openclaw/gateway-client';
import { generateDeviceIdentity } from '../src/main/openclaw/protocol';

const servers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('OpenClawGatewayClient', () => {
  it('negotiates v4, authenticates, correlates requests, and reports sequence gaps', async () => {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    await once(server, 'listening');
    const address = server.address();
    if (typeof address === 'string' || address === null) throw new Error('Expected TCP test address.');
    const seenMethods: string[] = [];

    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'fixture-nonce', ts: Date.now() } }));
      socket.on('message', (raw) => {
        const request = JSON.parse(raw.toString()) as { id: string; method: string; params: Record<string, unknown> };
        seenMethods.push(request.method);
        if (request.method === 'connect') {
          expect(request.params).toMatchObject({
            minProtocol: 4,
            maxProtocol: 4,
            role: 'operator',
            scopes: ['operator.read', 'operator.write', 'operator.approvals'],
            auth: { token: 'fixture-token' },
          });
          socket.send(JSON.stringify({
            type: 'res', id: request.id, ok: true, payload: {
              type: 'hello-ok', protocol: 4,
              server: { version: '2026.8.22', connId: 'fixture-connection' },
              features: { methods: ['sessions.list'], events: ['chat'] },
              auth: { deviceToken: 'paired-token', role: 'operator', scopes: ['operator.read'] },
              policy: { maxPayload: 1_048_576, maxBufferedBytes: 1_048_576, tickIntervalMs: 30_000 },
            },
          }));
          return;
        }
        socket.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { sessions: [] } }));
        socket.send(JSON.stringify({ type: 'event', event: 'chat', seq: 1, payload: { state: 'status' } }));
        socket.send(JSON.stringify({ type: 'event', event: 'chat', seq: 3, payload: { state: 'status' } }));
      });
    });

    const gaps: Array<[number, number]> = [];
    const client = new OpenClawGatewayClient({
      url: `ws://127.0.0.1:${address.port}`,
      appVersion: '0.1.0',
      platform: 'win32',
      identity: generateDeviceIdentity(),
      authKind: 'token',
      credential: 'fixture-token',
      onEvent: () => undefined,
      onClose: () => undefined,
      onSequenceGap: (expected, received) => gaps.push([expected, received]),
    });
    const hello = await client.connect();
    expect(hello.server.connId).toBe('fixture-connection');
    await expect(client.request('sessions.list', {})).resolves.toEqual({ sessions: [] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seenMethods).toEqual(['connect', 'sessions.list']);
    expect(gaps).toEqual([[2, 3]]);
    client.close();
  });
});
