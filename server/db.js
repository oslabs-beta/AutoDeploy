import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAZ || '8', 10),
  idleTimeoutMillis: 10_00,
  ssl: {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
  },
});

export async function query(sql, params = []) {
  const start = Date.now();
  const res = await pool.query(sql, params);
  const ms = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`SQL ${ms}ms: `, sql, params);
  }
  return res.rows;
}

export async function healthCheck() {
  const rows = await query('select 1 as ok');
  return rows?.[0]?.ok === 1;
}
