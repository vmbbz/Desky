import { createCipheriv, createHash, createPrivateKey, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { Pool } from 'pg';

import { BaseSepoliaCheckoutRuntime } from '../../../src/service/commerce/base-sepolia-checkout-runtime';
import {
  BaseSepoliaReconciliationWorker,
  BaseSepoliaSettlementObserver,
  StrictBaseSepoliaRpcClient,
} from '../../../src/service/commerce/base-sepolia-settlement-observer';
import {
  CheckoutBrowserHttpApi,
  type CheckoutBrowserHttpResponse,
} from '../../../src/service/commerce/checkout-browser-http';
import { HostedCheckoutBrowserService } from '../../../src/service/commerce/checkout-browser-service';
import { HostedCommerceCheckoutService } from '../../../src/service/commerce/checkout-session-service';
import { CommerceHttpApi } from '../../../src/service/commerce/http-api';
import { HostedCommerceHttpApi } from '../../../src/service/commerce/hosted-http-api';
import { HostedCommerceIdentityService } from '../../../src/service/commerce/identity-session-service';
import {
  PostgresCheckoutLedger,
} from '../../../src/service/commerce/postgres-checkout-ledger';
import { PostgresCommerceIdentityStore } from '../../../src/service/commerce/postgres-identity-store';
import { HostedCommerceQuoteService } from '../../../src/service/commerce/quote-service';
import { admitToothpastePilotOffer } from '../../../src/service/commerce/paid-pilot-offer';
import { SupabaseIdentityVerifier } from '../../../src/service/commerce/supabase-identity';
import { CommerceTokenIssuer } from '../../../src/service/commerce/token-issuer';
import { StrictX402FacilitatorClient } from '../../../src/service/commerce/x402-base-sepolia';
import { getBundledMarketplaceCatalog } from '../../../src/main/marketplace-catalog';
import { supabasePoolConfiguration } from './database-config';
import { PgPoolBridge } from './pg-pool-bridge';
import { commerceBackupTables } from './commerce-backup-format';

const maximumRequestBytes = 32 * 1_024;
const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value || /[\r\n]/.test(value)) {
    throw new Error('Hosted checkout runtime is not configured.');
  }
  return value;
}

function exactOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new Error('Hosted checkout runtime is not configured.');
  }
  return value;
}

function merchantAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)
    || /^0x0{40}$/i.test(value)) {
    throw new Error('Hosted checkout runtime is not configured.');
  }
  return value;
}

interface Runtime {
  api: CheckoutBrowserHttpApi;
  ledger: PostgresCheckoutLedger;
  facilitator: StrictX402FacilitatorClient;
}

interface DatabaseRuntime {
  ledger: PostgresCheckoutLedger;
  identities: PostgresCommerceIdentityStore;
  bridge: PgPoolBridge;
}

interface ServiceRuntime {
  api: HostedCommerceHttpApi;
  identities: PostgresCommerceIdentityStore;
  tokens: CommerceTokenIssuer;
}

let singleton: Runtime | undefined;
let databaseSingleton: DatabaseRuntime | undefined;
let serviceSingleton: ServiceRuntime | undefined;
let reconciliationSingleton: BaseSepoliaReconciliationWorker | undefined;

function database(): DatabaseRuntime {
  if (databaseSingleton) return databaseSingleton;
  const pool = new Pool({
    ...supabasePoolConfiguration(),
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    application_name: 'desky-commerce-hosted',
  });
  const bridge = new PgPoolBridge(pool);
  databaseSingleton = {
    ledger: new PostgresCheckoutLedger(bridge),
    identities: new PostgresCommerceIdentityStore(bridge),
    bridge,
  };
  return databaseSingleton;
}

function runtime(): Runtime {
  if (singleton) return singleton;
  const checkoutOrigin = exactOrigin(requiredEnvironment('DESKY_CHECKOUT_ORIGIN'));
  const merchantRecipient = merchantAddress(requiredEnvironment('DESKY_MERCHANT_RECIPIENT'));
  const facilitatorBaseUrl = requiredEnvironment('DESKY_X402_FACILITATOR_URL');
  const authorization = process.env.DESKY_X402_FACILITATOR_AUTHORIZATION;
  if (authorization !== undefined
    && (authorization.trim() !== authorization || /[\r\n]/.test(authorization))) {
    throw new Error('Hosted checkout runtime is not configured.');
  }
  const ledger = database().ledger;
  const facilitator = new StrictX402FacilitatorClient({
    baseUrl: facilitatorBaseUrl,
    authorization,
    timeoutMilliseconds: 15_000,
  });
  const walletRuntime = new BaseSepoliaCheckoutRuntime(ledger, facilitator, {
    merchantRecipient,
    resourceOrigin: checkoutOrigin,
    facilitatorBaseUrl,
    maximumQuoteLifetimeSeconds: 600,
  });
  const browser = new HostedCheckoutBrowserService(ledger, walletRuntime, { checkoutOrigin });
  singleton = { api: new CheckoutBrowserHttpApi(browser), ledger, facilitator };
  return singleton;
}

