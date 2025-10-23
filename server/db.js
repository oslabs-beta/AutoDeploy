import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized:
      process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' ? false : false,
  },
});

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
