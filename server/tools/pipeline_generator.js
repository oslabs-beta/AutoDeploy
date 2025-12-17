import { z } from "zod";
import { gcp_adapter } from "./gcp_adapter.js";

// Simple, dependency-light generator to avoid DB/token failures.
// Generates mock AWS/Jenkins YAML or delegates to gcp_adapter.
export const pipeline_generator = {
  name: "pipeline_generator",
  description: "Generate a CI/CD YAML configuration for a given repository and provider.",

  input_schema: z.object({
    repo: z.string(),
    branch: z.string().default("main"),
    provider: z.enum(["aws", "jenkins", "gcp"]).optional().default("aws"),
    template: z.enum(["node_app", "python_app", "container_service"]),
    options: z
      .object({
        nodeVersion: z.string().optional(),
        installCmd: z.string().optional(),
        testCmd: z.string().optional(),
        buildCmd: z.string().optional(),
        awsRoleArn: z.string().optional(),
        gcpServiceAccountEmail: z.string().optional(),
        stages: z.array(z.enum(["build", "test", "deploy"])).optional(),
      })
      .optional(),
  }),

  handler: async ({ repo, branch = "main", provider = "aws", template, options }) => {
    try {
      const normalized = {
        nodeVersion: options?.nodeVersion,
        installCmd: options?.installCmd,
        testCmd: options?.testCmd,
        buildCmd: options?.buildCmd,
        awsRoleArn: options?.awsRoleArn,
        gcpServiceAccountEmail: options?.gcpServiceAccountEmail,
        stages: options?.stages,
      };

      // Handle GCP via adapter
      if (provider === "gcp") {
        const gcpResult = await gcp_adapter.handler({
          repo,
          branch,
          ...(options || {}),
        });

        if (!gcpResult?.success) {
          return {
            success: false,
            error: gcpResult?.error || "Failed to generate GCP pipeline YAML.",
          };
        }

        return {
          success: true,
          data: {
            pipeline_name: "gcp-cloud-run-ci.yml",
            repo,
            branch,
            provider: "gcp",
            template,
            options: options || {},
            stages: ["build", "deploy"],
            generated_yaml: gcpResult.data.generated_yaml,
            created_at: new Date().toISOString(),
          },
        };
      }

      // Fallback mock YAML for AWS/Jenkins
      const generated_yaml = `
name: CI/CD Pipeline for ${repo}

permissions:
  id-token: write
  contents: read

on:
  push:
    branches:
      - ${branch}
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${normalized.nodeVersion ?? "20"}
      - name: Install Dependencies
        run: ${
          normalized.installCmd ??
          (template === "node_app" ? "npm ci" : "pip install -r requirements.txt")
        }
      - name: Run Tests
        run: ${
          normalized.testCmd ?? (template === "node_app" ? "npm test" : "pytest")
        }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${normalized.awsRoleArn ?? "REPLACE_ME"}
          aws-region: us-east-1
      - name: Deploy Application
        run: echo "Deploying ${repo} to AWS..."
`;

      return {
        success: true,
        data: {
          pipeline_name: `${provider}-${template}-ci.yml`,
          repo,
          branch,
          provider,
          template,
          options: options || {},
          stages: normalized.stages ?? ["build", "test", "deploy"],
          generated_yaml,
          created_at: new Date().toISOString(),
        },
      };
    } catch (err) {
      console.error("[pipeline_generator] Unhandled error:", err);
      return { success: false, error: err.message || "pipeline_generator failed" };
    }
  },
};
