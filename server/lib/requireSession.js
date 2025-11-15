import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

export async function requireSession(req, res, next) {
  try {
    const raw = req.cookies?.mcp_session;
    if (!raw) return res.status(401).json({ error: 'No session' });

    // Decode JWT (backward compatible)
    let decoded;
    try {
      decoded = jwt.verify(raw, process.env.JWT_SECRET);
    } catch (e) {
      console.error('[requireSession] JWT verify failed:', e.message);
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Resolve user_id (supports old and new token formats)
    const resolvedUserId =
      decoded.user_id ||   // new
      decoded.id ||        // old
      null;

    if (!resolvedUserId) {
      console.warn('[requireSession] No user_id in JWT payload:', decoded);
      req.user = decoded;
      return next();
    }

    // Inject Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    );
    req.supabase = supabase;

    // Load user from Supabase
    const { data: dbUser, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', resolvedUserId)
      .single();

    if (userErr || !dbUser) {
      console.warn('[requireSession] User not found in DB:', resolvedUserId);
      req.user = { ...decoded, user_id: resolvedUserId };
      return next();
    }

    // Merge decoded token + database user
    req.user = {
      ...decoded,
      ...dbUser,
      user_id: resolvedUserId,
    };

    return next();
  } catch (err) {
    console.error('[requireSession] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal authentication error' });
  }
}
