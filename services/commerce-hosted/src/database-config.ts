import { createHash } from 'node:crypto';

import type { PoolConfig } from 'pg';

const supabasePoolerHost = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pooler\.supabase\.com$/;
const supabasePoolerUser = /^[a-z][a-z0-9_]{0,62}\.[a-z0-9]{20}$/;
const supabaseRoot2021Sha256 = '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';

function unavailable(): never {
  throw new Error('Hosted checkout database is not configured.');
}

export function supabasePoolConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  acceptedCaSha256 = supabaseRoot2021Sha256,
): Pick<PoolConfig, 'connectionString' | 'ssl'> {
  const connectionString = environment.DESKY_DATABASE_URL;
  if (!connectionString
    || connectionString.trim() !== connectionString
    || /[\r\n]/.test(connectionString)) {
    return unavailable();
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return unavailable();
  }

  let username: string;
  try {
    username = decodeURIComponent(parsed.username);
  } catch {
    return unavailable();
  }

  const projectRef = environment.DESKY_SUPABASE_PROJECT_REF;
  const encodedCa = environment.DESKY_DATABASE_CA_BASE64;
  if (!encodedCa || encodedCa.length > 8_192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedCa)) {
    return unavailable();
  }
  const caBuffer = Buffer.from(encodedCa, 'base64');
  if (caBuffer.toString('base64') !== encodedCa
    || createHash('sha256').update(caBuffer).digest('hex') !== acceptedCaSha256) {
    return unavailable();
  }
  const ca = caBuffer.toString('utf8');
  if (!/^-----BEGIN CERTIFICATE-----\n[\s\S]+\n-----END CERTIFICATE-----\r?\n?$/.test(ca)) {
    return unavailable();
  }

  if ((parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:')
    || !supabasePoolerHost.test(parsed.hostname)
    || parsed.port !== '6543'
    || parsed.pathname !== '/postgres'
    || parsed.search !== ''
    || parsed.hash !== ''
    || !supabasePoolerUser.test(username)
    || !projectRef
    || !/^[a-z0-9]{20}$/.test(projectRef)
    || !username.endsWith(`.${projectRef}`)
    || parsed.password.length === 0) {
    return unavailable();
  }

  return {
    connectionString,
    ssl: { ca, rejectUnauthorized: true },
  };
}
