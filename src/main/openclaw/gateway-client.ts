import { randomUUID } from 'node:crypto';

import WebSocket, { type RawData } from 'ws';

import { OPENCLAW_PROTOCOL_VERSION } from '../../shared/openclaw';
import {
  buildDeviceAuthPayload,
  type DeviceIdentity,
  GatewayRequestError,
  type GatewayFrame,
  type GatewayHello,
  isGatewayHello,
  OPENCLAW_CAPABILITIES,
  OPENCLAW_SCOPES,
  parseGatewayFrame,
  publicKeyRawBase64Url,
  readString,
  signDeviceAuth,
} from './protocol';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

export interface GatewayConnectOptions {
  url: string;
  appVersion: string;
  platform: string;
  identity: DeviceIdentity;
  authKind: 'token' | 'password';
  credential?: string;
  deviceToken?: string;
  onEvent(event: string, payload: unknown): void;
  onClose(reason: string, expected: boolean): void;
  onSequenceGap?(expected: number, received: number): void;
}

export class OpenClawGatewayClient {
  private socket?: WebSocket;
  private readonly pending = new Map<string, PendingRequest>();
  private hello?: GatewayHello;
  private expectedClose = false;
  private lastSequence?: number;
  private challengeHandled = false;

  constructor(private readonly options: GatewayConnectOptions) {}

  get connectionId(): string | undefined {
    return this.hello?.server.connId;
  }

  get features(): GatewayHello['features'] | undefined {
    return this.hello?.features;
  }

  async connect(): Promise<GatewayHello> {
    if (this.socket) throw new Error('Gateway client is already connected.');
    this.expectedClose = false;
    this.challengeHandled = false;
    const socket = new WebSocket(this.options.url, {
      handshakeTimeout: 15_000,
      maxPayload: 1_048_576,
      perMessageDeflate: false,
    });
    this.socket = socket;

    return new Promise<GatewayHello>((resolve, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error('OpenClaw Gateway handshake timed out.'));
        socket.close(1008, 'handshake timeout');
      }, 20_000);

      const fail = (error: Error) => {
        clearTimeout(deadline);
        reject(error);
      };

      socket.on('error', (error) => {
        if (!this.hello) fail(error);
      });
      socket.on('message', (data, isBinary) => {
        if (isBinary) return;
        this.handleMessage(data, async (frame) => {
          if (frame.type !== 'event' || frame.event !== 'connect.challenge' || this.challengeHandled) return;
          this.challengeHandled = true;
          const challenge = frame.payload;
          if (!challenge || typeof challenge !== 'object') {
            fail(new Error('Gateway sent a malformed connection challenge.'));
            return;
          }
          const nonce = readString((challenge as Record<string, unknown>).nonce);
          const challengeTs = (challenge as Record<string, unknown>).ts;
          if (!nonce || typeof challengeTs !== 'number' || Math.abs(Date.now() - challengeTs) > 300_000) {
            fail(new Error('Gateway sent an invalid or stale connection challenge.'));
            return;
          }
          try {
            const hello = await this.sendConnect(nonce);
            clearTimeout(deadline);
            this.hello = hello;
            resolve(hello);
          } catch (error) {
            fail(error instanceof Error ? error : new Error('Gateway authentication failed.'));
          }
        });
      });
      socket.on('close', (code, reason) => {
        clearTimeout(deadline);
        const message = reason.toString().slice(0, 180) || `WebSocket closed (${code})`;
        const error = new Error(message);
        for (const request of this.pending.values()) {
          clearTimeout(request.timeout);
          request.reject(error);
        }
        this.pending.clear();
        this.socket = undefined;
        if (!this.hello) reject(error);
        this.options.onClose(message, this.expectedClose);
      });
    });
  }

  request<T>(method: string, params: unknown = {}, timeoutMs = 20_000): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('OpenClaw Gateway is not connected.'));
    }
    const id = randomUUID();
    const encoded = JSON.stringify({ type: 'req', id, method, params });
    const maxBufferedBytes = this.hello?.policy.maxBufferedBytes ?? 1_048_576;
    if (Buffer.byteLength(encoded) + socket.bufferedAmount > maxBufferedBytes) {
      return Promise.reject(new Error('Gateway send queue is full. Try again after the current activity settles.'));
    }
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timeout });
      socket.send(encoded, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  close(reason = 'Desky disconnected'): void {
    this.expectedClose = true;
    this.socket?.close(1000, reason.slice(0, 120));
  }

  private async sendConnect(nonce: string): Promise<GatewayHello> {
    const signedAt = Date.now();
    const signatureToken = this.options.deviceToken
      ?? (this.options.authKind === 'token' ? this.options.credential : undefined);
    const payload = buildDeviceAuthPayload({
      identity: this.options.identity,
      nonce,
      signedAt,
      signatureToken,
      platform: this.options.platform,
    });
    const auth = this.options.deviceToken
      ? { token: this.options.deviceToken, deviceToken: this.options.deviceToken }
      : this.options.authKind === 'password'
        ? { password: this.options.credential }
        : { token: this.options.credential };
    const result = await this.request<unknown>('connect', {
      minProtocol: OPENCLAW_PROTOCOL_VERSION,
      maxProtocol: OPENCLAW_PROTOCOL_VERSION,
      client: {
        id: 'gateway-client',
        displayName: 'Desky',
        version: this.options.appVersion,
        platform: this.options.platform,
        deviceFamily: 'desktop',
        mode: 'backend',
      },
      caps: [...OPENCLAW_CAPABILITIES],
      permissions: {},
      role: 'operator',
      scopes: [...OPENCLAW_SCOPES],
      auth,
      device: {
        id: this.options.identity.deviceId,
        publicKey: publicKeyRawBase64Url(this.options.identity.publicKeyPem),
        signature: signDeviceAuth(this.options.identity, payload),
        signedAt,
        nonce,
      },
      locale: 'en',
      userAgent: `Desky/${this.options.appVersion}`,
    });
    if (!isGatewayHello(result)) {
      throw new Error('Gateway hello did not match the pinned OpenClaw protocol v4 contract.');
    }
    return result;
  }

  private handleMessage(data: RawData, beforeReady: (frame: GatewayFrame) => Promise<void>): void {
    const frame = parseGatewayFrame(data.toString());
    if (!frame) return;
    if (frame.type === 'res') {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(frame.id);
      if (frame.ok) pending.resolve(frame.payload);
      else pending.reject(new GatewayRequestError(
        frame.error?.message ?? 'Gateway request failed.',
        frame.error?.code,
        frame.error?.details,
        frame.error?.retryable,
        frame.error?.retryAfterMs,
      ));
      return;
    }
    if (typeof frame.seq === 'number') {
      if (this.lastSequence !== undefined && frame.seq !== this.lastSequence + 1) {
        this.options.onSequenceGap?.(this.lastSequence + 1, frame.seq);
      }
      this.lastSequence = frame.seq;
    }
    if (this.hello) this.options.onEvent(frame.event, frame.payload);
    else void beforeReady(frame);
  }
}
