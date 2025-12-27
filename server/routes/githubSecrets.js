import express from 'express';
import { requireSession } from '../lib/requireSession.js';
import { getGithubAccessTokenForUser } from '../lib/github-token.js';
import {
  listRepoSecrets,
  listEnvironmentSecrets,
  upsertRepoSecret,
  upsertEnvironmentSecret,
  getRepoId,
} from '../lib/githubSecrets.js';

const router = express.Router();

const DEFAULT_REQUIRED_SECRETS = ['GITHUB_TOKEN', 'AWS_ROLE_ARN'];

function parseRepoFullName(repoFullName) {
  const [owner, repo] = String(repoFullName || '').split('/');
  if (!owner || !repo) {
    const err = new Error('repoFullName must look like "owner/repo"');
    err.status = 400;
    throw err;
  }
  return { owner, repo };
}

// Check presence of required secrets in a GitHub repo for the current user
router.post('/presence', requireSession, async (req, res) => {
  try {
    const { repoFullName, env, requiredKeys } = req.body || {};

    if (!repoFullName) {
      return res.status(400).json({ error: 'repoFullName is required' });
    }

    const userId = req?.user?.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'No user in session' });
    }

    const token = await getGithubAccessTokenForUser(userId);
    if (!token) {
      return res.status(401).json({ error: 'Missing GitHub token for user' });
    }

    const { owner, repo } = parseRepoFullName(repoFullName);
    const keys =
      Array.isArray(requiredKeys) && requiredKeys.length
        ? requiredKeys
        : DEFAULT_REQUIRED_SECRETS;

    const repoId = await getRepoId({ token, owner, repo });

    // Built-in GitHub secret GITHUB_TOKEN is always available and does not
    // appear in the Actions secrets API, so we treat it as present.
    const repoSecretNames = await listRepoSecrets({ token, owner, repo });

    let envSecretNames = [];
    if (env) {
      try {
        envSecretNames = await listEnvironmentSecrets({
          token,
          repositoryId: repoId,
          environmentName: env,
        });
      } catch (e) {
        if (e.status !== 404) {
          throw e;
        }
        envSecretNames = [];
      }
    }

    const nameSet = new Set([...repoSecretNames, ...envSecretNames]);

    const secrets = keys.map((key) => {
      if (key === 'GITHUB_TOKEN') {
        return { key, present: true };
      }
      return { key, present: nameSet.has(key) };
    });

    return res.json({ secrets, env: env || null });
  } catch (err) {
    console.error('[githubSecrets] /presence error:', err);
    const status = err.status || 500;

    // If GitHub says the token is bad/unauthorized, surface an "all missing"
    // secrets list instead of hard failing the UI. This lets the frontend
    // show that secrets are not present while logs still capture the root
    // cause for debugging.
    if (status === 401 || status === 403) {
      const body = req.body || {};
      const keys =
        Array.isArray(body.requiredKeys) && body.requiredKeys.length
          ? body.requiredKeys
          : DEFAULT_REQUIRED_SECRETS;

      const secrets = keys.map((key) => ({
        // GITHUB_TOKEN is a built-in Actions secret; treat it as present even
        // if our API token is currently unauthorized.
        key,
        present: key === 'GITHUB_TOKEN',
      }));

      return res.status(200).json({
        secrets,
        env: body.env || null,
        githubUnauthorized: true,
      });
    }

    return res.status(status).json({
      error: 'Failed to check GitHub secrets',
      detail: err.message,
    });
  }
});

// Create or update a secret in the repo for the current user
router.post('/upsert', requireSession, async (req, res) => {
  try {
    const { repoFullName, env, key, value } = req.body || {};

    if (!repoFullName || !key) {
      return res
        .status(400)
        .json({ error: 'repoFullName and key are required' });
    }

    // GITHUB_TOKEN is built-in; nothing to create. Mark success.
    if (key === 'GITHUB_TOKEN') {
      return res.json({ ok: true, builtin: true, scope: 'builtin' });
    }

    if (!value) {
      return res.status(400).json({ error: 'value is required' });
    }

    const userId = req?.user?.user_id;
    if (!userId) {
      return res.status(401).json({ error: 'No user in session' });
    }

    const token = await getGithubAccessTokenForUser(userId);
    if (!token) {
      return res.status(401).json({ error: 'Missing GitHub token for user' });
    }

    const { owner, repo } = parseRepoFullName(repoFullName);

    // Prefer environment-scoped secrets when an env is provided; fall back
    // to repo-level secrets if the environment does not exist or the API
    // call fails with a 404.
    if (env) {
      try {
        const repoId = await getRepoId({ token, owner, repo });
        await upsertEnvironmentSecret({
          token,
          repositoryId: repoId,
          environmentName: env,
          name: key,
          value,
        });
        return res.json({ ok: true, env, scope: 'environment' });
      } catch (e) {
        if (e.status && e.status !== 404) {
          throw e;
        }
        console.warn(
          '[githubSecrets] upsert env secret failed, falling back to repo-level secret',
          e
        );
      }
    }

    await upsertRepoSecret({ token, owner, repo, name: key, value });

    return res.json({
      ok: true,
      env: env || null,
      scope: 'repo',
      envFallback: !!env,
    });
  } catch (err) {
    console.error('[githubSecrets] /upsert error:', err);
    const status = err.status || 500;
    return res.status(status).json({
      error: 'Failed to create or update GitHub secret',
      detail: err.message,
    });
  }
});

export default router;