function decodedSecret(name: string): Buffer {
  const encoded = requiredEnvironment(name);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Hosted checkout runtime is not configured.');
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.byteLength !== 32 || bytes.toString('base64url') !== encoded) {
    throw new Error('Hosted checkout runtime is not configured.');
  }
  return bytes;
}

function serviceRuntime(): ServiceRuntime {
  if (serviceSingleton) return serviceSingleton;
  const origin = exactOrigin(requiredEnvironment('DESKY_CHECKOUT_ORIGIN'));
  const privateKey = createPrivateKey({
    key: Buffer.from(requiredEnvironment('DESKY_COMMERCE_SIGNING_KEY_BASE64'), 'base64'),
    format: 'der', type: 'pkcs8',
  });
  const tokens = new CommerceTokenIssuer({
    issuer: origin,
    keyId: requiredEnvironment('DESKY_COMMERCE_SIGNING_KEY_ID'),
    privateKey,
  });
  const db = database();
  const identity = new HostedCommerceIdentityService(
    db.identities,
    new SupabaseIdentityVerifier({
      projectRef: requiredEnvironment('DESKY_SUPABASE_PROJECT_REF'),
      publishableKey: requiredEnvironment('DESKY_SUPABASE_PUBLISHABLE_KEY'),
    }),
    tokens,
    {
      credentialPepper: decodedSecret('DESKY_COMMERCE_CREDENTIAL_PEPPER'),
      catalogVersion: 'desky-foundation:2',
      freeAvatars: getBundledMarketplaceCatalog().avatars,
    },
  );
  const checkout = new HostedCommerceCheckoutService(db.ledger, {
    authenticate: async (token) => {
      const authenticated = await identity.authenticateCommerceToken(token);
      return { accountId: authenticated.accountId, installationId: authenticated.installationId };
    },
  }, { checkoutOrigin: origin });
  const offerJson = process.env.DESKY_BASE_SEPOLIA_OFFER_JSON;
  if (offerJson && !process.env.DESKY_BASE_SEPOLIA_RPC_URL) {
    throw new Error('Hosted checkout runtime is not configured.');
  }
  const quotes = offerJson
    ? new HostedCommerceQuoteService(db.ledger, identity, admitToothpastePilotOffer(JSON.parse(offerJson)))
    : undefined;
  serviceSingleton = {
    api: new HostedCommerceHttpApi(new CommerceHttpApi(identity, checkout, (error, context) => {
      console.error(JSON.stringify({
        event: 'commerce-internal-error',
        path: context.path,
        correlationId: context.correlationId,
        errorName: error.name.slice(0, 80),
        errorMessage: error.message.slice(0, 500),
      }));
    }), identity, quotes),
    identities: db.identities,
    tokens,
  };
  return serviceSingleton;
}

function reconciliationRuntime(): BaseSepoliaReconciliationWorker {
  if (reconciliationSingleton) return reconciliationSingleton;
  const client = new StrictBaseSepoliaRpcClient(requiredEnvironment('DESKY_BASE_SEPOLIA_RPC_URL'));
  reconciliationSingleton = new BaseSepoliaReconciliationWorker(
    database().ledger,
    new BaseSepoliaSettlementObserver(client, 3),
  );
  return reconciliationSingleton;
}

async function boundedBody(request: Request): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^[0-9]{1,8}$/.test(declared) || Number(declared) > maximumRequestBytes)) {
    throw new Error('request-size');
  }
  if (!request.body) throw new Error('request-size');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let body = '';
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximumRequestBytes) {
      await reader.cancel();
      throw new Error('request-size');
    }
    body += decoder.decode(part.value, { stream: true });
  }
  body += decoder.decode();
  if (total === 0) throw new Error('request-size');
  return body;
}

function correlationId(request: Request): string {
  const candidate = request.headers.get('x-nf-request-id')?.toLowerCase();
  return candidate && identifierPattern.test(candidate)
    ? candidate : `request:${randomUUID()}`;
}

