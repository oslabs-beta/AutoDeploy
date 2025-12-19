import { Router } from 'express';
import { requireSession } from '../lib/requireSession.js';
import { getGithubAccessTokenForUser } from '../lib/github-token.js';
import { upsertWorkflowFile } from '../tools/github_adapter.js';
import { scaffold_generator } from '../tools/scaffold_generator.js';

const router = Router();

function normalizeRepo(repoUrlOrFullName) {
  if (repoUrlOrFullName && !repoUrlOrFullName.startsWith('http'))
    return repoUrlOrFullName;
  const url = new URL(repoUrlOrFullName);
  const parts = url.pathname
    .replace(/^\//, '')
    .replace(/\.git$/, '')
    .split('/');
  if (!parts?.[1])
    throw new Error(
      'Invalid repoUrl format. Expected https://github.com/<owner>/<repo>'
    );
  return `${parts[0]}/${parts[1]}`;
}

router.post('/scaffold/commit', requireSession, async (req, res) => {
  try {
    const {
      repoFullName,
      repoUrl,
      branch = 'main',
      backendPath = 'backend',
      frontendPath = 'frontend',
    } = req.body || {};

    if (!repoFullName && !repoUrl) {
      return res
        .status(400)
        .json({ ok: false, error: 'Missing repoFullName or repoUrl' });
    }

    const userId = req.user?.user_id;
    const token = await getGithubAccessTokenForUser(userId);
    if (!token)
      return res
        .status(401)
        .json({ ok: false, error: 'Missing GitHub token for user' });

    const normalized = normalizeRepo(repoFullName || repoUrl);
    const [owner, repo] = normalized.split('/');

    console.log('[scaffold/commit] body:', req.body);
    console.log(
      '[scaffold/commit] backendPath:',
      backendPath,
      'frontendPath:',
      frontendPath
    );

    const generated = await scaffold_generator.handler({
      backendPath,
      frontendPath,
    });
    const { files } = generated;

    const results = [];
    for (const f of files) {
      const r = await upsertWorkflowFile({
        token,
        owner,
        repo,
        path: f.path,
        content: f.content,
        branch,
        message: `AutoDeploy: add ${f.path}`,
      });
      results.push({ path: f.path, commitSha: r?.commit?.sha || null });
    }

    return res
      .status(201)
      .json({ ok: true, repo: normalized, branch, committed: results });
  } catch (err) {
    console.error('[scaffold_commit] error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
