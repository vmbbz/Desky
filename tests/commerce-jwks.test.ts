import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  RotatingCommerceJwks,
  parseCommerceJwks,
  type CommerceJwksLoader,
  type CommerceJwksLoadResult,
} from '../src/main/commerce/jwks';

const first = generateKeyPairSync('ed25519');
const second = generateKeyPairSync('ed25519');

function jwk(keyId: string, key = first.publicKey): Record<string, unknown> {
  const exported = key.export({ format: 'jwk' });
  return {
    alg: 'EdDSA',
    crv: 'Ed25519',
    kid: keyId,
    kty: 'OKP',
    use: 'sig',
    x: exported.x,
  };
}

class SequenceLoader implements CommerceJwksLoader {
  calls = 0;

  constructor(private readonly outcomes: Array<CommerceJwksLoadResult | Error>) {}

  async load(): Promise<CommerceJwksLoadResult> {
    const outcome = this.outcomes[Math.min(this.calls, this.outcomes.length - 1)];
    this.calls += 1;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

describe('commerce JWKS rotation', () => {
  it('admits only exact Ed25519 signing JWKs', () => {
    expect(parseCommerceJwks({ keys: [jwk('key:first')] }).get('key:first')?.type).toBe('public');
    expect(() => parseCommerceJwks({ keys: [{ ...jwk('key:first'), alg: 'RS256' }] }))
      .toThrow('key');
    expect(() => parseCommerceJwks({ keys: [jwk('key:first'), jwk('key:first')] }))
      .toThrow('duplicate');
    expect(() => parseCommerceJwks({ keys: [{ ...jwk('key:first'), secret: 'no' }] }))
      .toThrow('key');
  });

  it('refreshes on an unknown key and retains overlap keys supplied by the authority', async () => {
    const loader = new SequenceLoader([
      { keys: parseCommerceJwks({ keys: [jwk('key:first')] }), maxAgeSeconds: 300 },
      {
        keys: parseCommerceJwks({ keys: [jwk('key:first'), jwk('key:second', second.publicKey)] }),
        maxAgeSeconds: 300,
      },
    ]);
    const cache = new RotatingCommerceJwks({ loader });
    expect((await cache.getKeys('key:first', 1_000)).has('key:first')).toBe(true);
    expect((await cache.getKeys('key:second', 1_001)).has('key:second')).toBe(true);
    expect(loader.calls).toBe(2);
  });

  it('uses bounded stale keys during outage and fails after the stale window', async () => {
    const loader = new SequenceLoader([
      { keys: parseCommerceJwks({ keys: [jwk('key:first')] }), maxAgeSeconds: 30 },
      new Error('offline'),
    ]);
    const cache = new RotatingCommerceJwks({ loader, maximumStaleSeconds: 60 });
    await cache.getKeys('key:first', 1_000);
    expect((await cache.getKeys('key:first', 1_031)).has('key:first')).toBe(true);
    await expect(cache.getKeys('key:first', 1_091)).rejects.toThrow('offline');
  });

  it('never admits a locally revoked key even if JWKS publishes it', async () => {
    const cache = new RotatingCommerceJwks({
      loader: new SequenceLoader([{
        keys: parseCommerceJwks({ keys: [jwk('key:first'), jwk('key:second', second.publicKey)] }),
        maxAgeSeconds: 300,
      }]),
      revokedKeyIds: new Set(['key:first']),
    });
    await expect(cache.getKeys('key:first', 1_000)).rejects.toThrow('revoked');
    expect((await cache.getKeys('key:second', 1_000)).has('key:first')).toBe(false);
  });
});
