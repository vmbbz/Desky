import {
  parseCommerceIdentitySessionRequest,
  parseCommerceIdentitySessionResponse,
  parseCommerceQuoteRequest,
  parseCommerceQuoteResponse,
} from '../../shared/commerce-service';
import { CommerceServiceError, type CommerceHttpApi, type CommerceHttpRequest, type CommerceHttpResponse } from './http-api';
import type { HostedCommerceIdentityService } from './identity-session-service';
import type { HostedCommerceQuoteService } from './quote-service';

function bearer(value: string | undefined): string | undefined {
  if (!value?.startsWith('Bearer ')) return undefined;
  const token = value.slice(7);
  return token.length >= 32 && token.length <= 8_192 && !/[\r\n\s]/.test(token) ? token : undefined;
}

function response(status: CommerceHttpResponse['status'], body: unknown): CommerceHttpResponse {
  return {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
    body: JSON.stringify(body),
  };
}

function failure(status: Exclude<CommerceHttpResponse['status'], 200>, code: string, correlationId: string) {
  return response(status, { schemaVersion: 1, error: code, correlationId });
}

export class HostedCommerceHttpApi {
  constructor(
    private readonly core: CommerceHttpApi,
    private readonly identity: HostedCommerceIdentityService,
    private readonly quotes?: HostedCommerceQuoteService,
  ) {}

  async handle(request: CommerceHttpRequest): Promise<CommerceHttpResponse> {
    if (request.path !== '/v1/identity/session' && request.path !== '/v1/quote') {
      return this.core.handle(request);
    }
    const correlationId = /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(request.correlationId)
      ? request.correlationId : 'correlation:invalid';
    if (request.method !== 'POST') return failure(404, 'not-found', correlationId);
    if (!request.contentType?.toLowerCase().startsWith('application/json')) {
      return failure(415, 'unsupported-content-type', correlationId);
    }
    const token = bearer(request.authorization);
    if (!token) return failure(401, 'authentication-failed', correlationId);
    if (Buffer.byteLength(request.body, 'utf8') < 2 || Buffer.byteLength(request.body, 'utf8') > 16 * 1_024) {
      return failure(400, 'invalid-request', correlationId);
    }
    let body: unknown;
    try { body = JSON.parse(request.body) as unknown; } catch { return failure(400, 'invalid-request', correlationId); }
    try {
      if (request.path === '/v1/identity/session') {
        return response(200, parseCommerceIdentitySessionResponse(
          await this.identity.createIdentitySession(
            parseCommerceIdentitySessionRequest(body), token, correlationId,
          ),
        ));
      }
      if (!this.quotes) return failure(503, 'temporarily-unavailable', correlationId);
      return response(200, parseCommerceQuoteResponse(
        await this.quotes.createQuote(parseCommerceQuoteRequest(body), token),
      ));
    } catch (error) {
      if (error instanceof CommerceServiceError) {
        return failure(error.code === 'authentication-failed' ? 401
          : error.code === 'conflict' ? 409 : 503, error.code, correlationId);
      }
      if (error instanceof Error && error.message.startsWith('Invalid commerce service')) {
        return failure(400, 'invalid-request', correlationId);
      }
      return failure(500, 'internal-error', correlationId);
    }
  }
}
