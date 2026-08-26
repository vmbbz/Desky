import {
  parseCleanDeviceRestoreRequest,
  parseCommerceSessionMaterial,
  parseCommerceSessionRefreshRequest,
  type CleanDeviceRestoreRequest,
  type CommerceSessionMaterial,
  type CommerceSessionRefreshRequest,
} from '../../shared/commerce-recovery';
import {
  parseCommerceCheckoutSession,
  parseCommerceCheckoutSessionRequest,
  parseCreateCommerceCheckoutRequest,
  type CommerceCheckoutSession,
  type CommerceCheckoutSessionRequest,
  type CreateCommerceCheckoutRequest,
} from '../../shared/commerce-checkout';

export interface CommerceSessionApplicationService {
  restoreCleanDevice(request: CleanDeviceRestoreRequest): Promise<CommerceSessionMaterial>;
  refreshSession(request: CommerceSessionRefreshRequest): Promise<CommerceSessionMaterial>;
}

export interface CommerceCheckoutApplicationService {
  createSession(
    request: CreateCommerceCheckoutRequest,
    accessToken: string,
  ): Promise<CommerceCheckoutSession>;
  getSession(
    request: CommerceCheckoutSessionRequest,
    accessToken: string,
  ): Promise<CommerceCheckoutSession>;
  cancelSession(
    request: CommerceCheckoutSessionRequest,
    accessToken: string,
  ): Promise<CommerceCheckoutSession>;
}

export interface CommerceHttpRequest {
  method: string;
  path: string;
  contentType: string | undefined;
  body: string;
  correlationId: string;
  authorization?: string;
}

export interface CommerceHttpResponse {
  status: 200 | 400 | 401 | 404 | 409 | 415 | 500 | 503;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export type CommerceServiceErrorCode =
  | 'authentication-failed'
  | 'conflict'
  | 'temporarily-unavailable';

export class CommerceServiceError extends Error {
  constructor(readonly code: CommerceServiceErrorCode) {
    super(code);
  }
}

export interface CommerceInternalErrorContext {
  path: string;
  correlationId: string;
}

export type CommerceInternalErrorReporter = (
  error: Error,
  context: CommerceInternalErrorContext,
) => void;

const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const checkoutPaths = [
  '/v1/checkout/session',
  '/v1/checkout/session/status',
  '/v1/checkout/session/cancel',
] as const;
type CheckoutPath = (typeof checkoutPaths)[number];

function bearerCredential(value: string | undefined): string | undefined {
  if (!value?.startsWith('Bearer ')) return undefined;
  const credential = value.slice('Bearer '.length);
  if (credential.length < 32 || credential.length > 8_192 || /[\r\n\s]/.test(credential)) {
    return undefined;
  }
  return credential;
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

function errorResponse(
  status: Exclude<CommerceHttpResponse['status'], 200>,
  code: string,
  correlationId: string,
): CommerceHttpResponse {
  return response(status, { schemaVersion: 1, error: code, correlationId });
}

/**
 * Framework-neutral hosted API boundary. The deployment adapter supplies TLS, request-size
 * enforcement before buffering, rate limiting, identity-provider callbacks, and structured audit.
 */
export class CommerceHttpApi {
  constructor(
    private readonly sessions: CommerceSessionApplicationService,
    private readonly checkouts?: CommerceCheckoutApplicationService,
    private readonly reportInternalError?: CommerceInternalErrorReporter,
  ) {}

  async handle(request: CommerceHttpRequest): Promise<CommerceHttpResponse> {
    const correlationId = identifierPattern.test(request.correlationId)
      ? request.correlationId : 'correlation:invalid';
    if (request.method !== 'POST') return errorResponse(404, 'not-found', correlationId);
    const isSessionPath = request.path === '/v1/session/restore'
      || request.path === '/v1/session/refresh';
    const isCheckoutPath = checkoutPaths.includes(request.path as CheckoutPath);
    if (!isSessionPath && !isCheckoutPath) {
      return errorResponse(404, 'not-found', correlationId);
    }
    if (isCheckoutPath && !this.checkouts) return errorResponse(404, 'not-found', correlationId);
    if (!request.contentType?.toLowerCase().startsWith('application/json')) {
      return errorResponse(415, 'unsupported-content-type', correlationId);
    }
    if (Buffer.byteLength(request.body, 'utf8') === 0
      || Buffer.byteLength(request.body, 'utf8') > 16 * 1_024) {
      return errorResponse(400, 'invalid-request', correlationId);
    }
    let body: unknown;
    try {
      body = JSON.parse(request.body) as unknown;
    } catch {
      return errorResponse(400, 'invalid-request', correlationId);
    }
    try {
      if (isCheckoutPath) {
        const accessToken = bearerCredential(request.authorization);
        if (!accessToken) return errorResponse(401, 'authentication-failed', correlationId);
        const checkout = this.checkouts;
        if (!checkout) return errorResponse(404, 'not-found', correlationId);
        const session = request.path === '/v1/checkout/session'
          ? await checkout.createSession(parseCreateCommerceCheckoutRequest(body), accessToken)
          : request.path === '/v1/checkout/session/status'
            ? await checkout.getSession(parseCommerceCheckoutSessionRequest(body), accessToken)
            : await checkout.cancelSession(parseCommerceCheckoutSessionRequest(body), accessToken);
        return response(200, parseCommerceCheckoutSession(session));
      }
      const material = request.path === '/v1/session/restore'
        ? await this.sessions.restoreCleanDevice(parseCleanDeviceRestoreRequest(body))
        : await this.sessions.refreshSession(parseCommerceSessionRefreshRequest(body));
      return response(200, parseCommerceSessionMaterial(material));
    } catch (error) {
      if (error instanceof CommerceServiceError) {
        if (error.code === 'authentication-failed') {
          return errorResponse(401, error.code, correlationId);
        }
        if (error.code === 'conflict') return errorResponse(409, error.code, correlationId);
        return errorResponse(503, error.code, correlationId);
      }
      if (error instanceof Error && error.message.startsWith('Invalid commerce recovery')) {
        return errorResponse(400, 'invalid-request', correlationId);
      }
      if (error instanceof Error && error.message.startsWith('Invalid commerce checkout')) {
        return errorResponse(400, 'invalid-request', correlationId);
      }
      if (error instanceof Error && this.reportInternalError) {
        try {
          this.reportInternalError(error, { path: request.path, correlationId });
        } catch {
          // Observability must never change the fail-closed HTTP result.
        }
      }
      return errorResponse(500, 'internal-error', correlationId);
    }
  }
}
