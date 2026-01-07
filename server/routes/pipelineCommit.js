import { Router } from 'express';
import { requireSession } from '../lib/requireSession.js';
import { getGithubAccessTokenForUser } from '../lib/github-token.js';
import { upsertWorkflowFile } from '../tools/github_adapter.js';
import { query } from '../db.js';
import { savePipelineVersion } from '../lib/pipelineVersions.js';

const router = Router();

// Response helpers to normalize envelope + request_id
const ok = (req, res, status, data = null, message = undefined) =>
  res
    .status(status)
    .json({ ok: true, data, message, request_id: req.requestId });

const errRes = (
  req,
  res,
  status,
  code,
  message,
  details = undefined
) =>
  res.status(status).json({
    ok: false,
    error: { code, message, details },
    request_id: req.requestId,
  });

// Helper to normalize repoUrl | repoFullName
function normalizeRepo(repoUrlSlug) {
  if (repoUrlSlug && !repoUrlSlug.startsWith('http')) return repoUrlSlug;

  const url = new URL(repoUrlSlug);
  const parts = url.pathname
    .replace(/^\//, '')
    .replace(/\.git$/, '')
    .split('/');

  if (!parts || !parts[1]) {
    throw new Error(
      'Invalid repoUrl format. Expected https://github.com/<owner>/<repo>'
    );
  }

  return `${parts[0]}/${parts[1]}`;
}

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

// Commit a workflow YAML file to GitHub and record a new pipeline version
router.post('/pipeline_commit', requireSession, async (req, res) => {
  try {
    const {
      repoFullName,
      repoUrl,
      branch = 'main',
      yaml,
      path,
      provider = 'gcp',
      workflowName,
      message,
    } = req.body || {};

    // if (!repoFullName || !yaml) {
    //   return res
    //     .status(400)
    //     .json({ error: 'repoFullName and yaml are required' });
    // }

    if (!repoFullName && !repoUrl) {
      return errRes(
        req,
        res,
        400,
        'BAD_REQUEST',
        'Missing required field: repoFullName or repoUrl'
      );
    }

    if (!yaml) {
      return errRes(req, res, 400, 'BAD_REQUEST', 'Missing required field: yaml');
    }

    const userId = req.user?.user_id;
    if (!userId)
      return errRes(
        req,
        res,
        401,
        'UNAUTHORIZED',
        'User session missing or invalid'
      );

    const token = await getGithubAccessTokenForUser(userId);
    if (!token)
      return errRes(
        req,
        res,
        401,
        'UNAUTHORIZED',
        'Missing GitHub token for user'
      );

    // const [owner, repo] = repoFullName.split('/');
    let normalizedRepoFullName;

    try {
      normalizedRepoFullName = normalizeRepo(repoFullName || repoUrl);
    } catch (e) {
      return errRes(req, res, 400, 'BAD_REQUEST', e.message);
    }

    const [owner, repo] = normalizedRepoFullName.split('/');

    // const workflowPath = path || '.github/workflows/ci.yml';
    const defaultWorkflowName =
      workflowName || (provider === 'gcp' ? 'gcp-cloud-run-ci.yml' : 'ci.yml');

    const workflowPath = path || `.github/workflows/${defaultWorkflowName}`;

    const branchName = branch || 'main';

    console.log(
      `[pipeline_commit] Committing workflow to ${normalizedRepoFullName}:${workflowPath}`
    );

    // Commit message
    const commitMessage =
      message ||
      (provider === 'gcp'
        ? 'Add GCP Cloud Run CI/CD workflow (GHCR -> Artifact Registry -> Cloud Run)'
        : 'Add CI workflow via OSP');

    const result = await upsertWorkflowFile({
      token,
      owner,
      repo,
      path: workflowPath,
      content: yaml,
      branch: branchName,
      message: commitMessage,
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
        userId,
        'github_actions',
        // repoFullName,
        normalizedRepoFullName,
        'global',
        branchName,
        'pipeline_commit',
        `Committed workflow ${workflowPath} via OSP`,
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
      repoFullName: normalizedRepoFullName,
      branch: branchName,
      workflowPath,
      yaml,
      source: 'pipeline_commit',
    });

    return ok(req, res, 201, result, 'Workflow committed successfully');
  } catch (err) {
    console.error('[pipeline_commit] error:', err);
    const status = err.status || 500;
    return errRes(
      req,
      res,
      status,
      err.code || (status >= 500 ? 'INTERNAL' : 'ERROR'),
      err.message,
      err.details || undefined
    );
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

// List stored YAML versions for a give repo/branch/path
router.get('/pipeline_history', requireSession, async (req, res) => {
  try {
    const { repoFullName, branch, path, limit } = req.query || {};

    if (!repoFullName) {
      return errRes(
        req,
        res,
        400,
        'BAD_REQUEST',
        'repoFullName query param is required'
      );
    }

    const userId = req.user?.user_id;
    if (!userId) {
      return errRes(
        req,
        res,
        401,
        'UNAUTHORIZED',
        'User session missing or invalid'
      );
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

    return ok(req, res, 200, { versions: rows });
  } catch (err) {
    console.error('[pipeline_history] error: ', err);
    const status = err.status || 500;
    return errRes(
      req,
      res,
      status,
      err.code || (status >= 500 ? 'INTERNAL' : 'ERROR'),
      err.message || 'Failed to fetch the pipeline commit history',
      err.details || undefined
    );
  }
});

/**
 * POST /mcp/v1/pipeline_rollback
 * Body:
 *   { "versionId": "<pipeline_versions.id>" }
 *
 * Restores an older YAML version from pipeline_versions by:
 *   - fetching the yaml for that version
 *   - re-committing it to GitHub at workflow_path on branch
 *   - logging a deployment_logs row with action='pipeline_rollback'
 *   - saving a new pipeline_versions entry with source='pipeline_rollback'
 */

// Roll back to a previoys pipeline YAML version and log it as a deployment
router.post('/pipeline_rollback', requireSession, async (req, res) => {
  try {
    const { versionId } = req.body || {};
    if (!versionId) {
      return errRes(
        req,
        res,
        400,
        'BAD_REQUEST',
        'Missing versionId from request body'
      );
    }

    const userId = req.user?.user_id;
    if (!userId) {
      return errRes(
        req,
        res,
        401,
        'UNAUTHORIZED',
        'User session missing or invalid'
      );
    }

    // Look up the pipeline version we want to restore

    const versionResult = await query(
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
      where id = $1
      limit 1;
      `,
      [versionId]
    );

    if (!versionResult.rowCount || !versionResult.rows.length) {
      return errRes(
        req,
        res,
        404,
        'NOT_FOUND',
        'Pipeline version not found for give versionId'
      );
    }

    const version = versionResult.rows[0];
    const {
      repo_full_name: repoFullName,
      branch,
      workflow_path: workflowPath,
      yaml,
    } = version;

    // Get github token for this user
    const token = await getGithubAccessTokenForUser(userId);
    if (!token) {
      return errRes(
        req,
        res,
        401,
        'UNAUTHORIZED',
        'Missing GitHub token for this user'
      );
    }

    const [owner, repo] = (repoFullName || '').split('/');
    if (!owner || !repo) {
      return errRes(
        req,
        res,
        400,
        'BAD_REQUEST',
        `Invalid repo_full_name on version ${versionId}`
      );
    }

    //Re-commit the yaml file to GitHub (overwrite current workflow)
    const githubResult = await upsertWorkflowFile({
      token,
      owner,
      repo,
      path: workflowPath,
      content: yaml,
      branch,
      message: `Rollback pipeline to version ${versionId}`,
    });

    // Log into deployment_log as a pipeline_rollback
    const deploymentResult = await query(
      `
      INSERT INTO deployment_logs
        (user_id, provider, repo_full_name, environment, branch, action,
         status, started_at, summary, metadata)
      VALUES ($1, $2, $3, $4, $5, $6,
              'success', NOW(), $7, $8::jsonb)
      returning *;
      `,
      [
        userId,
        'github_actions',
        repoFullName,
        'global',
        branch,
        'pipeline_rollback',
        `Rolled back pipeline to version ${versionId}`,
        JSON.stringify({
          workflow_path: workflowPath,
          branch,
          version_id: versionId,
          commit_sha: githubResult?.commit?.sha || null,
          commit_url: githubResult?.commit?.html_url || null,
          source: 'pipeline_rollback',
        }),
      ]
    );

    const deployment = deploymentResult.rows[0];

    // Save a new pipelone_versions entry representing this rollback operation
    await savePipelineVersion({
      userId,
      repoFullName,
      branch,
      workflowPath,
      yaml,
      source: 'pipeline_rollback',
    });

    return ok(
      req,
      res,
      201,
      { github: githubResult, deployment },
      'Pipeline rolled back successfully'
    );
  } catch (err) {
    console.error('[pipeline_rollback] error:', err);
    const status = err.status || 500;
    return errRes(
      req,
      res,
      status,
      err.code || (status >= 500 ? 'INTERNAL' : 'ERROR'),
      err.message || 'Failed to rollback pipeline',
      err.details || undefined
    );
  }
});

export default router;