function webResponse(response: CheckoutBrowserHttpResponse): Response {
  return new Response(response.body, { status: response.status, headers: response.headers });
}

function unavailable(request: Request): Response {
  return Response.json({
    schemaVersion: 1,
    error: 'temporarily-unavailable',
    correlationId: correlationId(request),
  }, {
    status: 503,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}

export async function handleBrowserRequest(path: string, request: Request): Promise<Response> {
  const started = Date.now();
  const id = correlationId(request);
  const origin = request.headers.get('origin') ?? undefined;
  const checkoutOrigin = process.env.DESKY_CHECKOUT_ORIGIN;
  const originClass = checkoutOrigin && origin === checkoutOrigin ? 'checkout'
    : /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin ?? '') ? 'loopback-ipv4'
      : origin ? 'other' : 'missing';
  try {
    const body = await boundedBody(request);
    const response = await runtime().api.handle({
      method: request.method,
      path,
      contentType: request.headers.get('content-type') ?? undefined,
      body,
      origin,
      cookie: request.headers.get('cookie') ?? undefined,
      csrfToken: request.headers.get('x-desky-csrf') ?? undefined,
      secFetchSite: request.headers.get('sec-fetch-site') ?? undefined,
      correlationId: id,
    });
    console.log(JSON.stringify({
      event: 'commerce-browser-http', path, status: response.status, correlationId: id,
      originClass, secFetchSite: request.headers.get('sec-fetch-site') ?? 'missing',
      durationMs: Date.now() - started,
    }));
    return webResponse(response);
  } catch {
    console.error(JSON.stringify({
      event: 'commerce-browser-http-failed', path, correlationId: id,
      originClass, secFetchSite: request.headers.get('sec-fetch-site') ?? 'missing',
      durationMs: Date.now() - started,
    }));
    return unavailable(request);
  }
}

function bearer(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  const value = header.slice(7);
  return value.length >= 32 && value.length <= 8_192 && !/[\s\r\n]/.test(value) ? value : undefined;
}

function requestRateKey(request: Request, path: string): string {
  const client = request.headers.get('x-nf-client-connection-ip') ?? 'unknown';
  return `http:${createHash('sha256').update(`${client}:${path}`).digest('hex')}`;
}

export async function handleServiceRequest(path: string, request: Request): Promise<Response> {
  const started = Date.now();
  const id = correlationId(request);
  try {
    const service = serviceRuntime();
    const maximum = path === '/v1/identity/session' ? 10 : 30;
    if (!await service.identities.admitRateLimit(
      requestRateKey(request, path), new Date().toISOString(), maximum, 60,
    )) {
      return Response.json({ schemaVersion: 1, error: 'rate-limited', correlationId: id }, {
        status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' },
      });
    }
    const body = await boundedBody(request);
    const response = await service.api.handle({
      method: request.method, path,
      contentType: request.headers.get('content-type') ?? undefined,
      authorization: request.headers.get('authorization') ?? undefined,
      body, correlationId: id,
    });
    console.log(JSON.stringify({ event: 'commerce-http', path, status: response.status,
      correlationId: id, durationMs: Date.now() - started }));
    return webResponse(response);
  } catch {
    console.error(JSON.stringify({ event: 'commerce-http-failed', path,
      correlationId: id, durationMs: Date.now() - started }));
    return unavailable(request);
  }
}

export async function handleJwksRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 404 });
  try {
    return Response.json(serviceRuntime().tokens.jwks(), {
      status: 200,
      headers: {
        'cache-control': 'public, max-age=300, stale-if-error=3600',
        'content-type': 'application/jwk-set+json',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch { return unavailable(request); }
}

function secretMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(actual, 'utf8');
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export async function handleOperationsRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 404 });
  try {
    const credential = bearer(request);
    if (!secretMatches(requiredEnvironment('DESKY_COMMERCE_OPERATOR_TOKEN'), credential)) {
      return new Response(null, { status: 404 });
    }
    const snapshot = await serviceRuntime().identities.operations(new Date().toISOString());
    return Response.json(snapshot, {
      status: 200,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  } catch { return unavailable(request); }
}

export async function handleReconciliationRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 404 });
  try {
    const credential = bearer(request);
    if (!secretMatches(requiredEnvironment('DESKY_COMMERCE_OPERATOR_TOKEN'), credential)) {
      return new Response(null, { status: 404 });
    }
    const generatedAt = new Date().toISOString();
    const items = await serviceRuntime().identities.reconciliationQueue(generatedAt);
    return Response.json({ schemaVersion: 1, generatedAt, items }, {
      status: 200,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  } catch { return unavailable(request); }
}

export async function handleBackupRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 404 });
  try {
    const credential = bearer(request);
    if (!secretMatches(requiredEnvironment('DESKY_COMMERCE_OPERATOR_TOKEN'), credential)) {
      return new Response(null, { status: 404 });
    }
    const bridge = database().bridge;
    const version = await bridge.query(
      'SELECT COALESCE(MAX(version),0) AS version FROM desky_commerce.commerce_schema_migrations',
    );
    if (Number(version.rows[0]?.version) !== 2) throw new Error('backup-schema');
    const tables = [];
    for (const table of commerceBackupTables) {
      const metadata = await bridge.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'desky_commerce' AND table_name = $1 ORDER BY ordinal_position
      `, [table]);
      const columns = metadata.rows.map((row) => String(row.column_name));
      if (columns.length === 0) throw new Error('backup-schema');
      const result = await bridge.query(`SELECT * FROM desky_commerce.${table}`);
      tables.push({ table, columns, rows: result.rows.map((row) => columns.map((column) => {
        const value = row[column];
        return value instanceof Date ? value.toISOString() : value;
      })) });
    }
    const plaintext = Buffer.from(JSON.stringify({
      schemaVersion: 1, createdAt: new Date().toISOString(), migrationVersion: 2, tables,
    }), 'utf8');
    if (plaintext.byteLength > 32 * 1_024 * 1_024) throw new Error('backup-size');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', decodedSecret('DESKY_COMMERCE_BACKUP_KEY'), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = Buffer.from(JSON.stringify({
      format: 'desky-commerce-backup+a256gcm', version: 1,
      iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    }), 'utf8');
    return new Response(envelope, { status: 200, headers: {
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="desky-commerce-${new Date().toISOString().slice(0, 10)}.dcbackup"`,
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    } });
  } catch { return unavailable(request); }
}

