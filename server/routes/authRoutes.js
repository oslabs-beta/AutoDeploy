// GitHub auth utility routes: check token scopes and list workflows
import express from 'express';
import { requireSession } from '../lib/requireSession.js';
import { getGithubAccessTokenForUser } from '../lib/github-token.js';
import { getTokenScopes, listRepoWorkflows } from '../tools/github_adapter.js'; // adjust path if needed

const router = express.Router();

// Check which scopes the stored GitHub token has for the logged-in user
// GET /auth/github/scopes
router.get('/auth/github/scopes', requireSession, async (req, res) => {
  try {
    const userId = req?.user?.user_id;
    if (!userId) return res.status(401).json({ error: 'No user in session' });

    const token = await getGithubAccessTokenForUser(userId);
    if (!token)
      return res.status(401).json({ error: 'Missing GitHub token for user' });

    const scopes = await getTokenScopes(token);
    res.json({ scopes, hasWorkflow: scopes.includes('workflow') });
  } catch (e) {
    console.error('scope check failed:', e);
    res.status(500).json({ error: 'Scope check failed' });
  }
});

// List GitHub Actions workflows for a specific repository
// GET /auth/github/workflows?repoFullName=owner/repo
router.get('/auth/github/workflows', requireSession, async (req, res) => {
  try {
    const userId = req?.user?.user_id;
    if (!userId) return res.status(401).json({ error: 'No user in session' });

    const token = await getGithubAccessTokenForUser(userId);
    if (!token)
      return res.status(401).json({ error: 'Missing GitHub token for user' });

    const repoFullName = req.query.repoFullName;
    if (!repoFullName || !repoFullName.includes('/')) {
      return res
        .status(400)
        .json({ error: 'repoFullName query param required: "owner/repo"' });
    }
    const [owner, repo] = repoFullName.split('/');

    const workflows = await listRepoWorkflows({ token, owner, repo });
    const lite = workflows.map((w) => ({
      id: w.id,
      name: w.name,
      path: w.path,
      state: w.state,
      created_at: w.created_at,
      updated_at: w.updated_at,
    }));
    res.json({ workflows: lite });
  } catch (e) {
    console.error('list workflows failed:', e);
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

export default router;
