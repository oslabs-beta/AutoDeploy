import simpleGit from 'simple-git';

export function parseGitHubRepoUrl(repoUrl) {
  try {
    const url = new URL(repoUrl);
    if (url.hostname !== 'github.com') return null;

    const parts = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
    if (parts.length < 2) return null;

    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    if (!owner || !repo) return null;

    return { owner, repo };
  } catch {
    return null;
  }
}

export async function cloneGithubRepoShallow({ repoUrl, dest }) {
  const git = simpleGit();
  // depth=1 is enough for file ingestion; avoids big clones
  await git.clone(repoUrl, dest, ['--depth', '1']);
}

export async function githubFetch(url, { githubToken } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'autodeploy-rag',
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`GitHub API error ${resp.status}: ${text || resp.statusText}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

export async function fetchRepoIssues({ owner, repo, githubToken, includeComments = true }) {
  const issues = [];
  let page = 1;
  const perPage = 50;
  const maxPages = 2; // cap to avoid runaway ingestion

  while (page <= maxPages) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=${perPage}&page=${page}`;
    const batch = await githubFetch(url, { githubToken });
    if (!Array.isArray(batch) || batch.length === 0) break;

    // Filter out PRs
    const onlyIssues = batch.filter((it) => !it.pull_request);

    // Optionally fetch comments (cap per issue)
    if (includeComments) {
      for (const issue of onlyIssues) {
        try {
          if (issue.comments_url && issue.comments > 0) {
            const comments = await githubFetch(issue.comments_url, { githubToken });
            issue.comments = Array.isArray(comments) ? comments.slice(0, 3) : [];
          } else {
            issue.comments = [];
          }
        } catch {
          issue.comments = [];
        }
      }
    }

    issues.push(...onlyIssues);
    page += 1;
  }

  return issues;
}
