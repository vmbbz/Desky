import { randomUUID } from 'node:crypto';

import { getConnectionString } from '@netlify/database';
import { Pool, type PoolClient, type QueryResult } from 'pg';

import { BaseSepoliaCheckoutRuntime } from '../../../src/service/commerce/base-sepolia-checkout-runtime';
import {
  CheckoutBrowserHttpApi,
  type CheckoutBrowserHttpResponse,
} from '../../../src/service/commerce/checkout-browser-http';
import { HostedCheckoutBrowserService } from '../../../src/service/commerce/checkout-browser-service';
import {
  PostgresCheckoutLedger,
  type PostgresPool,
  type PostgresQueryResult,
  type PostgresTransactionClient,
} from '../../../src/service/commerce/postgres-checkout-ledger';
import { StrictX402FacilitatorClient } from '../../../src/service/commerce/x402-base-sepolia';

const maximumRequestBytes = 32 * 1_024;
const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

class PgClientBridge implements PostgresTransactionClient {
  constructor(private readonly client: PoolClient) {}
  async query(text: string, values?: unknown[]): Promise<PostgresQueryResult> {
    const result = await this.client.query(text, values);
    return pgResult(result);
  }
  release(): void { this.client.release(); }
}
class PgPoolBridge implements PostgresPool {
  constructor(private readonly pool: Pool) {}
  async query(text: string, values?: unknown[]): Promise<PostgresQueryResult> {
    return pgResult(await this.pool.query(text, values));
  }
  async connect(): Promise<PostgresTransactionClient> {
    return new PgClientBridge(await this.pool.connect());
  }
  async end(): Promise<void> { await this.pool.end(); }
}

function pgResult(result: QueryResult): PostgresQueryResult {
  return {
    rows: result.rows as Array<Record<string, unknown>>,
    rowCount: result.rowCount,
  };
}

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

let singleton: Runtime | undefined;

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
  const pool = new Pool({
    connectionString: getConnectionString(),
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    application_name: 'desky-commerce-hosted',
  });
  const ledger = new PostgresCheckoutLedger(new PgPoolBridge(pool));
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
  try {
    const body = await boundedBody(request);
    return webResponse(await runtime().api.handle({
      method: request.method,
      path,
      contentType: request.headers.get('content-type') ?? undefined,
      body,
      origin: request.headers.get('origin') ?? undefined,
      cookie: request.headers.get('cookie') ?? undefined,
      csrfToken: request.headers.get('x-desky-csrf') ?? undefined,
      secFetchSite: request.headers.get('sec-fetch-site') ?? undefined,
      correlationId: correlationId(request),
    }));
  } catch {
    return unavailable(request);
  }
}

export async function handleHealthRequest(request: Request, ready: boolean): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 404 });
  try {
    const active = runtime();
    const database = await active.ledger.healthCheck();
    if (!database.writable || database.migrationVersion !== 1) return unavailable(request);
    if (ready) await active.facilitator.getSupported();
    return Response.json({ schemaVersion: 1, status: 'ok' }, {
      status: 200,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  } catch {
    return unavailable(request);
  }
}
