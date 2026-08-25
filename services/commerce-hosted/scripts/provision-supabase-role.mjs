import process from 'node:process';

import pg from 'pg';

const { Pool } = pg;
const projectRef = process.env.DESKY_SUPABASE_PROJECT_REF;
const adminUrl = process.env.DESKY_SUPABASE_ADMIN_URL;
const runtimePassword = process.env.DESKY_RUNTIME_DATABASE_PASSWORD;
const encodedCa = process.env.DESKY_DATABASE_CA_BASE64;

function fail() {
  throw new Error('Supabase runtime-role provisioning is not configured.');
}

if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef)
  || !adminUrl || !runtimePassword || !/^[a-f0-9]{64}$/.test(runtimePassword)
  || !encodedCa || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedCa)) {
  fail();
}

let parsed;
try {
  parsed = new URL(adminUrl);
} catch {
  fail();
}
if ((parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:')
  || parsed.username !== `postgres.${projectRef}`
  || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pooler\.supabase\.com$/.test(parsed.hostname)
  || parsed.port !== '6543' || parsed.pathname !== '/postgres'
  || parsed.search || parsed.hash || !parsed.password) {
  fail();
}

const pool = new Pool({
  connectionString: adminUrl,
  ssl: { ca: Buffer.from(encodedCa, 'base64').toString('utf8'), rejectUnauthorized: true },
  max: 1,
  connectionTimeoutMillis: 10_000,
  application_name: 'desky-commerce-role-provisioning',
});
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`ALTER ROLE desky_checkout_runtime WITH LOGIN PASSWORD '${runtimePassword}'`);
  const result = await client.query(`
    SELECT
      has_schema_privilege('desky_checkout_runtime', 'desky_commerce', 'USAGE') AS runtime_schema,
      has_table_privilege(
        'desky_checkout_runtime',
        'desky_commerce.commerce_orders',
        'SELECT,INSERT,UPDATE'
      ) AS runtime_orders,
      has_schema_privilege('anon', 'desky_commerce', 'USAGE') AS anon_schema,
      has_schema_privilege('authenticated', 'desky_commerce', 'USAGE') AS authenticated_schema,
      has_schema_privilege('service_role', 'desky_commerce', 'USAGE') AS service_schema
  `);
  const row = result.rows[0];
  if (row?.runtime_schema !== true || row.runtime_orders !== true
    || row.anon_schema !== false || row.authenticated_schema !== false
    || row.service_schema !== false) {
    throw new Error('Supabase commerce role privileges do not match the admitted boundary.');
  }
  await client.query('COMMIT');
  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    projectRef,
    runtimeRole: 'desky_checkout_runtime',
    dataApiRolesDenied: true,
  })}\n`);
} catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* retain original error */ }
  throw error;
} finally {
  client.release();
  await pool.end();
}
