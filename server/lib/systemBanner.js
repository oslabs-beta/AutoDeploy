import { pool, query } from '../db.js';

// Lightweight model helpers for system-wide banners shown in the landing SPA.
//
// The corresponding table is expected to look roughly like:
//
//   create table system_banners (
//     id uuid primary key default gen_random_uuid(),
//     message text not null,
//     tone text not null check (tone in ('info','success','warning','error')),
//     active boolean not null default true,
//     sticky boolean not null default true,
//     created_by uuid references users(id),
//     updated_by uuid references users(id),
//     created_at timestamptz not null default now(),
//     updated_at timestamptz not null default now()
//   );
//
// and optionally a partial unique index on active banners:
//
//   create unique index system_banners_one_active
//   on system_banners ((active)) where active = true;
//
// These helpers are defensive and will behave as no-ops if the table/index
// does not exist yet (e.g. in early dev environments).

/** @typedef {'info' | 'success' | 'warning' | 'error'} BannerTone */

/**
 * Shape returned to callers. Keep in sync with the frontend's
 * SystemBannerPayload in autodeploy-landing.
 */
export function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    message: row.message,
    tone: row.tone,
    active: row.active,
    sticky: row.sticky,
  };
}

export async function getActiveSystemBanner() {
  try {
    const { rows } = await query(
      `
      select *
      from system_banners
      where active = true
      order by created_at desc
      limit 1;
      `,
    );

    if (!rows.length) return null;
    return normalizeRow(rows[0]);
  } catch (err) {
    // If the table doesn't exist yet or some other error occurs, log and
    // degrade gracefully so the marketing site never hard-fails.
    console.error('[systemBanner] getActiveSystemBanner error', err.message);
    return null;
  }
}

/**
 * Insert a new active banner and deactivate any existing one. Returns the
 * newly active banner.
 */
export async function upsertActiveSystemBanner({ message, tone, sticky = true }, actingUserId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Deactivate any existing active banner. If the table is missing, this
    // will be caught by the outer catch block.
    await client.query(
      `
      update system_banners
      set active = false, updated_by = $1, updated_at = now()
      where active = true;
      `,
      [actingUserId],
    );

    const { rows } = await client.query(
      `
      insert into system_banners (message, tone, active, sticky, created_by, updated_by)
      values ($1, $2, true, $3, $4, $4)
      returning *;
      `,
      [message, tone, sticky, actingUserId],
    );

    await client.query('COMMIT');
    return normalizeRow(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[systemBanner] upsertActiveSystemBanner error', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function clearActiveSystemBanner(actingUserId) {
  try {
    await query(
      `
      update system_banners
      set active = false, updated_by = $1, updated_at = now()
      where active = true;
      `,
      [actingUserId],
    );
  } catch (err) {
    console.error('[systemBanner] clearActiveSystemBanner error', err.message);
    throw err;
  }
}
