import { z } from 'zod';
import { query } from '../db.js';

export const github_adapter = {
  name: 'github_adapter',
  description: 'Fetch GitHub repo data for the authenticated user',
  input_schema: z.object({
    repo: z.string(),
  }),
  handler: async ({ repo }) => {
    const res = await query(
      `SELECT c.access_token
       FROM users u
       JOIN connections c ON u.id = c.user_id
       WHERE c.provider = 'github'
       ORDER BY c.created_at DESC
       LIMIT 1`
    );
    if (res.rows.length === 0) {
      throw new Error('No GitHub access token found');
    }
    const accessToken = res.rows[0].access_token;

    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch repo data: ${response.status} ${response.statusText}`);
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
