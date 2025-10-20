import { z } from "zod";
import { query } from "../db.js";

export const repo_reader = {
  name: "repo_reader",
  description: "Fetch a list of GitHub repositories and their branches for a given user or organization.",

  // ✅ Input schema for validation
  input_schema: z.object({
    provider: z.string().default("github"),
    username: z.string().optional(),
  }),

  handler: async ({ provider, username }) => {
    if (provider !== "github") throw new Error("Only GitHub supported");

    const res = await query(
      `SELECT c.access_token
       FROM users u
       JOIN connections c ON u.id = c.user_id
       WHERE c.provider = 'github'
       ORDER BY c.created_at DESC
       LIMIT 1`
    );

    const token = res[0]?.access_token;
    if (!token) throw new Error("No GitHub access token found in DB");

    const url = username
      ? `https://api.github.com/users/${username}/repos`
      : "https://api.github.com/user/repos";

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "AutoDeploy-Agent",
      },
    });

    if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`);
    const data = await response.json();

    return {
      success: true,
      provider,
      user: username || "authenticated-user",
      repositories: data.map(repo => ({
        name: repo.name,
        full_name: repo.full_name,
        branches_url: repo.branches_url,
      })),
      fetched_at: new Date().toISOString(),
    };
  },
};