import { z } from 'zod';
import { query } from '../db.js';

export const github_adapter = {
  name: 'github_adapter',
  description:
    'Fetch GitHub repository data and metadata for the authenticated user',
  input_schema: z.object({
    action: z.enum([
      'repos',
      'info',
      'branches',
      'commits',
      'workflows',
      'get_repo',
      'contents',
      'file',
    ]),
    repo: z.string().optional(),
    user_id: z.string(),
    path: z.string().optional(),
    page: z.number().optional(),
    per_page: z.number().optional(),
  }),
  handler: async ({ action, repo, user_id, path, page = 1, per_page = 50 }) => {
    if (!user_id) {
      throw new Error('Missing user_id in adapter call');
    }

    const res = await query(
      `SELECT c.access_token
       FROM users u
       JOIN connections c ON u.id = c.user_id
       WHERE c.provider = 'github'
         AND u.id = $1
       ORDER BY c.created_at DESC
       LIMIT 1`,
      [user_id]
    );

    if (!res || !res.rows) {
      console.error('[github_adapter] Query returned undefined:', res);
      throw new Error('Database query failed to return a result.');
    }

    if (res.rows.length === 0) {
      console.error(
        '[github_adapter] No GitHub token found for user:',
        user_id
      );
      throw new Error('No GitHub access token found for this user.');
    }

    const accessToken = res.rows[0].access_token;

    async function getDefaultBranch(repo) {
      const res = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'AutoDeploy-App',
        },
      });

      if (!res.ok) return 'main';

      const data = await res.json();
      return data.default_branch || 'main';
    }

    let apiUrl;

    switch (action) {
      case 'repos':
        apiUrl = `https://api.github.com/user/repos?page=${page}&per_page=${per_page}`;
        break;
      case 'info':
        if (!repo) throw new Error("Missing 'repo' parameter for info action");
        apiUrl = `https://api.github.com/repos/${repo}`;
        break;
      case 'get_repo':
        if (!repo)
          throw new Error("Missing 'repo' parameter for get_repo action");
        apiUrl = `https://api.github.com/repos/${repo}`;
        break;
      case 'branches':
        if (!repo)
          throw new Error("Missing 'repo' parameter for branches action");
        apiUrl = `https://api.github.com/repos/${repo}/branches`;
        break;
      case 'commits':
        if (!repo)
          throw new Error("Missing 'repo' parameter for commits action");
        apiUrl = `https://api.github.com/repos/${repo}/commits?page=${page}&per_page=${per_page}`;
        break;
      case 'workflows':
        if (!repo)
          throw new Error("Missing 'repo' parameter for workflows action");
        apiUrl = `https://api.github.com/repos/${repo}/actions/workflows`;
        break;
      case 'contents':
      case 'file': {
        if (!repo)
          throw new Error("Missing 'repo' parameter for contents/file action");

        const safePath = path ? `/${encodeURIComponent(path)}` : '';

        // Always include ref when path is provided (GitHub API quirk for dot-directories)
        if (path) {
          const defaultBranch = await getDefaultBranch(repo);
          apiUrl = `https://api.github.com/repos/${repo}/contents${safePath}?ref=${encodeURIComponent(
            defaultBranch
          )}`;
        } else {
          apiUrl = `https://api.github.com/repos/${repo}/contents`;
        }

        break;
      }
      default:
        throw new Error(`Unsupported action: ${action}`);
    }

    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AutoDeploy-App',
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      console.error('[github_adapter] GitHub API error:', {
        status: response.status,
        message: errorBody.message || response.statusText,
      });

      let userMessage = `GitHub API error ${response.status}: ${response.statusText}`;
      if (
        response.status === 403 &&
        /OAuth App access restrictions/i.test(errorBody.message || '')
      ) {
        userMessage =
          "Access denied: This repo is protected by an organization's OAuth App restrictions. " +
          'Please request org admin approval for your AutoDeploy app in GitHub settings.';
      }

      return {
        success: false,
        error: userMessage,
        details: errorBody.message || null,
      };
    }

    const data = await response.json();

    switch (action) {
      case 'repos':
        return {
          success: true,
          repositories: data.map((repo) => ({
            repo_name: repo.full_name,
            default_branch: repo.default_branch,
            language: repo.language,
            stars: repo.stargazers_count,
            visibility: repo.private ? 'private' : 'public',
          })),
        };

      case 'branches':
        return {
          success: true,
          branches: data.map((branch) => ({
            name: branch.name,
            protected: branch.protected,
          })),
        };

      case 'commits':
        return {
          success: true,
          commits: data.map((commit) => ({
            sha: commit.sha,
            author: commit.commit.author.name,
            date: commit.commit.author.date,
            message: commit.commit.message,
          })),
        };

      case 'workflows':
        return {
          success: true,
          workflows: data.workflows.map((wf) => ({
            name: wf.name,
            id: wf.id,
            state: wf.state,
            path: wf.path,
          })),
        };

      case 'contents':
        return {
          success: true,
          contents: Array.isArray(data)
            ? data.map((item) => ({
                name: item.name,
                path: item.path,
                type: item.type,
                size: item.size ?? null,
              }))
            : [],
        };

      case 'file':
        if (data.type !== 'file') {
          return {
            success: false,
            error: 'Requested path is not a file',
          };
        }

        return {
          success: true,
          file: {
            name: data.name,
            path: data.path,
            encoding: data.encoding,
            content: data.content
              ? Buffer.from(data.content, 'base64').toString('utf-8')
              : null,
          },
        };

      case 'info':
      case 'get_repo':
      default:
        return {
          success: true,
          repo_name: data.full_name,
          default_branch: data.default_branch,
          language: data.language,
          stars: data.stargazers_count,
          visibility: data.private ? 'private' : 'public',
        };
    }
  },
};

