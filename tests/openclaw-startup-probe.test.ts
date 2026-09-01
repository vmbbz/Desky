import { describe, expect, it, vi } from 'vitest';

import {
  openClawStartupProbeUrl,
  probeOpenClawGatewayStartup,
} from '../src/main/openclaw/startup-probe';

describe('OpenClaw Gateway startup probe', () => {
  it('derives the same-origin HTTP endpoint without retaining path or query material', () => {
    expect(openClawStartupProbeUrl('ws://127.0.0.1:18789/gateway?ignored=yes')).toBe(
      'http://127.0.0.1:18789/startupz',
    );
    expect(openClawStartupProbeUrl('wss://agent.example.test/socket')).toBe(
      'https://agent.example.test/startupz',
    );
  });

  it.each([
    [{ ok: true, status: 'started' }, { status: 'started' }],
    [{ ok: false, status: 'draining' }, { status: 'draining' }],
    [
      { ok: false, status: 'starting', pendingReason: 'startup-sidecars' },
      { status: 'starting', pendingReason: 'startup-sidecars' },
    ],
  ] as const)('admits only the bounded startup contract %#', async (body, expected) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), {
      status: body.status === 'started' ? 200 : 503,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(probeOpenClawGatewayStartup('ws://127.0.0.1:18789', {
      fetchImpl,
    })).resolves.toEqual(expected);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:18789/startupz', expect.objectContaining({
      method: 'GET',
      credentials: 'omit',
      redirect: 'manual',
    }));
  });

  it('keeps an older or unavailable probe compatibility-neutral', async () => {
    const unavailable = vi.fn(async () => { throw new Error('connection refused'); });
    const oversized = vi.fn(async () => new Response('x', {
      status: 200,
      headers: { 'content-length': '9000' },
    }));
    const redirected = vi.fn(async () => new Response('', {
      status: 302,
      headers: { location: 'https://other.example.test/startupz' },
    }));

    await expect(probeOpenClawGatewayStartup('ws://127.0.0.1:18789', {
      fetchImpl: unavailable,
    })).resolves.toEqual({ status: 'unknown' });
    await expect(probeOpenClawGatewayStartup('ws://127.0.0.1:18789', {
      fetchImpl: oversized,
    })).resolves.toEqual({ status: 'unknown' });
    await expect(probeOpenClawGatewayStartup('ws://127.0.0.1:18789', {
      fetchImpl: redirected,
    })).resolves.toEqual({ status: 'unknown' });
  });
});
