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

const {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_OAUTH_REDIRECT_URI,
  GITHUB_OAUTH_SCOPES,
  JWT_SECRET,
} = process.env;

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_OAUTH_REDIRECT_URI) {
  console.warn('[WARN] Missing GitHub OAuth env vars');
}

const router = Router();

/** Step 1: redirect to GitHub */
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

// router.get('/callback', async (req, res) => {
//   try {
//     const { code, state } = req.query;
//     const stateCookie = req.cookies?.oauth_state;
//     if (!code || !state || state !== stateCookie) {
//       return res.status(400).send('Invalid OAuth state');
//     }

//     // 1) exchange code for access token
//     const tokenResp = await exchangeCodeForToken({
//       clientId: GITHUB_CLIENT_ID,
//       clientSecret: GITHUB_CLIENT_SECRET,
//       code,
//       redirectUri: GITHUB_OAUTH_REDIRECT_URI,
//     });
//     const accessToken = tokenResp.access_token;

//     // 2) fetch GitHub user + primary email
//     const ghUser = await fetchGithubUser(accessToken);
//     const email =
//       (await fetchPrimaryEmail(accessToken)) || ghUser.email || null;

//     // 3) upsert user
//     const userRows = await query(
//       `
//       insert into users (email, github_username)
//       values ($1, $2)
//       on conflict (email) do update set github_username = excluded.github_username
//       returning *;
//       `,
//       [email, ghUser.login]
//     );
//     const user = userRows[0];

//     // 4) upsert connection (store the NEW token that has 'workflow' scope)
//     await query(
//       `
//       insert into connections (user_id, provider, access_token, created_at)
//       values ($1, 'github', $2, now())
//       on conflict (user_id, provider)
//       do update set access_token = excluded.access_token, created_at = now()
//       returning *;
//       `,
//       [user.id, accessToken]
//     );

//     // 5) issue your app session (JWT) as cookie (mcp_session)
//     const jwtPayload = {
//       user_id: user.id,
//       github_username: ghUser.login,
//       email,
//     };
//     const jwtToken = jwt.sign(jwtPayload, JWT_SECRET, {
//       expiresIn: '10h',
//     });
//     res.clearCookie('oauth_state');
//     res.cookie('mcp_session', jwtToken, {
//       httpOnly: true,
//       sameSite: 'lax',
//       // secure: true // enable when serving over https
//       path: '/',
//       maxAge: 10 * 60 * 1000,
//     });

//     // redirect to your app UI
//     return res.redirect('/'); // or wherever your front-end lives
//   } catch (e) {
//     console.error('[OAuth callback] error:', e);
//     return res.status(500).send('OAuth failed');
//   }
// });

// routes/auth.github.js (replace the existing /callback handler)
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    const stateCookie = req.cookies?.oauth_state;

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

    // 1) exchange code -> token (form-encoded is the most bulletproof)
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

    // 2) fetch GitHub user + primary email
    const ghUser = await fetchGithubUser(accessToken);
    const email =
      (await fetchPrimaryEmail(accessToken)) || ghUser.email || null;

    // 3) upsert user
    const { rows: userRows } = await query(
      `
      insert into users (email, github_username)
      values ($1, $2)
      on conflict (email) do update set github_username = excluded.github_username
      returning *;
      `,
      [email, ghUser.login]
    );
    const user = userRows[0];

    // 4) upsert connection (store token)
    await query(
      `
      insert into connections (user_id, provider, access_token, created_at)
      values ($1, 'github', $2, now())
      on conflict (user_id, provider)
      do update set access_token = excluded.access_token, created_at = now();
      `,
      [user.id, accessToken]
    );

    // 5) issue session cookie
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

    res.clearCookie('oauth_state');
    res.cookie('mcp_session', jwtToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 60 * 1000, // 10h
      // secure: true, // enable on HTTPS
    });

    return res.redirect('/');
  } catch (e) {
    console.error('[OAuth callback] error:', e);
    return res.status(500).send(`OAuth failed: ${e.message}`);
  }
});

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
/** Step 2: callback */
// router.get('/callback', async (req, res) => {
//   const { code, state } = req.query;
//   if (!code || !state) return res.status(400).send('Missing code/state');

//   const stateData = consumeState(state);
//   if (!stateData) return res.status(400).send('Invalid or expired state');

//   try {
//     // Exchange code -> token
//     const token = await exchangeCodeForToken({
//       clientId: GITHUB_CLIENT_ID,
//       clientSecret: GITHUB_CLIENT_SECRET,
//       code,
//       redirectUri: GITHUB_OAUTH_REDIRECT_URI,
//     });

//     if (!token || !token.access_token) {
//       console.error('[OAuth] Invalid token response:', token);
//       return res.status(500).send('OAuth error: invalid token exchange');
//     }

//     const accessToken = token.access_token;
//     const scopes = Array.isArray(token.scope)
//       ? token.scope.join(' ')
//       : String(token.scope || '');

//     // Fetch GH user
//     const ghUser = await fetchGithubUser(accessToken);

//     if (!ghUser || !ghUser.id) {
//       console.error('[OAuth] Failed to fetch GitHub user. Response:', ghUser);
//       return res.status(500).send('OAuth error: failed to fetch GitHub user');
//     }

//     // Email fallback
//     let email = ghUser.email || null;
//     if (!email) email = await fetchPrimaryEmail(accessToken);

//     // Upsert user (unique on email; fallback to noreply)
//     const emailForUpsert = email || `${ghUser.login}@users.noreply.github.com`;
//     const githubUsername = ghUser.login;

//     const { rows: userRows } = await query(
//       `
//       insert into public.users (email, github_username)
//       values ($1, $2)
//       on conflict (email) do update
//         set github_username = excluded.github_username
//       returning *;
//       `,
//       [emailForUpsert, githubUsername]
//     );

//     console.log('[OAuth] userRows returned:', userRows);
//     if (!userRows || !userRows.length) {
//       throw new Error('No user record returned from insert');
//     }

//     const user = userRows[0];

//     // Upsert connection (one per provider per user)
//     const provider = 'github';
//     console.log('[OAuth] ghUser object before inserting connection:', ghUser);
//     const providerAccountId = String(ghUser.id);

//     await query(
//       `
//       insert into public.connections (user_id, provider, provider_account_id, access_token, scopes, updated_at)
//       values ($1, $2, $3, $4, $5, now())
//       on conflict (user_id, provider) do update
//         set provider_account_id = excluded.provider_account_id,
//             access_token        = excluded.access_token,
//             scopes              = excluded.scopes,
//             updated_at          = now();
//       `,
//       [user.id, provider, providerAccountId, accessToken, scopes]
//     );

//     // Create session JWT and set as secure cookie
//     const payload = {
//       user_id: user.id,
//       github_username: user.github_username,
//       email: user.email,
//     };
//     const sessionToken = jwt.sign(payload, SESSION_SECRET, { expiresIn: '1h' });
//     res.cookie('mcp_session', sessionToken, {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === 'production',
//       sameSite: 'lax',
//       maxAge: 60 * 60 * 1000, // 1 hour
//     });

//     const redirectTo = stateData.redirectTo || '/';
//     return res.redirect(redirectTo);
//   } catch (err) {
//     console.error('OAuth callback error:', err);
//     return res.status(500).send('OAuth error');
//   }
// });
