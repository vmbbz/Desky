import { describe, expect, it } from 'vitest';

import {
  parseCleanDeviceRestoreRequest,
  parseCommerceSessionMaterial,
  parseCommerceSessionRefreshRequest,
} from '../src/shared/commerce-recovery';
import {
  CommerceServiceClient,
  type CommerceApiRequest,
  type CommerceApiResponse,
  type CommerceApiTransport,
} from '../src/main/commerce/service-client';

const now = 1_787_600_000;

function sessionMaterial(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    accountId: 'account:1',
    sessionId: 'session:1',
    installationId: 'install:1',
    refreshCredential: 'r'.repeat(43),
    refreshGeneration: 1,
    refreshExpiresAt: new Date((now + 86_400) * 1_000).toISOString(),
    accessToken: 'a'.repeat(32),
    offlineLease: 'l'.repeat(32),
    serverTimeSeconds: now,
    reconciliation: {
      schemaVersion: 1,
      snapshotId: 'snapshot:1',
      accountId: 'account:1',
      generatedAt: new Date(now * 1_000).toISOString(),
      cursor: 'cursor:1',
      grants: [{
        schemaVersion: 1,
        grantId: 'grant:1',
        accountId: 'account:1',
        productId: 'avatar:banana',
        productRevision: 1,
        avatarRevisionIds: ['banana:revision:1'],
        entitlementEventId: 'event:1',
        catalogVersion: 'catalog:1',
        state: 'active',
        issuedAt: new Date(now * 1_000).toISOString(),
      }],
      pendingOrderIds: ['order:1'],
      revokedGrantIds: [],
    },
  };
}

class StubTransport implements CommerceApiTransport {
  requestSeen?: CommerceApiRequest;

  constructor(private readonly response: (request: CommerceApiRequest) => CommerceApiResponse) {}

  async request(input: CommerceApiRequest): Promise<CommerceApiResponse> {
    this.requestSeen = input;
    return this.response(input);
  }
}

describe('commerce recovery contracts', () => {
  it('parses exact clean-device and rotating-refresh requests', () => {
    expect(parseCleanDeviceRestoreRequest({
      schemaVersion: 1,
      installationId: 'install:1',
      recoveryCode: 'c'.repeat(43),
      proofKeyVerifier: 'p'.repeat(43),
      idempotencyKey: 'restore:1',
    }).installationId).toBe('install:1');
    expect(parseCommerceSessionRefreshRequest({
      schemaVersion: 1,
      sessionId: 'session:1',
      installationId: 'install:1',
      refreshCredential: 'r'.repeat(43),
      refreshGeneration: 2,
      rotationId: 'rotate:session:1:2',
      reconciliationCursor: 'cursor:1',
    }).refreshGeneration).toBe(2);
  });

  it('parses a consistent reconciliation snapshot and rejects cross-account or contradictory grants', () => {
    expect(parseCommerceSessionMaterial(sessionMaterial()).reconciliation.grants).toHaveLength(1);
    const crossAccount = sessionMaterial();
    const reconciliation = crossAccount.reconciliation as Record<string, unknown>;
    reconciliation.accountId = 'account:other';
    expect(() => parseCommerceSessionMaterial(crossAccount)).toThrow('reconciliation grants');

    const contradictory = sessionMaterial();
    const snapshot = contradictory.reconciliation as Record<string, unknown>;
    snapshot.revokedGrantIds = ['grant:1'];
    expect(() => parseCommerceSessionMaterial(contradictory)).toThrow('contradictory');
  });

  it('rejects unknown fields, short secrets, and expired refresh material', () => {
    expect(() => parseCleanDeviceRestoreRequest({
      schemaVersion: 1,
      installationId: 'install:1',
      recoveryCode: 'short',
      proofKeyVerifier: 'p'.repeat(43),
      idempotencyKey: 'restore:1',
    })).toThrow('recovery code');
    expect(() => parseCommerceSessionMaterial({ ...sessionMaterial(), wallet: 'secret' }))
      .toThrow('session material');
    expect(() => parseCommerceSessionMaterial({
      ...sessionMaterial(),
      refreshExpiresAt: new Date(now * 1_000).toISOString(),
    })).toThrow('consistency');
  });
});

describe('commerce service client', () => {
  it('posts only to the fixed restore endpoint and strictly parses the response', async () => {
    const transport = new StubTransport((request) => ({
      status: 200,
      finalUrl: request.url,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(sessionMaterial()),
    }));
    const client = new CommerceServiceClient({
      serviceOrigin: 'https://commerce.desky.example',
      transport,
    });
    const result = await client.restoreCleanDevice({
      schemaVersion: 1,
      installationId: 'install:1',
      recoveryCode: 'c'.repeat(43),
      proofKeyVerifier: 'p'.repeat(43),
      idempotencyKey: 'restore:1',
    });
    expect(result.accountId).toBe('account:1');
    expect(transport.requestSeen).toMatchObject({
      url: 'https://commerce.desky.example/v1/session/restore',
      method: 'POST',
    });
    expect(transport.requestSeen?.headers).toMatchObject({
      'cache-control': 'no-store',
      'x-desky-api-version': '1',
    });
  });

  it('rejects insecure origins, redirects, wrong content types, and oversized bodies', async () => {
    expect(() => new CommerceServiceClient({ serviceOrigin: 'http://commerce.desky.example' }))
      .toThrow('HTTPS origin');
    const request = {
      schemaVersion: 1 as const,
      installationId: 'install:1',
      recoveryCode: 'c'.repeat(43),
      proofKeyVerifier: 'p'.repeat(43),
      idempotencyKey: 'restore:1',
    };
    const redirected = new CommerceServiceClient({
      serviceOrigin: 'https://commerce.desky.example',
      transport: new StubTransport(() => ({
        status: 200,
        finalUrl: 'https://attacker.example/response',
        contentType: 'application/json',
        body: JSON.stringify(sessionMaterial()),
      })),
    });
    await expect(redirected.restoreCleanDevice(request)).rejects.toThrow('URL mismatch');
    const html = new CommerceServiceClient({
      serviceOrigin: 'https://commerce.desky.example',
      transport: new StubTransport((input) => ({
        status: 200,
        finalUrl: input.url,
        contentType: 'text/html',
        body: '{}',
      })),
    });
    await expect(html.restoreCleanDevice(request)).rejects.toThrow('content type');
    const oversized = new CommerceServiceClient({
      serviceOrigin: 'https://commerce.desky.example',
      maximumResponseBytes: 1_024,
      transport: new StubTransport((input) => ({
        status: 200,
        finalUrl: input.url,
        contentType: 'application/json',
        body: 'x'.repeat(1_025),
      })),
    });
    await expect(oversized.restoreCleanDevice(request)).rejects.toThrow('size');
  });
});
