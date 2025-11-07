import { Router } from 'express';
import { requireSession } from '../lib/requireSession.js';
import { getGithubAccessTokenForUser } from '../lib/github-token.js';
import { upsertWorkflowFile } from '../tools/github_adapter.js';

const router = Router();

// this is nice. consider using JSDoc at some point in the future to document your routes/functions/etc.
// it really elevates a codebase's professionalism
/**
 * POST /mcp/v1/pipeline_commit
 * Body:
 * {
 *   "repoFullName": "owner/repo",
 *   "branch": "main",
 *   "yaml": "name: CI/CD Pipeline ...",
 *   "path": ".github/workflows/ci.yml"
 * }
 */
router.post('/pipeline_commit', requireSession, async (req, res) => {
  try {
    const { repoFullName, branch, yaml, path } = req.body || {};
    if (!repoFullName || !yaml) {
      return res
        .status(400)
        .json({ error: 'repoFullName and yaml are required' });
    }

    const userId = req.user?.user_id;
    if (!userId)
      return res.status(401).json({ error: 'User session missing or invalid' });

    const token = await getGithubAccessTokenForUser(userId);
    if (!token)
      return res.status(401).json({ error: 'Missing GitHub token for user' });

    const [owner, repo] = repoFullName.split('/');
    const workflowPath = path || '.github/workflows/ci.yml';
    const branchName = branch || 'main';

    console.log(
      `[pipeline_commit] Committing workflow to ${repoFullName}:${workflowPath}`
    );

    const result = await upsertWorkflowFile({
      token,
      owner,
      repo,
      path: workflowPath,
      content: yaml,
      branch: branchName,
      message: 'Add CI workflow via OSP',
    });

    return res.status(201).json({
      ok: true,
      message: 'Workflow committed successfully',
      data: result,
    });
  } catch (err) {
    console.error('[pipeline_commit] error:', err);
    const status = err.status || 500;
    return res
      .status(status)
      .json({ error: err.message, details: err.details || undefined });
  }
});

export default router;
