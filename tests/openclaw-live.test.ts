import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AdapterEvent } from '../src/shared/adapter-events';
import { OpenClawGatewayClient } from '../src/main/openclaw/gateway-client';
import { OpenClawAdapterHost } from '../src/main/openclaw/host';
import { generateDeviceIdentity } from '../src/main/openclaw/protocol';
import { SecureVault, type EncryptionProvider } from '../src/main/openclaw/secure-vault';

const liveEnabled = process.env.DESKY_OPENCLAW_LIVE === '1'
  || process.env.npm_lifecycle_event === 'test:openclaw:live';
const gatewayUrl = process.env.DESKY_OPENCLAW_LIVE_URL ?? 'ws://127.0.0.1:19001';
const credential = process.env.DESKY_OPENCLAW_LIVE_CREDENTIAL;

const liveEncryption: EncryptionProvider = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`live:${value}`),
  decryptString: (value) => value.toString().replace(/^live:/, ''),
};

function waitForEvent(
  host: OpenClawAdapterHost,
  predicate: (event: AdapterEvent) => boolean,
  timeoutMs: number,
): Promise<AdapterEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for a live OpenClaw event.'));
    }, timeoutMs);
    const unsubscribe = host.onEvent((event) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

describe.runIf(liveEnabled)('OpenClaw live Gateway', () => {
  it('covers capabilities, approvals, cancellation, reconnect, and streaming', async () => {
    expect(credential, 'DESKY_OPENCLAW_LIVE_CREDENTIAL is required for live verification').toBeTruthy();
    const directory = mkdtempSync(join(tmpdir(), 'desky-openclaw-live-'));
    const host = new OpenClawAdapterHost(
      new SecureVault(join(directory, 'vault.json'), liveEncryption),
      '0.1.0-live-verification',
      process.platform,
    );
    const requester = new OpenClawGatewayClient({
      url: gatewayUrl,
      appVersion: '0.1.0-live-verification',
      platform: process.platform,
      identity: generateDeviceIdentity(),
      authKind: 'token',
      credential,
      onEvent: () => undefined,
      onClose: () => undefined,
    });
    const events: AdapterEvent[] = [];
    host.onEvent((event) => events.push(event));

    try {
      const connected = await host.connect({
        gatewayUrl,
        authKind: 'token',
        credential,
        rememberCredential: false,
      });
      expect(connected).toMatchObject({ status: 'connected', reconnectAttempt: 0 });
      const created = await host.createSession({ label: `Desky live verification ${new Date().toISOString()}` });
      const sessionKey = created.selectedSessionKey;
      expect(sessionKey).toBeTruthy();

      const hello = await requester.connect();
      expect(hello.protocol).toBe(4);
      expect(hello.auth.scopes).toEqual(expect.arrayContaining([
        'operator.read',
        'operator.write',
        'operator.approvals',
      ]));
      expect(hello.features.methods).toEqual(expect.arrayContaining([
        'sessions.list',
        'sessions.create',
        'sessions.messages.subscribe',
        'chat.send',
        'sessions.abort',
        'approval.resolve',
      ]));
      process.stdout.write(`[desky-live] OpenClaw ${hello.server.version}: protocol capabilities passed\n`);

      const approvalId = `desky-live-${randomUUID()}`;
      const approvalEvent = waitForEvent(
        host,
        (event) => event.type === 'approval.requested' && event.payload.requestId === approvalId,
        20_000,
      );
      await expect(requester.request('exec.approval.request', {
        id: approvalId,
        command: 'Write-Output DESKY_APPROVAL_PROBE',
        host: 'local',
        ask: 'always',
        sessionKey,
        twoPhase: true,
        requireDeliveryRoute: false,
        timeoutMs: 60_000,
      })).resolves.toMatchObject({ status: 'accepted', id: approvalId });
      const requested = await approvalEvent;
      expect(requested.type).toBe('approval.requested');
      if (requested.type !== 'approval.requested') throw new Error('Expected approval request.');
      expect(requested.payload.safeTarget).toContain('DESKY_APPROVAL_PROBE');
      await host.resolveApproval({ requestId: approvalId, kind: 'exec', decision: 'deny' });
      await expect(requester.request('approval.get', { id: approvalId })).resolves.toMatchObject({
        approval: { id: approvalId, status: 'denied', decision: 'deny' },
      });
      await host.resolveApproval({ requestId: approvalId, kind: 'exec', decision: 'deny' });
      expect(host.getState().message).toBe('Approval already denied in OpenClaw');

      const allowedApprovalId = `desky-live-${randomUUID()}`;
      const allowedApprovalEvent = waitForEvent(
        host,
        (event) => event.type === 'approval.requested' && event.payload.requestId === allowedApprovalId,
        20_000,
      );
      await expect(requester.request('exec.approval.request', {
        id: allowedApprovalId,
        command: 'Write-Output DESKY_APPROVAL_ALLOW_ONCE_PROBE',
        host: 'local',
        ask: 'always',
        sessionKey,
        twoPhase: true,
        requireDeliveryRoute: false,
        timeoutMs: 60_000,
      })).resolves.toMatchObject({ status: 'accepted', id: allowedApprovalId });
      await allowedApprovalEvent;
      await host.resolveApproval({ requestId: allowedApprovalId, kind: 'exec', decision: 'allow-once' });
      await expect(requester.request('approval.get', { id: allowedApprovalId })).resolves.toMatchObject({
        approval: { id: allowedApprovalId, status: 'allowed', decision: 'allow-once' },
      });
      process.stdout.write('[desky-live] approval deny, allow-once, and duplicate acknowledgement passed\n');

      const cancelledTerminal = waitForEvent(
        host,
        (event) => event.type === 'turn.completed' || event.type === 'turn.failed',
        30_000,
      );
      await host.send('This live verification turn should be cancelled immediately.');
      await host.cancel();
      const cancelled = await cancelledTerminal;
      expect(cancelled.type).toBe('turn.failed');
      if (cancelled.type !== 'turn.failed') throw new Error('Expected cancelled turn to fail.');
      expect(cancelled.payload.safeError.toLowerCase()).toContain('cancel');
      process.stdout.write('[desky-live] cancellation passed\n');

      await host.disconnect();
      const reconnected = await host.connect({
        gatewayUrl,
        authKind: 'token',
        credential,
        rememberCredential: false,
      });
      expect(reconnected).toMatchObject({ status: 'connected', selectedSessionKey: sessionKey });
      process.stdout.write('[desky-live] reconnect and session resubscription passed\n');

      const streamedTerminal = waitForEvent(
        host,
        (event) => event.type === 'turn.completed' || event.type === 'turn.failed',
        120_000,
      );
      const streamStart = events.length;
      await host.send('Reply with exactly DESKY_LIVE_OK and no other text.');
      const streamed = await streamedTerminal;
      const terminalFailure = streamed.type === 'turn.failed' ? streamed.payload.safeError : undefined;
      expect(streamed.type, `OpenClaw ${hello.server.version}: ${terminalFailure ?? 'unexpected terminal'}`).toBe('turn.completed');
      const streamedText = events
        .slice(streamStart)
        .filter((event) => event.type === 'assistant.delta')
        .map((event) => event.payload.text)
        .join('');
      expect(streamedText).toContain('DESKY_LIVE_OK');
    } finally {
      requester.close('Desky live verification complete');
      await host.disconnect();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 210_000);
});
