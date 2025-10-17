

import { z } from "zod";

export const repo_reader = {
  name: "repo_reader",
  description: "Fetch a list of GitHub repositories and their branches for a given user or organization.",

  // ✅ Input schema for validation
  input_schema: z.object({
    provider: z.string().default("github"),
    username: z.string().optional(),
  }),

  // ✅ Mock handler (replace with GitHub API logic later)
  handler: async ({ provider, username = "alex-python" }) => {
    if (provider !== "github") {
      throw new Error("Only GitHub provider supported in mock version");
    }

    return {
      user: username,
      provider,
      repositories: [
        {
          name: "ci-cd-demo",
          full_name: `${username}/ci-cd-demo`,
          branches: ["main", "dev", "feature/auth"],
        },
        {
          name: "askmyrepo",
          full_name: `${username}/askmyrepo`,
          branches: ["main", "staging"],
        },
      ],
      fetched_at: new Date().toISOString(),
    };
  },
};