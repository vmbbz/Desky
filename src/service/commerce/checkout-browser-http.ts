import {
  CommerceServiceError,
} from './http-api';
import type {
  HostedCheckoutBrowserService,
  CommerceBrowserCheckoutMaterial,
} from './checkout-browser-service';

export interface CheckoutBrowserHttpRequest {
  method: string;
  path: string;
  contentType?: string;
  body: string;
  origin?: string;
  cookie?: string;
  csrfToken?: string;
  secFetchSite?: string;
  correlationId: string;
}

export interface CheckoutBrowserHttpResponse {
  status: 200 | 400 | 401 | 404 | 409 | 415 | 500 | 503;
  headers: Readonly<Record<string, string>>;
  body: string;
}

const paths = [
  '/v1/browser/bootstrap',
  '/v1/browser/resume',
  '/v1/browser/submit',
] as const;
const identifierPattern = /^[a-z0-9][a-z0-9._:-]{0,127}$/;

function response(
  status: CheckoutBrowserHttpResponse['status'],
  body: unknown,
  setCookie?: string,
): CheckoutBrowserHttpResponse {
  return {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'content-type': 'application/json; charset=utf-8',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      ...(setCookie ? { 'set-cookie': setCookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

function publicMaterial(material: CommerceBrowserCheckoutMaterial) {
  return {
    schemaVersion: 1,
    session: material.session,
    csrfToken: material.csrfToken,
    view: material.view,
    paymentRequirements: material.paymentRequirements,
    resource: material.resource,
  };
}

function errorResponse(
  status: Exclude<CheckoutBrowserHttpResponse['status'], 200>,
  code: string,
  correlationId: string,
) {
  return response(status, { schemaVersion: 1, error: code, correlationId });
}

/** Fixed same-origin JSON adapter for the separately hosted checkout page. */
export class CheckoutBrowserHttpApi {
  constructor(private readonly browser: HostedCheckoutBrowserService) {}

  async handle(request: CheckoutBrowserHttpRequest): Promise<CheckoutBrowserHttpResponse> {
    const correlationId = identifierPattern.test(request.correlationId)
      ? request.correlationId : 'correlation:invalid';
    if (request.method !== 'POST' || !paths.includes(request.path as (typeof paths)[number])) {
      return errorResponse(404, 'not-found', correlationId);
    }
    if (!request.contentType?.toLowerCase().startsWith('application/json')) {
      return errorResponse(415, 'unsupported-content-type', correlationId);
    }
    const size = Buffer.byteLength(request.body, 'utf8');
    if (size === 0 || size > 32 * 1_024) {
      return errorResponse(400, 'invalid-request', correlationId);
    }
    let body: unknown;
    try { body = JSON.parse(request.body) as unknown; } catch {
      return errorResponse(400, 'invalid-request', correlationId);
    }
    const context = {
      origin: request.origin,
      cookie: request.cookie,
      csrfToken: request.csrfToken,
      secFetchSite: request.secFetchSite,
    };
    try {
      const material = request.path === '/v1/browser/bootstrap'
        ? await this.browser.bootstrap(body, context)
        : request.path === '/v1/browser/resume'
          ? await this.browser.resume(body, context)
          : await this.browser.submit(body, context);
      return response(200, publicMaterial(material), material.setCookie);
    } catch (error) {
      if (error instanceof CommerceServiceError) {
        if (error.code === 'authentication-failed') {
          return errorResponse(401, error.code, correlationId);
        }
        if (error.code === 'conflict') return errorResponse(409, error.code, correlationId);
        return errorResponse(503, error.code, correlationId);
      }
      if (error instanceof Error && (error.message.startsWith('Invalid commerce browser')
        || error.message.startsWith('Invalid Base Sepolia x402'))) {
        return errorResponse(400, 'invalid-request', correlationId);
      }
      return errorResponse(500, 'internal-error', correlationId);
    }
  }
}