export async function getTokenScopes(token) {
  const res = await fetch('https://api.github.com/', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OSP-CI-Builder',
    },
  });
  const header = res.headers.get('x-oauth-scopes') || '';
  return header
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function listRepoWorkflows({ token, owner, repo }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows?per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OSP-CI-Builder',
    },
  });
  // if (!res.ok) {
  //   const text = await res.text().catch(() => '');
  //   throw new Error(
  //     `List workflows failed: ${res.status} ${res.statusText} ${text}`
  //   );
  // }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[listRepoWorkflows]', {
      status: res.status,
      statusText: res.statusText,
      body: text,
    });
    throw new Error(`List workflows failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.workflows ?? [];
}
// Github dispatch call

export async function dispatchWorkflow({
  token,
  owner,
  repo,
  workflow,
  ref,
  inputs = {},
}) {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(
    workflow
  )}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'OSP-CI-Builder',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref, inputs }),
  });

  if (res.status === 204) return { ok: true };

  const text = await res.text().catch(() => '');
  const err = new Error(
    `Workflow dispatch failed: ${res.status} ${res.statusText} ${text}`
  );
  err.status = res.status;
  try {
    err.details = JSON.parse(text);
  } catch {}
  throw err;
}

// Helper function to create and update a workflow file in a repo
export async function upsertWorkflowFile({
  token,
  owner,
  repo,
  path,
  content,
  branch,
  message = 'Add CI workflow via AutoDeploy',
}) {
  const baseUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(
    path
  )}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'OSP-CI-Builder',
    'Content-Type': 'application/json',
  };

  //check if the file exists to get the SHA
  let sha = undefined;
  const getRes = await fetch(`${baseUrl}?ref=${encodeURIComponent(branch)}`, {
    headers,
  });

  if (getRes.status === 200) {
    const existing = await getRes.json();
    sha = existing.sha;
  } else if (getRes.status === 400) {
    const text = await getRes.text().catch(() => '');
    throw new Error(
      `Get existing workflow failed: ${getRes.status} ${getRes.statusText} ${text}`
    );
  }

  //Encode content as base64 character data
  const encoded = Buffer.from(content, 'utf-8').toString('base64');

  //PUT to creat/update the file
  const body = {
    message,
    content: encoded,
    branch,
  };

  if (sha) body.sha = sha;

  const putRes = await fetch(baseUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '');
    throw new Error(
      `Upsert workflow file failed: ${putRes.status} ${putRes.statusText} ${text}`
    );
  }

  const data = await putRes.json();
  return data;
}
