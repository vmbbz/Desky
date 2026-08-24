import { createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';

export interface CommerceJwksLoadResult {
  keys: ReadonlyMap<string, KeyObject>;
  maxAgeSeconds: number;
}

export interface CommerceJwksLoader {
  load(): Promise<CommerceJwksLoadResult>;
}

export interface HttpsCommerceJwksLoaderOptions {
  serviceOrigin: string;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  defaultMaxAgeSeconds?: number;
  maximumMaxAgeSeconds?: number;
}

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function exactRecord(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid commerce JWKS ${name}.`);
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw new Error(`Invalid commerce JWKS ${name}.`);
  }
  return record;
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Commerce JWKS service origin is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Commerce JWKS requires an HTTPS origin without credentials or a path.');
  }
  return url.origin;
}

function parseMaximumAge(cacheControl: string | null, fallback: number, maximum: number): number {
  const match = cacheControl?.match(/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i);
  if (!match) return fallback;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? Math.max(30, Math.min(parsed, maximum)) : fallback;
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
    throw new Error('Commerce JWKS response size is invalid.');
  }
  if (!response.body) throw new Error('Commerce JWKS response body is missing.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('Commerce JWKS response size is invalid.');
    }
    chunks.push(value);
  }
  if (total === 0) throw new Error('Commerce JWKS response size is invalid.');
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

export function parseCommerceJwks(value: unknown): ReadonlyMap<string, KeyObject> {
  const document = exactRecord(value, ['keys'], 'document');
  if (!Array.isArray(document.keys) || document.keys.length < 1 || document.keys.length > 16) {
    throw new Error('Invalid commerce JWKS document.');
  }
  const keys = new Map<string, KeyObject>();
  for (const entry of document.keys) {
    const key = exactRecord(entry, ['alg', 'crv', 'kid', 'kty', 'use', 'x'], 'key');
    if (key.alg !== 'EdDSA' || key.crv !== 'Ed25519' || key.kty !== 'OKP' || key.use !== 'sig'
      || typeof key.kid !== 'string' || !identifierPattern.test(key.kid)
      || typeof key.x !== 'string' || !base64UrlPattern.test(key.x)) {
      throw new Error('Invalid commerce JWKS key.');
    }
    const decoded = Buffer.from(key.x, 'base64url');
    if (decoded.byteLength !== 32 || decoded.toString('base64url') !== key.x || keys.has(key.kid)) {
      throw new Error('Invalid commerce JWKS key material or duplicate key ID.');
    }
    try {
      keys.set(key.kid, createPublicKey({
        format: 'jwk',
        key: key as unknown as JsonWebKey,
      }));
    } catch {
      throw new Error('Invalid commerce JWKS public key.');
    }
  }
  return keys;
}

export class HttpsCommerceJwksLoader implements CommerceJwksLoader {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly maximumResponseBytes: number;
  private readonly defaultMaxAgeSeconds: number;
  private readonly maximumMaxAgeSeconds: number;

  constructor(options: HttpsCommerceJwksLoaderOptions) {
    this.url = `${normalizeOrigin(options.serviceOrigin)}/.well-known/jwks.json`;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maximumResponseBytes = options.maximumResponseBytes ?? 64 * 1_024;
    this.defaultMaxAgeSeconds = options.defaultMaxAgeSeconds ?? 300;
    this.maximumMaxAgeSeconds = options.maximumMaxAgeSeconds ?? 3_600;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 30_000
      || !Number.isSafeInteger(this.maximumResponseBytes)
      || this.maximumResponseBytes < 1_024 || this.maximumResponseBytes > 256 * 1_024
      || !Number.isSafeInteger(this.defaultMaxAgeSeconds) || this.defaultMaxAgeSeconds < 30
      || !Number.isSafeInteger(this.maximumMaxAgeSeconds)
      || this.maximumMaxAgeSeconds < this.defaultMaxAgeSeconds
      || this.maximumMaxAgeSeconds > 24 * 60 * 60) {
      throw new Error('Commerce JWKS loader policy is invalid.');
    }
  }

  async load(): Promise<CommerceJwksLoadResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: 'GET',
        headers: { accept: 'application/jwk-set+json, application/json' },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status !== 200 || response.url !== this.url) {
        throw new Error('Commerce JWKS request failed or redirected.');
      }
      const contentType = response.headers.get('content-type')?.toLowerCase();
      if (!contentType?.startsWith('application/jwk-set+json')
        && !contentType?.startsWith('application/json')) {
        throw new Error('Commerce JWKS response content type is invalid.');
      }
      const body = await readBoundedBody(response, this.maximumResponseBytes);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body) as unknown;
      } catch {
        throw new Error('Commerce JWKS response is invalid JSON.');
      }
      return {
        keys: parseCommerceJwks(parsed),
        maxAgeSeconds: parseMaximumAge(
          response.headers.get('cache-control'),
          this.defaultMaxAgeSeconds,
          this.maximumMaxAgeSeconds,
        ),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface RotatingCommerceJwksOptions {
  loader: CommerceJwksLoader;
  revokedKeyIds?: ReadonlySet<string>;
  maximumStaleSeconds?: number;
}

export class RotatingCommerceJwks {
  private keys = new Map<string, KeyObject>();
  private refreshAtSeconds = 0;
  private staleUntilSeconds = 0;
  private readonly loader: CommerceJwksLoader;
  private readonly revokedKeyIds: ReadonlySet<string>;
  private readonly maximumStaleSeconds: number;

  constructor(options: RotatingCommerceJwksOptions) {
    this.loader = options.loader;
    this.revokedKeyIds = options.revokedKeyIds ?? new Set();
    this.maximumStaleSeconds = options.maximumStaleSeconds ?? 60 * 60;
    if (!Number.isSafeInteger(this.maximumStaleSeconds)
      || this.maximumStaleSeconds < 0 || this.maximumStaleSeconds > 24 * 60 * 60) {
      throw new Error('Commerce JWKS stale policy is invalid.');
    }
  }

  async getKeys(requiredKeyId: string, nowSeconds = Math.floor(Date.now() / 1_000)): Promise<ReadonlyMap<string, KeyObject>> {
    if (!identifierPattern.test(requiredKeyId) || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
      throw new Error('Commerce JWKS lookup is invalid.');
    }
    if (this.revokedKeyIds.has(requiredKeyId)) {
      throw new Error('Commerce JWKS key is explicitly revoked.');
    }
    const requiresRefresh = this.keys.size === 0
      || nowSeconds >= this.refreshAtSeconds
      || !this.keys.has(requiredKeyId);
    if (requiresRefresh) {
      try {
        const result = await this.loader.load();
        const admitted = new Map(
          [...result.keys].filter(([kid]) => !this.revokedKeyIds.has(kid)),
        );
        if (admitted.size === 0) throw new Error('Commerce JWKS contains no admitted keys.');
        this.keys = admitted;
        this.refreshAtSeconds = nowSeconds + result.maxAgeSeconds;
        this.staleUntilSeconds = this.refreshAtSeconds + this.maximumStaleSeconds;
      } catch (error) {
        if (this.keys.has(requiredKeyId) && nowSeconds < this.staleUntilSeconds) {
          return new Map(this.keys);
        }
        throw error;
      }
    }
    if (!this.keys.has(requiredKeyId)) throw new Error('Commerce JWKS key is not admitted.');
    return new Map(this.keys);
  }
}
