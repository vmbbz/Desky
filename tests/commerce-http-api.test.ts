import { describe, expect, it, vi } from 'vitest';

import {
  CommerceHttpApi,
  CommerceServiceError,
  type CommerceCheckoutApplicationService,
  type CommerceSessionApplicationService,
} from '../src/service/commerce/http-api';
import type { CommerceSessionMaterial } from '../src/shared/commerce-recovery';

const now = 1_787_600_000;

function material(): CommerceSessionMaterial {
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
      grants: [],
      pendingOrderIds: [],
      revokedGrantIds: [],
    },
  };
}

function service(): CommerceSessionApplicationService {
  return {
    restoreCleanDevice: vi.fn(async () => material()),
    refreshSession: vi.fn(async () => material()),
  };
}

function checkoutService(): CommerceCheckoutApplicationService {
  const session = {
    schemaVersion: 1 as const,
    checkoutSessionId: 'checkout:1', approvalId: 'approval:1', accountId: 'account:1',
    installationId: 'install:1', orderId: 'order:1', quoteId: 'quote:1',
    checkoutUrl: 'https://commerce.desky.example/checkout/checkout%3A1',
    createdAt: '2026-08-25T10:00:00.000Z', expiresAt: '2026-08-25T10:02:00.000Z',
    state: 'ready' as const,
  };
  return {
    createSession: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
    cancelSession: vi.fn(async () => ({ ...session, state: 'cancelled' as const })),
  };
}

