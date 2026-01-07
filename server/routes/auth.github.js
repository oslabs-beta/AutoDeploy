// GitHub OAuth routes: start login, handle callback and expose /me info
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { createState, consumeState } from '../lib/state.js';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchGithubUser,
  fetchPrimaryEmail,
} from '../lib/github-oauth.js';
import { query } from '../db.js';

// Basic sanity check to make sure required GitHub OAuth env vars are set
const {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_OAUTH_REDIRECT_URI,
  GITHUB_OAUTH_SCOPES,
  JWT_SECRET,
  BETA_AUTO_BETA_PRO,
} = process.env;

// During beta, automatically grant `beta_pro_granted` to users created via
// GitHub OAuth when this flag is true. Mirrors the local auth behavior.
const AUTO_BETA_PRO = BETA_AUTO_BETA_PRO === 'true';

// URL to redirect user to the apropiate endpoint after GitHub authentication success
const FRONTEND_URL =
  process.env.FRONTEND_URL || 'http://localhost:5173/connect';

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_OAUTH_REDIRECT_URI) {
  console.warn('[WARN] Missing GitHub OAuth env vars');
}

const router = Router();

// Redirect the user to the GitHub OAuth consent screen
router.get('/start', (req, res) => {
  const state = createState(req.query.redirect_to || '/');
  res.cookie('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60 * 1000,
  });
  const url = buildAuthorizeUrl({
    clientId: GITHUB_CLIENT_ID,
    redirectUri: GITHUB_OAUTH_REDIRECT_URI,
    scopes: GITHUB_OAUTH_SCOPES || 'repo workflow read:user user:email',
    state,
  });
  return res.redirect(url);
});

// GitHub OAuth callback – exchange code for token, upsert user, set session cookie
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    const stateCookie = req.cookies?.oauth_state;

    // If the user is already logged in (local auth), link GitHub to that account
    // instead of creating/switching the session to the GitHub email identity.
    let existingSessionUserId = null;
    const existingSession = req.cookies?.mcp_session;
    if (existingSession && JWT_SECRET) {
      try {
        const decoded = jwt.verify(existingSession, JWT_SECRET);
        existingSessionUserId = decoded?.user_id || decoded?.id || null;
      } catch {
        existingSessionUserId = null;
      }
    }

    // If GitHub sent back an error (e.g., access_denied), show it
    if (error) {
      console.error('[OAuth callback] GitHub error:', {
        error,
        error_description,
      });
      return res
        .status(400)
        .send(`GitHub OAuth error: ${error} ${error_description || ''}`);
    }

    // Check CSRF state
    if (!code || !state || state !== stateCookie) {
      console.error('[OAuth callback] Invalid state', {
        got_state: state,
        cookie_state: stateCookie,
      });
      return res.status(400).send('Invalid OAuth state');
    }

    // Log the redirect URI used (helps catch mismatches)
    console.log(
      '[OAuth callback] Using redirectUri:',
      GITHUB_OAUTH_REDIRECT_URI
    );

    // Exchange code -> token (form-encoded is the most bulletproof)
    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code: String(code),
          redirect_uri: GITHUB_OAUTH_REDIRECT_URI, // must match /start + GitHub app config
        }),
      }
    );

    const tokenJson = await tokenRes.json().catch(() => ({}));
    console.log('[OAuth] Token exchange status:', tokenRes.status, tokenJson);

    if (!tokenRes.ok || !tokenJson.access_token) {
      // Common causes: redirect_uri mismatch, bad client secret, code reused/expired
      return res
        .status(400)
        .send(
          `Token exchange failed: ${tokenRes.status} ${JSON.stringify(
            tokenJson
          )}`
        );
    }

    const accessToken = tokenJson.access_token;

    // fetch GitHub user + primary email
    const ghUser = await fetchGithubUser(accessToken);
    const email =
      (await fetchPrimaryEmail(accessToken)) || ghUser.email || null;

    let user;

    if (existingSessionUserId) {
      // Logged-in linking flow: keep existing session/user email.
      const { rows: userRows } = await query(
        `
        update users
        set github_username = $2
        where id = $1
        returning *;
        `,
        [existingSessionUserId, ghUser.login]
      );
      user = userRows[0];

      if (!user?.id) {
        // Fallback: if the session references a non-existent user, revert to normal flow.
        existingSessionUserId = null;
      }
    }

    if (!existingSessionUserId) {
      // Normal OAuth flow: create/upsert a user identity based on GitHub email.
      // New users created here can be granted beta_pro_granted during beta.
      const { rows: userRows } = await query(
        `
        insert into users (email, github_username, beta_pro_granted)
        values ($1, $2, $3)
        on conflict (email) do update set github_username = excluded.github_username
        returning *;
        `,
        [email, ghUser.login, AUTO_BETA_PRO]
      );
      user = userRows[0];
    }

    // Upsert connection (store token)
    await query(
      `
      insert into connections (user_id, provider, access_token, created_at)
      values ($1, 'github', $2, now())
      on conflict (user_id, provider)
      do update set access_token = excluded.access_token, created_at = now();
      `,
      [user.id, accessToken]
    );

    res.clearCookie('oauth_state');

    // Only issue/overwrite the session cookie when the user is not already logged in.
    if (!existingSessionUserId) {
      const jwtPayload = {
        user_id: user.id,
        github_username: ghUser.login,
        email,
      };
      if (!JWT_SECRET) {
        console.error('[OAuth callback] Missing JWT_SECRET');
        return res.status(500).send('Server misconfigured: JWT_SECRET missing');
      }
      const jwtToken = jwt.sign(jwtPayload, JWT_SECRET, { expiresIn: '10h' });

      res.cookie('mcp_session', jwtToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 10 * 60 * 60 * 1000, // 10h
        // secure: true, // enable on HTTPS
      });
    }

    return res.redirect(FRONTEND_URL);
  } catch (e) {
    console.error('[OAuth callback] error:', e);
    return res.status(500).send(`OAuth failed: ${e.message}`);
  }
});
// Convinience endpoint to inspect the most recent GitHub connection + libe /user data
router.get('/me', async (req, res) => {
  try {
    const { rows } = await query(`
      select c.*, u.email, u.github_username
      from connections c
      join users u on u.id = c.user_id
      where c.provider = 'github'
      order by coalesce(c.updated_at, c.created_at) desc
      limit 1;
      `);
    if (!rows.length)
      return res.status(404).json({ error: 'No GitHub connections' });

    const conn = rows[0];
    const ghRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    const ghUser = await ghRes.json();
    return res.json({
      db_user: { email: conn.email, github_username: conn.github_username },
      github_user: ghUser,
    });
  } catch (e) {
    console.error('[ERROR] /auth/github/me failed:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
