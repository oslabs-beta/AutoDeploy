

import { z } from "zod";

export const oidc_adapter = {
  name: "oidc_adapter",
  description: "List available AWS IAM roles or Jenkins jobs for a given provider.",
  
  // ✅ Input schema for validation
  input_schema: z.object({
    provider: z.enum(["aws", "jenkins"]),
  }),

  // ✅ Mock handler (replace with real API calls later)
  handler: async ({ provider }) => {
    if (provider === "aws") {
      return {
        provider,
        roles: [
          { name: "mcp-deploy-role", arn: "arn:aws:iam::123456789012:role/mcp-deploy-role" },
          { name: "mcp-staging-role", arn: "arn:aws:iam::123456789012:role/mcp-staging-role" },
        ],
        fetched_at: new Date().toISOString(),
      };
    }

    if (provider === "jenkins") {
      return {
        provider,
        jobs: [
          { name: "build_main", url: "https://jenkins.example.com/job/build_main" },
          { name: "deploy_staging", url: "https://jenkins.example.com/job/deploy_staging" },
        ],
        fetched_at: new Date().toISOString(),
      };
    }

    throw new Error("Unsupported provider");
  },
};