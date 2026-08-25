import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const hostedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(hostedRoot, '..', '..');

describe('hosted checkout deployment boundary', () => {
  it('keeps the page same-origin, unframeable, and free of third-party script allowances', async () => {
    const configuration = await readFile(resolve(repositoryRoot, 'netlify.toml'), 'utf8');
    expect(configuration).toContain("script-src 'self'");
    expect(configuration).toContain("connect-src 'self'");
    expect(configuration).toContain("frame-ancestors 'none'");
    expect(configuration).toContain('Permissions-Policy');
    expect(configuration).not.toMatch(/script-src[^\n]*https:/);
    expect(configuration).not.toContain("'unsafe-inline'");
    expect(configuration).not.toContain("'unsafe-eval'");
  });

  it('emits hashed local assets and no inline executable content', async () => {
    const document = await readFile(resolve(hostedRoot, 'dist/site/index.html'), 'utf8');
    const assets = await readdir(resolve(hostedRoot, 'dist/site/assets'));
    expect(document).toMatch(/<script type="module" src="\/assets\/browser-[A-Z0-9]+\.js"><\/script>/);
    expect(document).toMatch(/<link rel="stylesheet" href="\/assets\/browser-[A-Z0-9]+\.css">/);
    expect(document).not.toMatch(/<script(?:\s[^>]*)?>\s*[^<]/);
    expect(assets.some((name) => /^browser-[A-Z0-9]+\.js$/.test(name))).toBe(true);
    expect(assets.some((name) => /^browser-[A-Z0-9]+\.css$/.test(name))).toBe(true);
  });

  it('never provisions raw wallet or browser-secret columns', async () => {
    const migration = await readFile(resolve(repositoryRoot,
      'netlify/database/migrations/0001_checkout_ledger.sql',
    ), 'utf8');
    expect(migration).not.toMatch(/private[_ ]?key|seed[_ ]?phrase|wallet[_ ]?signature/i);
    expect(migration).not.toMatch(/binding[_ ]?verifier|csrf[_ ]?token|cookie[_ ]?credential/i);
    expect(migration).toContain('payment_attempts_one_active_per_order');
    expect(migration).toContain('UNIQUE (provider, network, payment_identifier)');
  });
});
