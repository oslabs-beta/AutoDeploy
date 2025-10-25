import { z } from "zod";
import { query } from "../db.js";

export const repo_reader = {
  name: "repo_reader",
  description: "Fetch a list of GitHub repositories or details of a specific repository for a given user or organization.",

  // ✅ Input schema for validation
  input_schema: z.object({
    provider: z.string().default("github"),
    username: z.string().optional(),
    repo: z.string().optional(),
  }),

  handler: async ({ provider, username, repo }) => {
    if (provider !== "github") return { success: false, data: null, error: "Only GitHub supported" };

    try {
      const res = await query(
        `SELECT c.access_token
         FROM users u
         JOIN connections c ON u.id = c.user_id
         WHERE c.provider = 'github'
         ORDER BY c.created_at DESC
         LIMIT 1`
      );

      const token = res[0]?.access_token;
      if (!token) return { success: false, data: null, error: "No GitHub access token found in DB" };

      let url;
      if (repo) {
        url = `https://api.github.com/repos/${repo}`;
      } else {
        url = username
          ? `https://api.github.com/users/${username}/repos`
          : "https://api.github.com/user/repos";
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "AutoDeploy-Agent",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, data: null, error: `GitHub API error: ${response.status} ${response.statusText} - ${errorText}` };
      }

      const data = await response.json();

      if (repo) {
        // Return detailed info for specific repo
        return {
          success: true,
          data: {
            repository: data,
            fetched_at: new Date().toISOString(),
          },
        };
      } else {
        // Return list of repos
        if (!Array.isArray(data)) {
          return { success: false, data: null, error: "Unexpected GitHub API response format" };
        }
        return {
          success: true,
          data: {
            provider,
            user: username || "authenticated-user",
            repositories: data.map(repo => ({
              name: repo.name,
              full_name: repo.full_name,
              branches_url: repo.branches_url,
            })),
            fetched_at: new Date().toISOString(),
          },
        };
      }
    } catch (error) {
      return { success: false, data: null, error: error.message || "Unknown error" };
    }
  },
};