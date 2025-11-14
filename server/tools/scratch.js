// scratch.js
import { aws_adapter } from "./aws_adapter.js";

console.log(
  aws_adapter.deploy_s3({
    sourceDir: "build",
    bucket: "my-bucket",
    prefix: "web",
    region: "us-west-2",
    roleToAssume: "arn:aws:iam::123456789012:role/GitHubOIDCDeployRole",
    cloudfrontDistributionId: "E123ABC456XYZ",
    cacheControl: "public,max-age=300,stale-while-revalidate=86400",
  })
);