export async function runScheduledMonitor(): Promise<void> {
  const generatedAt = new Date().toISOString();
  try {
    const service = serviceRuntime();
    const expiredIdleCheckoutSessions = await database().ledger.expireIdleCheckoutSessions(generatedAt);
    const expiredUnstartedOrders = await database().ledger.expireUnstartedOrders(generatedAt);
    const chain = process.env.DESKY_BASE_SEPOLIA_RPC_URL
      ? await reconciliationRuntime().run(generatedAt)
      : undefined;
    const [operations, queue] = await Promise.all([
      service.identities.operations(generatedAt),
      service.identities.reconciliationQueue(generatedAt),
    ]);
    const maximumAgeSeconds = queue.reduce((maximum, item) => Math.max(maximum, item.ageSeconds), 0);
    const severity = (chain?.errors ?? 0) > 0 || maximumAgeSeconds >= 300 ? 'error'
      : operations.indeterminateSettlements > 0 ? 'warning' : 'info';
    const event = {
      event: 'commerce-monitor', severity, generatedAt,
      migrationVersion: operations.migrationVersion,
      pendingOrders: operations.pendingOrders,
      expiredIdleCheckoutSessions,
      expiredUnstartedOrders,
      indeterminateSettlements: operations.indeterminateSettlements,
      maximumReconciliationAgeSeconds: maximumAgeSeconds,
      chainReconciliation: chain ?? { status: 'disabled' },
    };
    if (severity === 'error') console.error(JSON.stringify(event));
    else if (severity === 'warning') console.warn(JSON.stringify(event));
    else console.log(JSON.stringify(event));
  } catch {
    console.error(JSON.stringify({ event: 'commerce-monitor', severity: 'error',
      generatedAt, reason: 'monitor-unavailable' }));
    throw new Error('Commerce monitor failed.');
  }
}

export async function handleHealthRequest(request: Request, ready: boolean): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 404 });
  try {
    const databaseHealth = await database().ledger.healthCheck();
    if (!databaseHealth.writable || databaseHealth.migrationVersion !== 2) {
      return unavailable(request);
    }
    if (ready) {
      serviceRuntime();
      await runtime().facilitator.getSupported();
      await reconciliationRuntime().healthCheck();
    }
    return Response.json({ schemaVersion: 1, status: 'ok' }, {
      status: 200,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  } catch {
    return unavailable(request);
  }
}
