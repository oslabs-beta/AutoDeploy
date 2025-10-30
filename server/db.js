import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;


console.log("🔐 DB SSL rejectUnauthorized:", process.env.DB_SSL_REJECT_UNAUTHORIZED);
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '8', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ssl: {
    require: true,
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  },
});

pool.on('error', (err) => console.error('[DB] Unexpected error on idle client', err));

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
