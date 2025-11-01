import express from 'express';
import { requireSession } from '../lib/requireSession.js';
import { getTokenScopes, listRepoWorkflows } from '../tools/github_adapter.js';

const router = express.Router();

// GET /auth/github/scopes
router.get('/auth/github/scopes', requireSession, async (req, res) => {
  try {
    const token = req?.session?.user?.github_access_token;
    if (!token)
      return res.status(401).json({ error: 'Missing GitHub token in session' });

    const scopes = await getTokenScopes(token);
    res.json({ scopes, hasWorkflow: scopes.includes('workflow') });
  } catch (e) {
    console.error('scope check failed:', e);
    res.status(500).json({ error: 'Scope check failed' });
  }
});

// GET /auth/github/workflows?repoFullName=owner/repo
router.get('/auth/github/workflows', requireSession, async (req, res) => {
  try {
    const token = req?.session?.user?.github_access_token;
    if (!token)
      return res.status(401).json({ error: 'Missing GitHub token in session' });

    const repoFullName = req.query.repoFullName;
    if (!repoFullName || !repoFullName.includes('/')) {
      return res
        .status(400)
        .json({ error: 'repoFullName query param required: "owner/repo"' });
    }
    const [owner, repo] = repoFullName.split('/');

    const workflows = await listRepoWorkflows({ token, owner, repo });
    // Useful projection for the UI
    const lite = workflows.map((w) => ({
      id: w.id,
      name: w.name,
      path: w.path, // e.g. ".github/workflows/ci.yml"
      state: w.state, // "active"/"deleted"
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
