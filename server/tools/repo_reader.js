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
    user_id: z.string().optional(),
  }),

  handler: async ({ provider, username, repo, user_id }) => {
    if (provider !== "github") return { success: false, data: null, error: "Only GitHub supported" };

    try {
      let queryText = `
        SELECT c.access_token
        FROM users u
        JOIN connections c ON u.id = c.user_id
        WHERE c.provider = 'github'`;
      const queryParams = [];

      if (user_id) {
        queryText += ` AND u.id = $1`;
        queryParams.push(user_id);
      }

      queryText += `
        ORDER BY c.created_at DESC
        LIMIT 1`;

      const res = await query(queryText, queryParams);

      if (!res.rows || res.rows.length === 0) {
        console.error("No GitHub access token found in DB for the given user_id:", user_id);
        return { success: false, data: null, error: "No GitHub access token found in DB" };
      }

      const token = res.rows[0].access_token;
      if (!token) {
        console.error("GitHub access token is empty for the user_id:", user_id);
        return { success: false, data: null, error: "No GitHub access token found in DB" };
      }

      let url;
      if (repo) {
        if (repo.includes("/")) {
          const [repoUsername, repoName] = repo.split("/");
          url = `https://api.github.com/repos/${repoUsername}/${repoName}`;
        } else {
          url = `https://api.github.com/repos/${repo}`;
        }
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
        console.error(`GitHub API error: ${response.status} ${response.statusText} - ${errorText}`);
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
          console.error("Unexpected GitHub API response format for repo list:", data);
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
              default_branch: repo.default_branch,
              language: repo.language,
              private: repo.private,
              html_url: repo.html_url,
            })),
            fetched_at: new Date().toISOString(),
          },
        };
      }
    } catch (error) {
      console.error("Error in repo_reader handler:", error);
      return { success: false, data: null, error: error.message || "Unknown error" };
    }
  },
};