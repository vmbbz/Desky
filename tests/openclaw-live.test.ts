import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';

import type { AdapterEvent } from '../src/shared/adapter-events';
import type { AgentActionCommand } from '../src/shared/agent-actions';
import type { OpenClawConnectionState } from '../src/shared/openclaw';
import { OpenClawGatewayClient } from '../src/main/openclaw/gateway-client';
import { OpenClawAdapterHost } from '../src/main/openclaw/host';
import { generateDeviceIdentity } from '../src/main/openclaw/protocol';
import { SecureVault, type EncryptionProvider } from '../src/main/openclaw/secure-vault';

const liveEnabled = process.env.DESKY_OPENCLAW_LIVE === '1'
  || process.env.npm_lifecycle_event === 'test:openclaw:live';
const gatewayUrl = process.env.DESKY_OPENCLAW_LIVE_URL ?? 'ws://127.0.0.1:19001';
const credential = process.env.DESKY_OPENCLAW_LIVE_CREDENTIAL;
const requestedLiveAction = process.env.DESKY_OPENCLAW_LIVE_ACTION ?? 'jump';
const liveAction = requestedLiveAction === 'wave' || requestedLiveAction === 'jump'
  ? requestedLiveAction
  : undefined;

const liveEncryption: EncryptionProvider = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`live:${value}`),
  decryptString: (value) => value.toString().replace(/^live:/, ''),
};

class LiveGatewayRelay {
  private readonly server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  private readonly pairs = new Set<{ downstream: WebSocket; upstream: WebSocket }>();

  constructor(private readonly upstreamUrl: string) {
    this.server.on('connection', (downstream) => {
      const upstream = new WebSocket(this.upstreamUrl, { perMessageDeflate: false });
      const pair = { downstream, upstream };
      this.pairs.add(pair);
      downstream.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      });
      upstream.on('message', (data, isBinary) => {
        if (downstream.readyState === WebSocket.OPEN) downstream.send(data, { binary: isBinary });
      });
      downstream.on('close', () => {
        this.pairs.delete(pair);
        if (upstream.readyState < WebSocket.CLOSING) upstream.close();
      });
      upstream.on('close', () => {
        this.pairs.delete(pair);
        if (downstream.readyState < WebSocket.CLOSING) downstream.close();
      });
      upstream.on('error', () => downstream.terminate());
    });
  }

  async start(): Promise<string> {
    if (!this.server.address()) await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Live Gateway relay did not bind to TCP.');
    return `ws://127.0.0.1:${address.port}`;
  }

  dropConnections(): void {
    for (const pair of this.pairs) {
      pair.downstream.terminate();
      pair.upstream.terminate();
    }
    this.pairs.clear();
  }

  async close(): Promise<void> {
    this.dropConnections();
    await new Promise<void>((resolve, reject) => this.server.close((error) => {
      if (error) reject(error);
      else resolve();
    }));
  }
}

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

function waitForState(
  host: OpenClawAdapterHost,
  predicate: (state: OpenClawConnectionState) => boolean,
  timeoutMs: number,
): Promise<OpenClawConnectionState> {
  const current = host.getState();
  if (predicate(current)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for live OpenClaw connection state.'));
    }, timeoutMs);
    const unsubscribe = host.onState((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    });
  });
}

function waitForAction(
  host: OpenClawAdapterHost,
  predicate: (command: AgentActionCommand) => boolean,
  timeoutMs: number,
): Promise<AgentActionCommand> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for a live Desky agent action.'));
    }, timeoutMs);
    const unsubscribe = host.onAction((command) => {
      if (!predicate(command)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(command);
    });
  });
}

async function requestExecApproval(input: {
  requester: OpenClawGatewayClient;
  host: OpenClawAdapterHost;
  sessionKey: string | undefined;
  command: string;
  timeoutMs?: number;
  id?: string;
}): Promise<string> {
  const id = input.id ?? `desky-live-${randomUUID()}`;
  const pending = waitForEvent(
    input.host,
    (event) => event.type === 'approval.requested' && event.payload.requestId === id,
    20_000,
  );
  await expect(input.requester.request('exec.approval.request', {
    id,
    command: input.command,
    host: 'local',
    ask: 'always',
    sessionKey: input.sessionKey,
    twoPhase: true,
    requireDeliveryRoute: false,
    timeoutMs: input.timeoutMs ?? 60_000,
  })).resolves.toMatchObject({ status: 'accepted', id });
  const requested = await pending;
  expect(requested.type).toBe('approval.requested');
  if (requested.type !== 'approval.requested') throw new Error('Expected approval request.');
  expect(requested.payload.safeTarget).toContain(input.command);
  return id;
}

