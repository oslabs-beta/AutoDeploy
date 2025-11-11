import { Router } from 'express';
import { requireSession } from '../lib/requireSession.js';
import { getGithubAccessTokenForUser } from '../lib/github-token.js';
import { upsertWorkflowFile } from '../tools/github_adapter.js';
import { query } from '../db.js';
import { savePipelineVersion } from '../lib/pipelineVersions.js';

const router = Router();

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

    await query(
      `
        INSERT INTO deployment_logs
        (user_id, provider, repo_full_name, environment, branch, action,
        status, started_at, summary, metadata)
        VALUES ($1, $2, $3, $4, $5, $6,
        'success', NOW(), $7, $8::jsonb);
        `,
      [
        userId, // user_id
        'github_actions', // provider (or 'pipeline' if you prefer)
        repoFullName, // repo_full_name
        'global', // environment
        branchName, // branch
        'pipeline_commit', // action
        `Committed workflow ${workflowPath} via OSP`, // summary
        JSON.stringify({
          workflow_path: workflowPath,
          branch: branchName,
          commit_sha: result?.commit?.sha || null,
          commit_url: result?.commit?.html_url || null,
          source: 'pipeline_commit',
        }),
      ]
    );

    // Save a version of the pipelin YAML for history
    await savePipelineVersion({
      userId,
      repoFullName,
      branch: branchName,
      workflowPath,
      yaml,
      source: 'pipeline_commit',
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

/**
 * GET /mcp/v1/pipeline_history
 * Query params:
 *   repoFullName (required) - "owner/repo"
 *   branch      (optional)  - default "main"
 *   path        (optional)  - default ".github/workflows/ci.yml"
 *   limit       (optional)  - default 20
 *
 * Example:
 *   GET /mcp/v1/pipeline_history?repoFullName=lorencDedaj/NeatNest&branch=main
 */

router.get('/pipeline_history', requireSession, async (req, res) => {
  try {
    const { repoFullName, branch, path, limit } = req.query || {};

    if (!repoFullName) {
      return res
        .status(400)
        .json({ error: 'repoFUllName query param is required' });
    }

    const userId = req.user?.user_id;
    if (!userId) {
      return res
        .status(400)
        .json({ error: 'userId session missing or invalid' });
    }

    const branchName = branch || 'main';
    const workflowPath = path || '.github/workflows/ci.yml';
    const lim = Math.min(parseInt(limit || '20', 10) || 20, 100);

    const rows = await query(
      `
    select
        id,
        user_id,
        repo_full_name,
        branch,
        workflow_path,
        yaml,
        yaml_hash,
        source,
        created_at
    from pipeline_versions
    where repo_full_name = $1
        and branch = $2
        and workflow_path = $3
    order by created_at desc
    limit $4;
            `,
      [repoFullName, branchName, workflowPath, lim]
    );

    return res.json({
      ok: true,
      versions: rows,
    });
  } catch (err) {
    console.error('[pipeline_history] error: ', err);
    const status = err.status || 500;
    return res.status(status).json({
      error: err.message || 'Failed to fetch the pipeline commit history',
    });
  }
});

export default router;
