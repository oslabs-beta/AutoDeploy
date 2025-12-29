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
    template: z.enum([
      "node_app",
      "python_app",
      "container_service",
      "aws_static_vite",
    ]),
    stages: z.array(z.enum(["build", "test", "deploy"])).optional(),
    options: z
      .object({
        nodeVersion: z.string().optional(),
        installCmd: z.string().optional(),
        testCmd: z.string().optional(),
        buildCmd: z.string().optional(),
        awsRoleArn: z.string().optional(),
        awsSessionName: z.string().optional(),
        awsRegion: z.string().optional(),
        gcpServiceAccountEmail: z.string().optional(),
        stages: z.array(z.enum(["build", "test", "deploy"])).optional(),
        // Additional fields for aws_static_vite template
        awsAccountId: z.string().optional(),
        s3Bucket: z.string().optional(),
        cloudFrontDistributionId: z.string().optional(),
        outputDir: z.string().optional(),
      })
      .optional(),
  }),

  // Real handler (queries github_adapter for repo info and generates pipeline config)
  handler: async ({ repo, branch = 'main', provider = 'aws', template, stages, options }) => {
    const normalized = {
      nodeVersion: options?.nodeVersion,
      installCmd: options?.installCmd,
      testCmd: options?.testCmd,
      buildCmd: options?.buildCmd,
      awsRoleArn: options?.awsRoleArn,
      awsSessionName: options?.awsSessionName,
      awsRegion: options?.awsRegion,
      stages: stages ?? options?.stages,
      awsAccountId: options?.awsAccountId,
      s3Bucket: options?.s3Bucket,
      cloudFrontDistributionId: options?.cloudFrontDistributionId,
      outputDir: options?.outputDir,
    };
    normalized.gcpServiceAccountEmail = options?.gcpServiceAccountEmail;

    const sessionToken = process.env.MCP_SESSION_TOKEN;
    let decoded = {};
    let userId = null;

    // No req.cookies available in MCP tool mode — skip direct session lookups.
    console.warn(
      '⚠️ Skipping requireSession — tool is running without HTTP request context.'
    );

    // Fallback: decode MCP_SESSION_TOKEN if no user found
    if (!userId && sessionToken) {
      try {
        decoded = jwt.decode(sessionToken);
        userId = decoded?.user?.id || decoded?.sub || null;
        if (userId)
          console.log('🧠 Resolved user_id from decoded token:', userId);
      } catch (err) {
        console.warn('⚠️ Could not decode MCP_SESSION_TOKEN:', err.message);
      }
    }

    if (!userId) {
      console.warn('⚠️ Could not resolve user_id — defaulting to anonymous.');
      userId = '00000000-0000-0000-0000-000000000000';
    }

    // 🧠 Try to resolve user_id from GitHub username if still anonymous
    if (userId === '00000000-0000-0000-0000-000000000000') {
      let githubUsername =
        decoded?.github_username || process.env.GITHUB_USERNAME || null;

      if (githubUsername) {
        try {
          const { rows: userRows } = await pool.query(
            `SELECT id FROM users WHERE github_username = $1 LIMIT 1`,
            [githubUsername]
          );

          if (userRows.length > 0) {
            userId = userRows[0].id;
            console.log('🔄 Resolved user_id from github_username:', userId);
          } else {
            console.warn(
              '⚠️ No user found in DB matching github_username:',
              githubUsername
            );
          }
        } catch (err) {
          console.warn(
            '⚠️ Failed to resolve user_id from github_username:',
            err.message
          );
        }
      } else {
        console.warn('⚠️ No GitHub username available to resolve user_id.');
      }
    }

    // Try DB lookup for GitHub token first
    let githubToken = null;
    try {
      // Template-specific: AWS static Vite frontend
      if (template === "aws_static_vite" && provider === "aws") {
        const resolvedStages = Array.isArray(normalized.stages) && normalized.stages.length > 0
          ? normalized.stages
          : ["build", "deploy"]; // test stage is optional for this template

        const nodeVersion = normalized.nodeVersion ?? "20";
        const installCmd = normalized.installCmd ?? "npm ci";
        const buildCmd = normalized.buildCmd ?? "npm run build";
        const awsRegion = normalized.awsRegion ?? "us-east-1";
        const awsRoleArn = normalized.awsRoleArn ?? "REPLACE_ME";
        const outputDir = normalized.outputDir ?? "dist";
        const s3Bucket = normalized.s3Bucket ?? "REPLACE_ME_BUCKET";
        const cloudFrontDistributionId =
          normalized.cloudFrontDistributionId ?? "REPLACE_ME_DISTRIBUTION";

        const jobs = [];

        if (resolvedStages.includes("build")) {
          jobs.push(`
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${nodeVersion}
      - name: Install dependencies
        run: ${installCmd}
      - name: Build frontend
        run: ${buildCmd}
`);
        }

        if (resolvedStages.includes("deploy")) {
          const needsJob = resolvedStages.includes("build") ? "build" : undefined;

          jobs.push(`
  deploy:
    ${needsJob ? `needs: ${needsJob}
    ` : ""}runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${awsRoleArn}
          role-session-name: ${normalized.awsSessionName ?? "autodeploy"}
          aws-region: ${awsRegion}
      - name: Sync assets to S3
        run: aws s3 sync ${outputDir} s3://${s3Bucket} --delete
      - name: Invalidate CloudFront cache
        run: aws cloudfront create-invalidation --distribution-id ${cloudFrontDistributionId} --paths '/*'
`);
        }

        const generated_yaml = `
name: CI/CD – AWS Static Frontend (Vite)

permissions:
  id-token: write
  contents: read

on:
  push:
    branches:
      - ${branch}

jobs:
${jobs.join("\n")}
`;

        return {
          success: true,
          data: {
            pipeline_name: `aws-aws_static_vite-ci.yml`,
            repo,
            branch,
            provider,
            template,
            options: options || {},
            stages: resolvedStages,
            generated_yaml,
            created_at: new Date().toISOString(),
          },
        };
      }

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
      const resolvedStages = Array.isArray(normalized.stages)
        ? normalized.stages
        : ["build", "test", "deploy"];
      const jobs = [];

      if (resolvedStages.includes("build")) {
        let runtimeSetupStep = "";
        if (template === "node_app") {
          runtimeSetupStep = `- name: Setup Node.js
    uses: actions/setup-node@v4
    with:
      node-version: ${normalized.nodeVersion ?? "20"}`;
        } else if (template === "python_app") {
          runtimeSetupStep = `- name: Setup Python
    uses: actions/setup-python@v5
    with:
      python-version: "3.x"`;
        }

        jobs.push(`
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      ${runtimeSetupStep}
      - name: Install Dependencies
        run: ${
          normalized.installCmd ??
          (template === "node_app" ? "npm ci" : "pip install -r requirements.txt")
        }
      - name: Build
        run: ${
          normalized.buildCmd ??
          (template === "node_app" ? "npm run build" : "echo 'No build step'")
        }
`);
      }

      if (resolvedStages.includes("test")) {
        jobs.push(`
  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Tests
        run: ${
          normalized.testCmd ?? (template === "node_app" ? "npm test" : "pytest")
        }
`);
      }

      if (resolvedStages.includes("deploy")) {
        const deployNeeds = resolvedStages.includes("test") ? "test" : "build";

        jobs.push(`
  deploy:
    needs: ${deployNeeds}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${normalized.awsRoleArn ?? "REPLACE_ME"}
          role-session-name: ${normalized.awsSessionName ?? "autodeploy"}
          aws-region: ${normalized.awsRegion ?? "us-east-1"}
      - name: Deploy Application
        run: echo "Deploying ${repo} to AWS..."
`);
      }

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
${jobs.join("\n")}
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
          stages: resolvedStages,
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
