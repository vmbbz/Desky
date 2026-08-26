import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

import { HermesApiClient, isHermesReconnectableError } from '../src/main/hermes/api-client';
import { OpenClawGatewayClient } from '../src/main/openclaw/gateway-client';
import { generateDeviceIdentity } from '../src/main/openclaw/protocol';
import { isTerminalSecureTransportError } from '../src/main/secure-transport';

const certificatePath = process.env.DESKY_REMOTE_TLS_TEST_CERT;
const privateKeyPath = process.env.DESKY_REMOTE_TLS_TEST_KEY;

describe.runIf(Boolean(certificatePath && privateKeyPath))('real remote TLS rejection matrix', () => {
  let server: Server;
  let websocketServer: WebSocketServer;
  let port = 0;

  beforeAll(async () => {
    server = createServer({
      cert: readFileSync(certificatePath!),
      key: readFileSync(privateKeyPath!),
    }, (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"sessions":[]}');
    });
    websocketServer = new WebSocketServer({ server });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (typeof address === 'string' || address === null) throw new Error('Expected TLS test port.');
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => websocketServer.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects a real untrusted HTTPS ingress as terminal for Hermes', async () => {
    const client = new HermesApiClient(`https://localhost:${port}`, 'fixture-token');
    const error = await client.listSessions().catch((caught: unknown) => caught);
    expect(isHermesReconnectableError(error)).toBe(false);
    expect(String(error)).toContain('TLS certificate is not trusted');
    expect(String(error)).not.toContain(certificatePath!);
  });

  it('rejects a real untrusted wss gateway as terminal for OpenClaw', async () => {
    const client = new OpenClawGatewayClient({
      url: `wss://localhost:${port}`,
      appVersion: '0.1.0',
      platform: 'win32',
      identity: generateDeviceIdentity(),
      authKind: 'token',
      credential: 'fixture-token',
      onEvent: () => undefined,
      onClose: () => undefined,
    });
    const error = await client.connect().catch((caught: unknown) => caught);
    expect(isTerminalSecureTransportError(error)).toBe(true);
    expect(String(error)).toContain('TLS certificate is not trusted');
    expect(String(error)).not.toContain(certificatePath!);
  });
});
