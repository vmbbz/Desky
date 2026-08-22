import { createPublicKey, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildDeviceAuthPayload,
  generateDeviceIdentity,
  normalizeGatewayUrl,
  normalizeOpenClawEvent,
  publicKeyRawBase64Url,
  signDeviceAuth,
} from '../src/main/openclaw/protocol';

describe('OpenClaw protocol v4 boundary', () => {
  it('allows loopback ws and requires TLS remotely', () => {
    expect(normalizeGatewayUrl('ws://127.0.0.1:18789').insecureLoopback).toBe(true);
    expect(normalizeGatewayUrl('wss://gateway.example.com/socket').scope)
      .toBe('wss://gateway.example.com/socket');
    expect(() => normalizeGatewayUrl('ws://gateway.example.com')).toThrow(/wss/);
    expect(() => normalizeGatewayUrl('wss://token@gateway.example.com')).toThrow(/credentials/);
    expect(() => normalizeGatewayUrl('wss://gateway.example.com?token=secret')).toThrow(/query/);
  });

  it('builds and signs the exact challenge-bound v3 device payload used by protocol v4', () => {
    const identity = generateDeviceIdentity();
    const payload = buildDeviceAuthPayload({
      identity,
      nonce: 'challenge-1',
      signedAt: 1_777_777_777_777,
      signatureToken: 'bootstrap-secret',
      platform: 'Win32',
    });
    expect(payload).toBe([
      'v3', identity.deviceId, 'gateway-client', 'backend', 'operator',
      'operator.read,operator.write,operator.approvals', '1777777777777',
      'bootstrap-secret', 'challenge-1', 'win32', 'desktop',
    ].join('|'));
    const signature = signDeviceAuth(identity, payload);
    const publicKey = createPublicKey({
      format: 'jwk',
      key: { kty: 'OKP', crv: 'Ed25519', x: publicKeyRawBase64Url(identity.publicKeyPem) },
    });
    expect(verify(null, Buffer.from(payload), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('normalizes streams and redacts filesystem paths', () => {
    const events = normalizeOpenClawEvent('connection-1', 'agent', {
      sessionKey: 'session-1',
      runId: 'run-1',
      stream: 'tool',
      data: { phase: 'start', name: 'shell', summary: 'Reading C:\\private\\secret.txt' },
    });
    expect(events[0]).toMatchObject({
      protocolVersion: 1,
      type: 'tool.started',
      sessionId: 'session-1',
      turnId: 'run-1',
    });
    expect(JSON.stringify(events)).not.toContain('secret.txt');

    expect(normalizeOpenClawEvent('connection-1', 'chat', {
      sessionKey: 'session-1', runId: 'run-1', seq: 2, state: 'delta', deltaText: 'Hello',
    })[0]).toMatchObject({ type: 'assistant.delta', payload: { text: 'Hello' } });
  });

  it('marks a native abort as cancellation rather than an operational error', () => {
    expect(normalizeOpenClawEvent('connection-1', 'chat', {
      sessionKey: 'session-1', runId: 'run-1', state: 'aborted',
    })[0]).toMatchObject({
      type: 'turn.failed',
      payload: { safeError: 'Turn cancelled', kind: 'cancelled' },
    });
    expect(normalizeOpenClawEvent('connection-1', 'chat', {
      sessionKey: 'session-1', runId: 'run-2', state: 'error', errorMessage: 'Provider unavailable',
    })[0]).toMatchObject({
      type: 'turn.failed',
      payload: { safeError: 'Provider unavailable', kind: 'error' },
    });
  });

  it('preserves only reviewer-safe approval fields and always offers deny', () => {
    const [event] = normalizeOpenClawEvent('connection-1', 'session.approval', {
      sessionKey: 'session-1',
      phase: 'pending',
      approval: {
        id: 'approval-1',
        presentation: {
          kind: 'plugin',
          title: 'Publish update',
          description: 'Post the prepared update',
          allowedDecisions: ['allow-once'],
          environment: { SECRET: 'must-not-cross-ipc' },
        },
      },
    });
    expect(event).toMatchObject({
      type: 'approval.requested',
      payload: {
        requestId: 'approval-1',
        kind: 'plugin',
        allowedDecisions: ['allow-once', 'deny'],
      },
    });
    expect(JSON.stringify(event)).not.toContain('must-not-cross-ipc');
  });

  it('normalizes only well-formed terminal approval states', () => {
    expect(normalizeOpenClawEvent('connection-1', 'session.approval', {
      sessionKey: 'session-1',
      phase: 'terminal',
      approval: { id: 'approval-1', status: 'expired', environment: { SECRET: 'hidden' } },
    })[0]).toMatchObject({
      type: 'approval.resolved',
      sessionId: 'session-1',
      payload: { requestId: 'approval-1', status: 'expired' },
    });
    expect(normalizeOpenClawEvent('connection-1', 'session.approval', {
      sessionKey: 'session-1', phase: 'terminal', approval: { id: 'approval-1', status: 'unknown' },
    })).toEqual([]);
  });
});
