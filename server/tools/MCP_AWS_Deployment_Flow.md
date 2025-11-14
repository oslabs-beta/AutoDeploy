# 🧩 MCP → AWS Deployment Flow Diagram

**File generated:** 2025-10-30 02:21:51 UTC

---

## 🧠 Overview

This diagram outlines how the MCP CI/CD Builder interacts with AWS when the **provider** is set to `aws`.

---

```mermaid
flowchart TD
    A[🧑 Developer Prompt] -->|Natural language command| B[MCP Wizard Agent]
    B --> C[pipeline_generator Tool]
    C -->|provider = "aws"| D[AWS Adapter (aws_adapter.js)]
    D --> E{{AWS SDK / OIDC Authentication}}
    E --> F1[S3: Upload Artifacts]
    E --> F2[ECS: Update Service]
    E --> F3[Lambda: Update Function]
    F1 --> G[(Deployed Resources)]
    F2 --> G
    F3 --> G
    G --> H[✅ Success Response to MCP]
    H --> I[Frontend Wizard: Display Deployment Info]
```

---

## ⚙️ Key Components

| Component | Description |
|------------|--------------|
| **MCP Wizard** | Frontend agent that captures developer intent |
| **pipeline_generator** | Generates YAML config and determines provider |
| **aws_adapter** | Handles S3, ECS, Lambda deployments using AWS SDK |
| **AWS OIDC / IAM Role** | Provides secure, keyless authentication |
| **AWS Resources** | S3 Buckets, ECS Services, or Lambda Functions |

---

## 🔐 Example IAM Trust Policy (OIDC)

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:sub": "repo:username/repo-name:ref:refs/heads/main"
      }
    }
  }]
}
```

---

## 🚀 Example Deployment Steps

1. Developer runs:  
   `node wizardAgent.js "Deploy repo my-app using AWS"`  
2. MCP identifies the repo, provider, and template.  
3. `pipeline_generator` calls the **AWS Adapter**.  
4. AWS Adapter uploads artifacts or triggers ECS/Lambda updates.  
5. MCP returns deployment status and URLs to the wizard.

---

**End of file.**
