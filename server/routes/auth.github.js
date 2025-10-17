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
} = process.env;

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_OAUTH_REDIRECT_URI) {
  console.warn('[WARN] Missing GitHub OAuth env vars');
}

const router = Router();

/** Step 1: redirect to GitHub */
router.get('/start', (req, res) => {
  const state = createState(req.query.redirect_to || '/');
  const url = buildAuthorizeUrl({
    clientId: GITHUB_CLIENT_ID,
    redirectUri: GITHUB_OAUTH_REDIRECT_URI,
    scopes: GITHUB_OAUTH_SCOPES || 'read:user user:email',
    state,
  });
  return res.redirect(url);
});

/** Step 2: callback */
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) return res.status(400).send('Missing code/state');

  const stateData = consumeState(state);
  if (!stateData) return res.status(400).send('Invalid or expired state');

  try {
    // Exchange code -> token
    const token = await exchangeCodeForToken({
      clientId: GITHUB_CLIENT_ID,
      clientSecret: GITHUB_CLIENT_SECRET,
      code,
      redirectUri: GITHUB_OAUTH_REDIRECT_URI,
    });

    const accessToken = token.access_token;
    const scopes = Array.isArray(token.scope)
      ? token.scope.join(' ')
      : String(token.scope || '');

    // Fetch GH user
    const ghUser = await fetchGithubUser(accessToken);

    // Email fallback
    let email = ghUser.email || null;
    if (!email) email = await fetchPrimaryEmail(accessToken);

    // Upsert user (unique on email; fallback to noreply)
    const emailForUpsert = email || `${ghUser.login}@users.noreply.github.com`;
    const githubUsername = ghUser.login;

    const userRows = await query(
      `
      insert into public.users (email, github_username)
      values ($1, $2)
      on conflict (email) do update
        set github_username = excluded.github_username
      returning *;
      `,
      [emailForUpsert, githubUsername]
    );
    const user = userRows[0];

    // Upsert connection (one per provider per user)
    const provider = 'github';
    const providerAccountId = String(ghUser.id);

    await query(
      `
      insert into public.connections (user_id, provider, provider_account_id, access_token, scopes, updated_at)
      values ($1, $2, $3, $4, $5, now())
      on conflict (user_id, provider) do update
        set provider_account_id = excluded.provider_account_id,
            access_token        = excluded.access_token,
            scopes              = excluded.scopes,
            updated_at          = now();
      `,
      [user.id, provider, providerAccountId, accessToken, scopes]
    );

    const redirectTo = stateData.redirectTo || '/';
    return res.redirect(redirectTo);
  } catch (err) {
    console.error('OAuth callback error:', err);
    return res.status(500).send('OAuth error');
  }
});

router.get('/me', async (req, res) => {
  try {
    const rows = await query(`
      select c.*, u.email, u.github_username
      from connections c
      join users u on u.id = c.user_id
      where c.provider = 'github'
      order by c.updated_at desc
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
