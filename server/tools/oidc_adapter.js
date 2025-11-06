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
    console.log("[oidc_adapter] Handler called with provider:", provider);
    try {
      if (provider === "aws") {
        const result = {
          provider,
          roles: [
            { name: "mcp-deploy-role", arn: "arn:aws:iam::123456789012:role/mcp-deploy-role" },
            { name: "mcp-staging-role", arn: "arn:aws:iam::123456789012:role/mcp-staging-role" },
          ],
          fetched_at: new Date().toISOString(),
        };
        console.log("[oidc_adapter] Returning AWS mock roles:", result);
        return result;
      }

      if (provider === "jenkins") {
        const result = {
          provider,
          jobs: [
            { name: "build_main", url: "https://jenkins.example.com/job/build_main" },
            { name: "deploy_staging", url: "https://jenkins.example.com/job/deploy_staging" },
          ],
          fetched_at: new Date().toISOString(),
        };
        console.log("[oidc_adapter] Returning Jenkins mock jobs:", result);
        return result;
      }

      throw new Error("Unsupported provider");
    } catch (err) {
      console.error("[oidc_adapter] Error occurred:", err);
      throw err;
    }
  },
};