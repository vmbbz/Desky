import {
  readCommerceAccessTokenKeyId,
  verifyCommerceAccessToken,
  type CommerceAccessTokenClaims,
} from './access-token';
import type { RotatingCommerceJwks } from './jwks';

export interface CommerceAccessAuthorityPolicy {
  issuer: string;
  audience: 'desky-assets';
  jwks: RotatingCommerceJwks;
  maximumLifetimeSeconds?: number;
  clockSkewSeconds?: number;
}

export async function verifyCommerceAccessTokenWithAuthority(
  token: string,
  policy: CommerceAccessAuthorityPolicy,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<CommerceAccessTokenClaims> {
  const keyId = readCommerceAccessTokenKeyId(token);
  const keys = await policy.jwks.getKeys(keyId, nowSeconds);
  return verifyCommerceAccessToken(token, {
    issuer: policy.issuer,
    audience: policy.audience,
    keys,
    maximumLifetimeSeconds: policy.maximumLifetimeSeconds,
    clockSkewSeconds: policy.clockSkewSeconds,
  }, nowSeconds);
}