describe('hosted commerce HTTP boundary', () => {
  it('parses the fixed clean-device route and emits non-cacheable exact JSON', async () => {
    const sessions = service();
    const api = new CommerceHttpApi(sessions);
    const result = await api.handle({
      method: 'POST',
      path: '/v1/session/restore',
      contentType: 'application/json',
      correlationId: 'correlation:1',
      body: JSON.stringify({
        schemaVersion: 1,
        installationId: 'install:1',
        recoveryCode: 'c'.repeat(43),
        proofKeyVerifier: 'p'.repeat(43),
        idempotencyKey: 'restore:1',
      }),
    });
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(sessions.restoreCleanDevice).toHaveBeenCalledWith(expect.objectContaining({
      installationId: 'install:1',
    }));
  });

  it('rejects unknown routes, content types, oversized input, and unknown request fields', async () => {
    const api = new CommerceHttpApi(service());
    const base = {
      method: 'POST',
      path: '/v1/session/restore',
      contentType: 'application/json',
      correlationId: 'correlation:1',
      body: '{}',
    };
    expect((await api.handle({ ...base, path: '/v1/admin' })).status).toBe(404);
    expect((await api.handle({ ...base, contentType: 'text/plain' })).status).toBe(415);
    expect((await api.handle({ ...base, body: 'x'.repeat(16 * 1_024 + 1) })).status).toBe(400);
    const unknown = await api.handle({
      ...base,
      body: JSON.stringify({
        schemaVersion: 1,
        installationId: 'install:1',
        recoveryCode: 'c'.repeat(43),
        proofKeyVerifier: 'p'.repeat(43),
        idempotencyKey: 'restore:1',
        wallet: 'no',
      }),
    });
    expect(unknown.status).toBe(400);
  });

  it('maps typed failures without leaking internal error messages', async () => {
    const sessions = service();
    sessions.restoreCleanDevice = vi.fn(async () => {
      throw new CommerceServiceError('authentication-failed');
    });
    const api = new CommerceHttpApi(sessions);
    const result = await api.handle({
      method: 'POST',
      path: '/v1/session/restore',
      contentType: 'application/json',
      correlationId: 'correlation:1',
      body: JSON.stringify({
        schemaVersion: 1,
        installationId: 'install:1',
        recoveryCode: 'c'.repeat(43),
        proofKeyVerifier: 'p'.repeat(43),
        idempotencyKey: 'restore:1',
      }),
    });
    expect(result.status).toBe(401);
    expect(result.body).toBe(JSON.stringify({
      schemaVersion: 1,
      error: 'authentication-failed',
      correlationId: 'correlation:1',
    }));
  });

  it('reports unclassified failures without changing the fail-closed response', async () => {
    const sessions = service();
    const failure = new Error('database transition failed');
    sessions.restoreCleanDevice = vi.fn(async () => { throw failure; });
    const reporter = vi.fn();
    const api = new CommerceHttpApi(sessions, undefined, reporter);
    const result = await api.handle({
      method: 'POST',
      path: '/v1/session/restore',
      contentType: 'application/json',
      correlationId: 'correlation:internal',
      body: JSON.stringify({
        schemaVersion: 1,
        installationId: 'install:1',
        recoveryCode: 'c'.repeat(43),
        proofKeyVerifier: 'p'.repeat(43),
        idempotencyKey: 'restore:1',
      }),
    });
    expect(result.status).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      schemaVersion: 1, error: 'internal-error', correlationId: 'correlation:internal',
    });
    expect(reporter).toHaveBeenCalledWith(failure, {
      path: '/v1/session/restore', correlationId: 'correlation:internal',
    });
  });

  it('keeps checkout routes absent unless injected and then requires bearer authentication', async () => {
    const request = {
      method: 'POST', path: '/v1/checkout/session/status', contentType: 'application/json',
      correlationId: 'correlation:1',
      body: JSON.stringify({
        schemaVersion: 1, checkoutSessionId: 'checkout:1', installationId: 'install:1',
      }),
    };
    expect((await new CommerceHttpApi(service()).handle(request)).status).toBe(404);
    const checkouts = checkoutService();
    const api = new CommerceHttpApi(service(), checkouts);
    expect((await api.handle(request)).status).toBe(401);
    expect((await api.handle({ ...request, authorization: `Bearer ${'t'.repeat(32)}` })).status)
      .toBe(200);
    expect(checkouts.getSession).toHaveBeenCalledWith(expect.objectContaining({
      checkoutSessionId: 'checkout:1',
    }), 't'.repeat(32));
  });

  it('strictly parses checkout payloads and rejects authorization header injection', async () => {
    const api = new CommerceHttpApi(service(), checkoutService());
    const base = {
      method: 'POST', path: '/v1/checkout/session/status', contentType: 'application/json',
      correlationId: 'correlation:1', authorization: `Bearer ${'t'.repeat(32)}`,
      body: JSON.stringify({
        schemaVersion: 1, checkoutSessionId: 'checkout:1', installationId: 'install:1',
        walletSecret: 'never',
      }),
    };
    expect((await api.handle(base)).status).toBe(400);
    expect((await api.handle({
      ...base,
      authorization: `Bearer ${'t'.repeat(32)}\r\nInjected: yes`,
      body: JSON.stringify({
        schemaVersion: 1, checkoutSessionId: 'checkout:1', installationId: 'install:1',
      }),
    })).status).toBe(401);
  });

  it('classifies an overlong checkout approval as invalid input', async () => {
    const api = new CommerceHttpApi(service(), checkoutService());
    const result = await api.handle({
      method: 'POST', path: '/v1/checkout/session', contentType: 'application/json',
      correlationId: 'correlation:lifetime', authorization: `Bearer ${'t'.repeat(32)}`,
      body: JSON.stringify({
        schemaVersion: 1,
        approvalId: 'approval:1', accountId: 'account:1', installationId: 'install:1',
        orderId: 'order:1', quoteId: 'quote:1', termsDigest: 'd'.repeat(43),
        approvedAt: '2026-08-25T10:00:00.000Z',
        approvalExpiresAt: '2026-08-25T10:02:00.001Z',
        idempotencyKey: 'checkout:1', browserBindingChallenge: 'b'.repeat(43),
      }),
    });
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      schemaVersion: 1, error: 'invalid-request', correlationId: 'correlation:lifetime',
    });
  });
});
