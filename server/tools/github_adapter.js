import { z } from 'zod';
import { query } from '../db.js';

export const github_adapter = {
  name: 'github_adapter',
  description: 'Fetch GitHub repo data for the authenticated user',
  input_schema: z.object({
    repo: z.string(),
    user_id: z.string(),
  }),
  handler: async ({ repo, user_id }) => {
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
      console.error("[github_adapter] Query returned undefined:", res);
      throw new Error("Database query failed to return a result.");
    }

    if (res.rows.length === 0) {
      console.error("[github_adapter] No GitHub token found for user:", user_id);
      throw new Error("No GitHub access token found for this user.");
    }
    const accessToken = res.rows[0].access_token;

    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AutoDeploy-App', // Required by GitHub for all API requests
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      console.error("[github_adapter] GitHub API error:", {
        status: response.status,
        message: errorBody.message || response.statusText,
      });

      let userMessage = `GitHub API error ${response.status}: ${response.statusText}`;
      if (response.status === 403 && /OAuth App access restrictions/i.test(errorBody.message || '')) {
        userMessage =
          "Access denied: This repo is protected by an organization's OAuth App restrictions. " +
          "Please request org admin approval for your AutoDeploy app in GitHub settings.";
      }

      return {
        success: false,
        error: userMessage,
        details: errorBody.message || null,
      };
    }

    const data = await response.json();

    return {
      repo_name: data.full_name,
      default_branch: data.default_branch,
      language: data.language,
      stars: data.stargazers_count,
      visibility: data.private ? 'private' : 'public',
    };
  },
};
