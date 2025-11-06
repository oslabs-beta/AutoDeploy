// server/tools/aws_adapter.js
import { z } from "zod";
import { query } from "../db.js";

/**
 * aws_adapter
 * - Focus: produce GitHub Actions YAML snippets for AWS deploys.
 * - Start: simple S3 deploy (sync a folder to a bucket).
 *
 * Nothing here talks to AWS directly — that will happen in GitHub Actions
 * using OIDC + aws-actions/configure-aws-credentials.
 */

const DeployS3Schema = z.object({
  // The local build output directory (in the runner workspace)
  sourceDir: z.string().default("dist"),
  // Target S3 bucket
  bucket: z.string(),
  // Optional key prefix inside the bucket (e.g. "web/" -> s3://bucket/web/*)
  prefix: z.string().optional().default(""),
  // AWS region for the bucket
  region: z.string().default("us-east-1"),
  // OIDC role to assume from GitHub Actions (recommended)
  roleToAssume: z.string().optional(), // e.g. "arn:aws:iam::<ACCOUNT_ID>:role/GitHubOIDCDeployRole"
  // Optional CloudFront distribution to invalidate after upload
  cloudfrontDistributionId: z.string().optional(),
  // Optional Cache-Control applied to uploaded files
  cacheControl: z.string().optional(), // e.g. "public,max-age=300,stale-while-revalidate=86400"
});

/**
 * Retrieve AWS credentials and region for a given userId from the database.
 * Returns an object with roleToAssume and region if found, otherwise null.
 */
async function getUserAwsCredentials(userId) {
  if (!userId) return null;
  const res = await query(
    `SELECT role_to_assume, region FROM aws_connections WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  if (res.rows.length === 0) return null;
  const { role_to_assume, region } = res.rows[0];
  return {
    roleToAssume: role_to_assume || undefined,
    region: region || undefined,
  };
}

/**
 * Build the aws-actions/configure-aws-credentials step if roleToAssume is provided.
 */
function buildConfigureCredentialsStep({ roleToAssume, region }) {
  if (!roleToAssume) return null;
  return {
    name: "Configure AWS credentials (OIDC)",
    uses: "aws-actions/configure-aws-credentials@v4",
    with: {
      "role-to-assume": roleToAssume,
      "aws-region": region,
    },
  };
}

/**
 * Build the S3 sync step using AWS CLI.
 * We install awscli via pip since runners have Python preinstalled.
 */
function buildS3SyncSteps({ sourceDir, bucket, prefix, cacheControl }) {
const s3Uri = `s3://${bucket}${prefix ? `/${prefix.replace(/^\//, "")}` : ""}`;
const cacheArg = cacheControl ? `--cache-control "${cacheControl}"` : "";
  return [
    {
      name: "Install AWS CLI",
      run: [
        "python -m pip install --upgrade pip",
        "pip install awscli --upgrade --user",
        'echo "$HOME/.local/bin" >> $GITHUB_PATH',
      ].join("\n"),
    },
    {
      name: `Sync ${sourceDir} -> ${s3Uri}`,
      run: `aws s3 sync ${sourceDir} ${s3Uri} --delete ${cacheArg}`.trim(),
    },
  ];
}

function buildCloudFrontInvalidateStep({ cloudfrontDistributionId }) {
  if (!cloudfrontDistributionId) return null;
  return {
    name: "Invalidate CloudFront cache",
    run: `aws cloudfront create-invalidation --distribution-id ${cloudfrontDistributionId} --paths "/*"`,
  };
}

/**
 * Public API
 */
export const aws_adapter = {
  name: "aws",

  /**
   * Generate GitHub Actions "steps" for deploying a folder to S3.
   * Returns a plain JS object that your pipeline_generator can embed into a job.
   * Accepts optional userId to fetch AWS credentials automatically.
   */
  async deploy_s3(input) {
    let cfgInput = input;
    if (input.userId) {
      const creds = await getUserAwsCredentials(input.userId);
      if (creds) {
        // Merge credentials and region into input, but preserve explicit inputs if provided
        cfgInput = {
          ...input,
          region: input.region || creds.region,
          roleToAssume: input.roleToAssume || creds.roleToAssume,
        };
      }
      // Remove userId before parsing schema
      delete cfgInput.userId;
    }

    const cfg = DeployS3Schema.parse(cfgInput);

    const steps = [];

    const credStep = buildConfigureCredentialsStep({
      roleToAssume: cfg.roleToAssume,
      region: cfg.region,
    });
    if (credStep) steps.push(credStep);

    steps.push(...buildS3SyncSteps(cfg));

    const invalidate = buildCloudFrontInvalidateStep(cfg);
    if (invalidate) steps.push(invalidate);

    return {
      kind: "aws.s3.deploy",
      summary: `Sync ${cfg.sourceDir} to s3://${cfg.bucket}${cfg.prefix ? "/" + cfg.prefix : ""} in ${cfg.region}.`,
      steps,
      hints: [
        "Ensure your AWS OIDC role trusts GitHub and maps the repo/ref you deploy from.",
        "Bucket must exist and the role must have s3:PutObject, s3:ListBucket, s3:DeleteObject.",
        cfg.cloudfrontDistributionId
          ? "Role also needs cloudfront:CreateInvalidation."
          : "Add a CloudFront distribution ID if you want cache invalidation.",
      ],
    };
  },
};

export { getUserAwsCredentials };