describe.runIf(liveEnabled)('OpenClaw live Gateway', () => {
  it('covers capabilities, approval lifecycle, active reconnect/cancellation, and streaming', async () => {
    expect(credential, 'DESKY_OPENCLAW_LIVE_CREDENTIAL is required for live verification').toBeTruthy();
    expect(liveAction, 'DESKY_OPENCLAW_LIVE_ACTION must be wave or jump').toBeTruthy();
    if (!liveAction) throw new Error('Invalid live action.');
    const directory = mkdtempSync(join(tmpdir(), 'desky-openclaw-live-'));
    const relay = new LiveGatewayRelay(gatewayUrl);
    const relayedGatewayUrl = await relay.start();
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
    const connectionStates: OpenClawConnectionState[] = [];
    host.onEvent((event) => events.push(event));
    host.onState((state) => connectionStates.push(state));

    try {
      const invalidCredential = `desky-invalid-${randomUUID()}`;
      const invalidHost = new OpenClawAdapterHost(
        new SecureVault(join(directory, 'invalid-vault.json'), liveEncryption),
        '0.1.0-live-verification',
        process.platform,
      );
      const invalidFailure = await invalidHost.connect({
        gatewayUrl,
        authKind: 'token',
        credential: invalidCredential,
        rememberCredential: false,
      }).catch((error: unknown) => error as Error);
      expect(invalidFailure.message.toLowerCase()).toContain('unauthorized');
      expect(invalidFailure.message).not.toContain(invalidCredential);
      expect(invalidHost.getState().message).toBe(invalidFailure.message);
      await invalidHost.disconnect();

      const staleDeviceToken = `desky-stale-device-${randomUUID()}`;
      const staleClient = new OpenClawGatewayClient({
        url: gatewayUrl,
        appVersion: '0.1.0-live-verification',
        platform: process.platform,
        identity: generateDeviceIdentity(),
        authKind: 'token',
        credential,
        deviceToken: staleDeviceToken,
        onEvent: () => undefined,
        onClose: () => undefined,
      });
      let staleFailure: Error | undefined;
      try {
        await staleClient.connect();
      } catch (error) {
        staleFailure = error instanceof Error ? error : new Error(String(error));
      } finally {
        staleClient.close('Rejected stale-device verification complete');
      }
      expect(staleFailure).toBeInstanceOf(Error);
      if (!staleFailure) {
        throw new Error('The gateway unexpectedly accepted a stale device token.');
      }
      expect(staleFailure.message.toLowerCase()).toContain('unauthorized');
      expect(staleFailure.message).not.toContain(staleDeviceToken);

      const recoveryVault = new SecureVault(join(directory, 'stale-recovery-vault.json'), liveEncryption);
      recoveryVault.set('openclaw:active-profile', {
        gatewayUrl,
        authKind: 'token',
        deviceToken: staleDeviceToken,
      });
      const recoveryHost = new OpenClawAdapterHost(
        recoveryVault,
        '0.1.0-live-verification',
        process.platform,
      );
      const recovered = await recoveryHost.connect({
        gatewayUrl,
        authKind: 'token',
        credential,
        rememberCredential: false,
      });
      expect(recovered.status).toBe('connected');
      expect(recoveryVault.get<{ deviceToken?: string }>('openclaw:active-profile')?.deviceToken)
        .not.toBe(staleDeviceToken);
      await recoveryHost.disconnect();
      process.stdout.write('[desky-live] wrong bootstrap credential plus stale device-token rejection and recovery passed\n');

      const connected = await host.connect({
        gatewayUrl: relayedGatewayUrl,
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

      const approvalId = await requestExecApproval({
        requester,
        host,
        sessionKey,
        command: 'Write-Output DESKY_APPROVAL_PROBE',
      });
      await host.resolveApproval({ requestId: approvalId, kind: 'exec', decision: 'deny' });
      await expect(requester.request('approval.get', { id: approvalId })).resolves.toMatchObject({
        approval: { id: approvalId, status: 'denied', decision: 'deny' },
      });
      await host.resolveApproval({ requestId: approvalId, kind: 'exec', decision: 'deny' });
      expect(host.getState().message).toBe('Approval already denied in OpenClaw');

      const allowedApprovalId = await requestExecApproval({
        requester,
        host,
        sessionKey,
        command: 'Write-Output DESKY_APPROVAL_ALLOW_ONCE_PROBE',
      });
      await host.resolveApproval({ requestId: allowedApprovalId, kind: 'exec', decision: 'allow-once' });
      await expect(requester.request('approval.get', { id: allowedApprovalId })).resolves.toMatchObject({
        approval: { id: allowedApprovalId, status: 'allowed', decision: 'allow-once' },
      });
      process.stdout.write('[desky-live] approval deny, allow-once, and duplicate acknowledgement passed\n');

      const expiringApprovalId = `desky-live-${randomUUID()}`;
      const expiredTerminal = waitForEvent(
        host,
        (event) => event.type === 'approval.resolved'
          && event.payload.requestId === expiringApprovalId
          && event.payload.status === 'expired',
        10_000,
      );
      await requestExecApproval({
        requester,
        host,
        sessionKey,
        command: 'Write-Output DESKY_APPROVAL_EXPIRY_PROBE',
        timeoutMs: 1_500,
        id: expiringApprovalId,
      });
      await expiredTerminal;
      await expect(requester.request('approval.get', { id: expiringApprovalId })).resolves.toMatchObject({
        approval: { id: expiringApprovalId, status: 'expired' },
      });

      const contendedApprovalId = await requestExecApproval({
        requester,
        host,
        sessionKey,
        command: 'Write-Output DESKY_APPROVAL_CONTENTION_PROBE',
      });
      const contendedTerminal = waitForEvent(
        host,
        (event) => event.type === 'approval.resolved'
          && event.payload.requestId === contendedApprovalId,
        20_000,
      );
      const [, contenderResult] = await Promise.all([
        host.resolveApproval({ requestId: contendedApprovalId, kind: 'exec', decision: 'allow-once' }),
        requester.request<{
          applied: boolean;
          approval: { id: string; status: 'allowed' | 'denied'; decision: 'allow-once' | 'deny' };
        }>('approval.resolve', { id: contendedApprovalId, kind: 'exec', decision: 'deny' }),
      ]);
      const canonicalContention = await requester.request<{
        approval: { id: string; status: 'allowed' | 'denied'; decision: 'allow-once' | 'deny' };
      }>('approval.get', { id: contendedApprovalId });
      expect(canonicalContention.approval).toMatchObject({
        id: contendedApprovalId,
        status: contenderResult.applied ? 'denied' : 'allowed',
        decision: contenderResult.applied ? 'deny' : 'allow-once',
      });
      await contendedTerminal;
      expect(events.filter((event) => event.type === 'approval.resolved'
        && event.payload.requestId === contendedApprovalId)).toHaveLength(1);
      process.stdout.write('[desky-live] approval expiry and first-answer-wins contention passed\n');

      const interruptedTurnStart = events.length;
      const interruptedTerminal = waitForEvent(
        host,
        (event) => event.type === 'turn.completed' || event.type === 'turn.failed',
        30_000,
      );
      await host.send('This live verification turn should reconnect, then be cancelled immediately.');
      const interruptedRunId = host.getState().activeRunId;
      expect(interruptedRunId).toBeTruthy();
      const automaticReconnect = waitForState(
        host,
        (state) => state.status === 'connected'
          && state.selectedSessionKey === sessionKey
          && state.activeRunId === interruptedRunId
          && connectionStates.some((candidate) => candidate.status === 'reconnecting'),
        15_000,
      );
      relay.dropConnections();
      const reconnected = await automaticReconnect;
      expect(connectionStates.some((state) => state.status === 'reconnecting')).toBe(true);
      expect(reconnected).toMatchObject({
        status: 'connected',
        selectedSessionKey: sessionKey,
        activeRunId: interruptedRunId,
      });
      await host.cancel();
      const cancelled = await interruptedTerminal;
      expect(cancelled).toMatchObject({ type: 'turn.failed', turnId: interruptedRunId });
      if (cancelled.type !== 'turn.failed') throw new Error('Expected cancelled turn to fail.');
      expect(cancelled.payload.safeError.toLowerCase()).toContain('cancel');
      expect(events.slice(interruptedTurnStart).filter((event) => event.turnId === interruptedRunId
        && (event.type === 'turn.completed' || event.type === 'turn.failed'))).toHaveLength(1);
      process.stdout.write('[desky-live] active-turn network loss, reconnect, cancellation, and terminal dedupe passed\n');

      const streamedTerminal = waitForEvent(
        host,
        (event) => event.type === 'turn.completed' || event.type === 'turn.failed',
        120_000,
      );
      const streamStart = events.length;
      await host.send('Reply with exactly DESKY_LIVE_OK and no other text.');
      const streamed = await streamedTerminal;
      const terminalFailure = streamed.type === 'turn.failed' ? streamed.payload.safeError : undefined;
      expect(host.getState().activeRunId).toBeUndefined();
      expect(streamed.type, `OpenClaw ${hello.server.version}: ${terminalFailure ?? 'unexpected terminal'}`).toBe('turn.completed');
      const streamedText = events
        .slice(streamStart)
        .filter((event) => event.type === 'assistant.delta')
        .map((event) => event.payload.text)
        .join('');
      expect(streamedText).toContain('DESKY_LIVE_OK');

      expect(host.getState().capabilities.agentActions).toMatchObject({
        availability: 'available',
        transport: 'typed-tool-event',
        actions: ['wave', 'jump'],
      });
      const actionTerminal = waitForEvent(
        host,
        (event) => event.type === 'turn.completed' || event.type === 'turn.failed',
        120_000,
      );
      const actionCommand = waitForAction(
        host,
        (command) => command.payload.action === liveAction,
        120_000,
      );
      await host.send([
        `Use the desky_avatar_action tool exactly once with action ${liveAction}.`,
        'After the tool succeeds, reply with exactly DESKY_ACTION_OK and no other text.',
      ].join(' '));
      const [action, actionResult] = await Promise.all([actionCommand, actionTerminal]);
      expect(action.payload).toEqual({ action: liveAction });
      expect(actionResult.type).toBe('turn.completed');
      process.stdout.write(`[desky-live] typed desky_avatar_action ${liveAction} passed\n`);
    } finally {
      requester.close('Desky live verification complete');
      await host.disconnect();
      await relay.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 210_000);
});
