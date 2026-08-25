import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { supabasePoolConfiguration } from '../src/database-config';

const valid = 'postgresql://desky_checkout_runtime.abcdefghijklmnopqrst:'
  + 'encoded%21password@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
const certificate = '-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----\n';
const certificateBase64 = Buffer.from(certificate).toString('base64');
const certificateSha256 = createHash('sha256').update(certificate).digest('hex');
const environment = {
  DESKY_DATABASE_URL: valid,
  DESKY_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  DESKY_DATABASE_CA_BASE64: certificateBase64,
};

describe('hosted Supabase database configuration', () => {
  it('admits only a credentialed Supavisor transaction-pooler URL with TLS verification', () => {
    expect(supabasePoolConfiguration(environment, certificateSha256)).toEqual({
      connectionString: valid,
      ssl: { ca: certificate, rejectUnauthorized: true },
    });
  });

  it.each([
    undefined,
    '',
    `${valid}\n`,
    'postgresql://desky_checkout_runtime.abcdefghijklmnopqrst:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
    'postgresql://desky_checkout_runtime.abcdefghijklmnopqrst:secret@evil.example:6543/postgres',
    'postgresql://desky_checkout_runtime.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres',
    'postgresql://postgres:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
    'postgresql://desky_checkout_runtime.abcdefghijklmnopqrst:secret@aws-0-us-east-1.pooler.supabase.com:6543/other',
    `${valid}?sslmode=disable`,
  ])('rejects unsafe or ambiguous database configuration', (candidate) => {
    expect(() => supabasePoolConfiguration({
      ...environment,
      DESKY_DATABASE_URL: candidate,
    }, certificateSha256))
      .toThrow('Hosted checkout database is not configured.');
  });

  it('rejects a connection for a different Supabase project', () => {
    expect(() => supabasePoolConfiguration({
      ...environment,
      DESKY_SUPABASE_PROJECT_REF: 'zyxwvutsrqponmlkjihg',
    }, certificateSha256)).toThrow('Hosted checkout database is not configured.');
  });

  it('rejects a missing or unadmitted database certificate', () => {
    expect(() => supabasePoolConfiguration({
      ...environment,
      DESKY_DATABASE_CA_BASE64: undefined,
    }, certificateSha256)).toThrow('Hosted checkout database is not configured.');
    expect(() => supabasePoolConfiguration(environment, '0'.repeat(64)))
      .toThrow('Hosted checkout database is not configured.');
  });

  it('never includes the submitted secret in an error', () => {
    const secret = 'do-not-disclose-this-password';
    expect(() => supabasePoolConfiguration({
      ...environment,
      DESKY_DATABASE_URL: `postgresql://postgres:${secret}@evil.example:6543/postgres`,
    }, certificateSha256)).toThrow('Hosted checkout database is not configured.');
  });
});
