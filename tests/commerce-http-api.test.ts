import { describe, expect, it, vi } from 'vitest';

import {
  CommerceHttpApi,
  CommerceServiceError,
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
});
