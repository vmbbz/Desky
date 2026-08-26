export const secureTransportFailureCodes = [
  'tls-certificate-expired',
  'tls-certificate-not-yet-valid',
  'tls-certificate-untrusted',
  'tls-hostname-mismatch',
  'tls-handshake-invalid',
] as const;

export type SecureTransportFailureCode = (typeof secureTransportFailureCodes)[number];

export class SecureTransportError extends Error {
  constructor(
    message: string,
    readonly code: SecureTransportFailureCode,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'SecureTransportError';
  }
}

const untrustedCertificateCodes = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_UNTRUSTED',
]);

const invalidHandshakeCodes = new Set([
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_UNSUPPORTED_PROTOCOL',
  'ERR_TLS_PROTOCOL_VERSION_CONFLICT',
  'ERR_TLS_REQUIRED_SERVER_NAME',
]);

function errorCodeChain(error: unknown): string[] {
  const codes: string[] = [];
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) break;
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === 'string') codes.push(record.code);
    current = record.cause;
  }
  return codes;
}

export function secureTransportError(
  service: 'OpenClaw' | 'Hermes',
  error: unknown,
): SecureTransportError | undefined {
  const codes = errorCodeChain(error);
  if (codes.includes('CERT_HAS_EXPIRED')) {
    return new SecureTransportError(
      `${service} TLS certificate is expired.`,
      'tls-certificate-expired',
    );
  }
  if (codes.includes('CERT_NOT_YET_VALID')) {
    return new SecureTransportError(
      `${service} TLS certificate is not valid yet.`,
      'tls-certificate-not-yet-valid',
    );
  }
  if (codes.includes('ERR_TLS_CERT_ALTNAME_INVALID')) {
    return new SecureTransportError(
      `${service} TLS certificate does not match the endpoint.`,
      'tls-hostname-mismatch',
    );
  }
  if (codes.some((code) => untrustedCertificateCodes.has(code))) {
    return new SecureTransportError(
      `${service} TLS certificate is not trusted.`,
      'tls-certificate-untrusted',
    );
  }
  if (codes.some((code) => invalidHandshakeCodes.has(code))) {
    return new SecureTransportError(
      `${service} TLS handshake is not supported by the endpoint.`,
      'tls-handshake-invalid',
    );
  }
  return undefined;
}

export function isTerminalSecureTransportError(error: unknown): boolean {
  return error instanceof SecureTransportError && !error.retryable;
}
