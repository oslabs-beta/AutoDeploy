import { Router } from 'express';
import { requireSession } from '../lib/requireSession.js';
import { getGithubAccessTokenForUser } from '../lib/github-token.js';
import { upsertWorkflowFile } from '../tools/github_adapter.js';
import { gcp_adapter } from '../tools/gcp_adapter.js';

const router = Router();

function normalizeRepo(repoUrlOrFullName) {
  if (repoUrlOrFullName && !repoUrlOrFullName.startsWith('http'))
    return repoUrlOrFullName;
  const url = new URL(repoUrlOrFullName);
  const parts = url.pathname
    .replace(/^\//, '')
    .replace(/\.git$/, '')
    .split('/');
  if (!parts?.[1]) {
    throw new Error(
      'Invalid repoUrl format. Expected https://github.com/<owner>/<repo>'
    );
  }
  return `${parts[0]}/${parts[1]}`;
}

console.log('workflowCommit router loaded');

router.post('/scaffold/workflow', requireSession, async (req, res) => {
  try {
    const {
      repoFullName,
      repoUrl,
      branch = 'main',

      // GCP settings
      projectId = 'my-app-dev-481702',
      region = 'us-east1',
      artifactRepo = 'autodeploy',

      // Cloud Run service names
      backendService = 'my-app-api',
      frontendService = 'my-app-web',

      // repo paths
      backendPath = 'backend',
      frontendPath = 'frontend',

      workflowPath = '.github/workflows/deploy-cloudrun.yml',
    } = req.body || {};

    if (!repoFullName && !repoUrl) {
      return res
        .status(400)
        .json({ ok: false, error: 'Missing repoFullName or repoUrl' });
    }

    const userId = req.user?.user_id;
    const token = await getGithubAccessTokenForUser(userId);
    if (!token) {
      return res
        .status(401)
        .json({ ok: false, error: 'Missing GitHub token for user' });
    }

    const normalized = normalizeRepo(repoFullName || repoUrl);
    const [owner, repo] = normalized.split('/');

    const result = await gcp_adapter.handler({
      branch,

      // GCP project config (schema-aligned)
      gcp_project_id: projectId,
      gcp_region: region,

      // Cloud Run services
      backend_service: backendService,
      frontend_service: frontendService,

      // Artifact Registry (Option A: single repo)
      backend_ar_repo: artifactRepo,
      frontend_ar_repo: artifactRepo,

      // Image names
      backend_image_name: backendService,
      frontend_image_name: frontendService,

      // Repo layout (matches my-app)
      backend_context: backendPath,
      frontend_context: frontendPath,
      backend_dockerfile: `${backendPath}/Dockerfile`,
      frontend_dockerfile: `${frontendPath}/Dockerfile`,

      // Ports (Cloud Run default)
      backend_port: 8080,
      frontend_port: 8080,

      generate_dockerfiles: false,
    });

    if (!result?.success || !result?.data?.generated_yaml) {
      return res.status(500).json({
        ok: false,
        error: 'gcp_adapter did not return generated_yaml',
      });
    }

    const yaml = result.data.generated_yaml;

    const r = await upsertWorkflowFile({
      token,
      owner,
      repo,
      path: workflowPath,
      content: yaml,
      branch,
      message: 'AutoDeploy: add Cloud Run workflow',
    });

    return res.status(201).json({
      ok: true,
      repo: normalized,
      branch,
      workflowPath,
      commitSha: r?.commit?.sha || null,
    });
  } catch (err) {
    console.error('[scaffold/workflow] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
