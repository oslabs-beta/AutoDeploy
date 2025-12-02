import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

// Central Postgres connection pool for the entire backend.
//
// Why a pool?
// - Reuses TCP connections instead of opening a new one per query.
// - Limits max concurrent connections so we don’t overload the DB.
// - Handles idle timeouts & connection timeouts for us.

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '8', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on('error', (err) =>
  console.error('[DB] Unexpected error on idle client', err)
);

// Tiny helper to run a parameterized query using the shared pool.
//
// Example:
//   const { rows } = await query('select * from users where id = $1', [userId]);
//
// It also logs query duration in non‑production environments to help
// track slow queries during development.

export async function query(sql, params = []) {
  const start = Date.now();
  const res = await pool.query(sql, params);
  const ms = Date.now() - start;

  if (process.env.NODE_ENV !== 'production') {
    console.log(`SQL ${ms}ms: `, sql, params);
  }
  return res;
}

export async function healthCheck() {
  const rows = await query('select 1 as ok');
  return rows?.[0]?.ok === 1;
}
