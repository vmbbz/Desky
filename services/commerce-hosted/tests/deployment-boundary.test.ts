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
    const document = await readFile(resolve(hostedRoot, 'dist/site/checkout.html'), 'utf8');
    const marketing = await readFile(resolve(hostedRoot, 'dist/site/index.html'), 'utf8');
    const assets = await readdir(resolve(hostedRoot, 'dist/site/assets'));
    expect(document).toMatch(/<script type="module" src="\/assets\/browser-[A-Z0-9]+\.js"><\/script>/);
    expect(document).toMatch(/<link rel="stylesheet" href="\/assets\/browser-[A-Z0-9]+\.css">/);
    expect(document).not.toMatch(/<script(?:\s[^>]*)?>\s*[^<]/);
    expect(assets.some((name) => /^browser-[A-Z0-9]+\.js$/.test(name))).toBe(true);
    expect(assets.some((name) => /^browser-[A-Z0-9]+\.css$/.test(name))).toBe(true);
    expect(document).toMatch(/<img class="brand-lockup" src="\/assets\/desky-lockup-on-dark-[A-F0-9]+\.svg" alt="Deskii">/);
    expect(document).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/assets\/desky-favicon-[A-F0-9]+\.svg">/);
    expect(document).toMatch(/<link rel="alternate icon" type="image\/png" sizes="32x32" href="\/assets\/desky-favicon-32-[A-F0-9]+\.png">/);
    expect(document).toMatch(/<link rel="apple-touch-icon" sizes="256x256" href="\/assets\/desky-touch-icon-[A-F0-9]+\.png">/);
    expect(assets.some((name) => /^desky-lockup-on-dark-[A-F0-9]+\.svg$/.test(name))).toBe(true);
    expect(assets.some((name) => /^desky-favicon-[A-F0-9]+\.svg$/.test(name))).toBe(true);
    expect(document).not.toContain('class="brand-mark"');
    expect(document).toContain('Connect MetaMask');
    expect(document).toContain('Connecting a wallet does not approve or send payment.');
    expect(document).not.toContain('Connect wallet and pay');
    expect(marketing).toContain('<title>Deskii — Give your agent somewhere to be.</title>');
    expect(marketing).toContain('Your agent has a <em>place</em> to be.');
    expect(marketing).toContain('href="/assets/marketing-');
    expect(marketing).toContain('/assets/desky-lockup-on-light-');
    expect(marketing).toContain('desky-hero-school-desk-');
    expect(marketing).toContain('desky-through-the-screen-');
    expect(marketing).toContain('OpenClaw');
    expect(marketing).toContain('XEON Protocol (Pty) Ltd.');
    expect(marketing).toContain('Microsoft Store');
    expect(marketing).toContain('Free edition');
    expect(marketing).toContain('Direct edition');
    expect(marketing).toContain('Store commerce, if admitted later, ships as a new certified update');
    expect(marketing).not.toMatch(/<script(?:\s[^>]*)?>\s*[^<]/);
  });

  it('never provisions raw wallet or browser-secret columns', async () => {
    const ledgerMigration = await readFile(resolve(repositoryRoot,
      'supabase/migrations/20260825000100_checkout_ledger.sql',
    ), 'utf8');
    const identityMigration = await readFile(resolve(repositoryRoot,
      'supabase/migrations/20260825000200_identity_operations.sql',
    ), 'utf8');
    const migration = `${ledgerMigration}\n${identityMigration}`;
    expect(migration).not.toMatch(/private[_ ]?key|seed[_ ]?phrase|wallet[_ ]?signature/i);
    expect(migration).not.toMatch(/binding[_ ]?verifier|csrf[_ ]?token|cookie[_ ]?credential/i);
    expect(migration).toContain('payment_attempts_one_active_per_order');
    expect(migration).toContain('UNIQUE (provider, network, payment_identifier)');
    expect(migration).toContain('CREATE SCHEMA desky_commerce');
    expect(migration).toContain('REVOKE ALL ON SCHEMA desky_commerce FROM PUBLIC');
    expect(migration).toContain('CREATE ROLE desky_checkout_runtime');
    expect(identityMigration).toContain('provider_subject_digest');
    expect(identityMigration).toContain('credential_digest');
    expect(identityMigration).not.toMatch(/provider_subject\s+text|recovery_code|refresh_credential/i);
  });

  it('keeps operator backup, reconciliation, and monitoring isolated from public browser routes', async () => {
    const server = await readFile(resolve(hostedRoot, 'src/server.ts'), 'utf8');
    const monitor = await readFile(resolve(hostedRoot,
      'netlify/functions/commerce-monitor.ts'), 'utf8');
    expect(server).toContain("requiredEnvironment('DESKY_COMMERCE_OPERATOR_TOKEN')");
    expect(server).toContain("createCipheriv('aes-256-gcm'");
    expect(server).toContain('reconciliationQueue');
    expect(monitor).toContain("schedule: '*/15 * * * *'");
    expect(monitor).not.toContain('path:');
  });

  it('keeps PostgreSQL and hosted-database dependencies out of Electron manifests', async () => {
    const rootManifest = JSON.parse(await readFile(
      resolve(repositoryRoot, 'package.json'), 'utf8',
    )) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const rootDependencies = {
      ...rootManifest.dependencies,
      ...rootManifest.devDependencies,
    };
    expect(rootDependencies).not.toHaveProperty('pg');
    expect(rootDependencies).not.toHaveProperty('@netlify/database');

    const server = await readFile(resolve(hostedRoot, 'src/server.ts'), 'utf8');
    expect(server).toContain("supabasePoolConfiguration()");
    expect(server).not.toContain('@netlify/database');
    expect(server).not.toContain('getConnectionString');
  });
});
