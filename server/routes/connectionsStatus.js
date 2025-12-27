import { Router } from 'express';
import { requireSession } from '../lib/requireSession.js';
import { getGithubAccessTokenForUser } from '../lib/github-token.js';

const router = Router();

router.get('/connections', requireSession, async (req, res) => {
  try {
    const userId = req?.user?.user_id || req?.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'No user in session' });
    }

    const repoFullName = String(
      req.query.repoFullName || req.query.repo_full_name || ''
    );

    const token = await getGithubAccessTokenForUser(userId);
    let githubAppInstalled = !!token;

    let githubRepoWriteOk = false;

    if (token && repoFullName) {
      const [owner, repo] = String(repoFullName).split('/');
      if (owner && repo) {
        const url = `https://api.github.com/repos/${owner}/${repo}`;
        const ghRes = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'AutoDeploy-App',
          },
        });

        if (ghRes.ok) {
          const data = await ghRes.json().catch(() => ({}));
          const perms = data.permissions || {};
          githubRepoWriteOk = !!(
            perms.push || perms.admin || perms.maintain || perms.triage
          );
        } else {
          console.warn(
            '[connections] GitHub repo probe failed',
            ghRes.status,
            ghRes.statusText
          );
          if (ghRes.status === 401 || ghRes.status === 403) {
            // Token is present but unauthorized for this repo; treat as if the
            // GitHub app is not correctly installed/authorized.
            githubAppInstalled = false;
            githubRepoWriteOk = false;
          }
        }
      }
    }

    return res.json({
      githubAppInstalled,
      githubRepoWriteOk,
    });
  } catch (err) {
    console.error('[connections] /api/connections error:', err);
    const status = err.status || 500;
    return res.status(status).json({
      error: 'Failed to load connection status',
      detail: err.message,
    });
  }
});

export default router;