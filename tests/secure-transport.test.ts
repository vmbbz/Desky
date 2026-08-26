import { describe, expect, it } from 'vitest';

import {
  isTerminalSecureTransportError,
  secureTransportError,
} from '../src/main/secure-transport';

describe('secure transport failure classification', () => {
  it.each([
    ['CERT_HAS_EXPIRED', 'tls-certificate-expired', 'expired'],
    ['CERT_NOT_YET_VALID', 'tls-certificate-not-yet-valid', 'not valid yet'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls-certificate-untrusted', 'not trusted'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls-hostname-mismatch', 'does not match'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls-handshake-invalid', 'not supported'],
  ] as const)('classifies %s without exposing native certificate detail', (nativeCode, code, message) => {
    const native = Object.assign(new Error('certificate-secret.internal'), { code: nativeCode });
    const error = secureTransportError('OpenClaw', new Error('outer', { cause: native }));
    expect(error).toMatchObject({ code, retryable: false });
    expect(error?.message).toContain(message);
    expect(error?.message).not.toContain('certificate-secret');
    expect(isTerminalSecureTransportError(error)).toBe(true);
  });

  it('leaves ordinary network errors to provider-specific reconnect policy', () => {
    expect(secureTransportError(
      'Hermes',
      Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }),
    )).toBeUndefined();
  });
});
