import { query } from '../db.js';

export async function getGithubAccessTokenForUser(userId) {
  if (!userId) return null;

  try {
    const { rows } = await query(
      `SELECT access_token
             FROM connections 
             WHERE user_id = $1 AND provider = 'github'
             ORDER BY created_at DESC
             LIMIT 1`,
      [userId]
    );
    if (rows?.length && rows[0].access_token) return rows[0].access_token;
  } catch (_) {}
  return null;
}
