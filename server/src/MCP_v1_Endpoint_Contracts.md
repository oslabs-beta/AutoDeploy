# MCP v1 – Endpoint Contracts (Current)

## Base & Auth
- **Base URL:** `/mcp/v1`
- **Session:** Most endpoints require the `mcp_session` JWT cookie (`requireSession`). Tool routes also enforce `requireCapability(Actions.USE_MCP_TOOL)`.
- **Headers:** `x-user-id` is logged when present; `x-request-id` is echoed (and also returned in the payload as `request_id`). API key headers are **not** used for v1 in this app.
- **Envelope:** Successful MCP tool responses use `{ success: true, data, request_id }`. MCP-scoped commit/history/rollback routes use `{ ok: true, data?, message?, request_id }`.
- **Error shape:** `{ success|ok: false, error: { code, message, details? }, request_id }`.

## Registered Tools (via `server/routes/mcp.js`)
The router dispatches to any tool in `server/tools/index.js` and injects `user_id` + `github_username` from the session before validation.

- `status` (public): `GET /mcp/v1/status`
- `github_adapter` (explicit): `ALL /mcp/v1/github/:action` or `/mcp/v1/github`
- Dynamic tools: `ALL /mcp/v1/:tool_name` for:
  - `repo_reader`
  - `pipeline_generator`
  - `oidc_adapter`
  - `gcp_adapter`
  - `scaffold_generator`

Additional MCP-scoped routes (separate routers):
- `POST /mcp/v1/pipeline_commit`
- `GET /mcp/v1/pipeline_history`
- `POST /mcp/v1/pipeline_rollback`

---

## Endpoint Details

### Status
- **Path:** `GET /mcp/v1/status`
- **Response:** `{ success: true, data: { status: "ok", version: "v1.0.0", tools_registered: [ ... ], timestamp }, request_id }`

### GitHub Adapter
- **Path:** `ALL /mcp/v1/github/:action` (or `/mcp/v1/github` with `action` defaulting to `repos`)
- **Actions:** `repos`, `info`, `branches`, `commits`, `workflows`, `get_repo`, `contents`, `file`
- **Payload:** `{ action, repo?, path?, page?, per_page? }` (`user_id` injected from session)
- **Responses (shape varies):**
  - `repos` → `{ success: true, repositories: [{ repo_name, default_branch, language, stars, visibility }] }`
  - `branches` → `{ success: true, branches: [{ name, protected }] }`
  - `commits` → `{ success: true, commits: [{ sha, author, date, message }] }`
  - `workflows` → `{ success: true, workflows: [{ name, id, state, path }] }`
  - `contents` → `{ success: true, contents: [{ name, path, type, size }] }`
  - `file` → `{ success: true, file: { name, path, encoding, content } }`
  - `info/get_repo` → `{ success: true, repo_name, default_branch, language, stars, visibility }`

### Repo Reader
- **Path:** `ALL /mcp/v1/repo_reader`
- **Payload:** `{ provider="github", username?, repo?, user_id? }`
- **Response:**
  - Listing → `{ success: true, data: { provider, user, repositories: [{ name, full_name, default_branch, private, language, html_url, branches }], fetched_at } }`
  - Single repo → `{ success: true, data: { repository: { ... }, fetched_at } }`

### Pipeline Generator
- **Path:** `POST /mcp/v1/pipeline_generator`
- **Payload:** `{ repo, branch="main", provider="aws"|"jenkins"|"gcp", template: "node_app"|"python_app"|"container_service", stages?, options? }`
- **Response:**
  - GCP delegates to `gcp_adapter` → `{ success: true, data: { pipeline_name: "gcp-cloud-run-ci.yml", provider: "gcp", template: "node_app", stages: ["build","deploy"], generated_yaml } }`
  - AWS/Jenkins mock → `{ success: true, data: { pipeline_name: "<provider>-<template>-ci.yml", repo, branch, provider, template, stages, generated_yaml, created_at } }`

### OIDC Adapter
- **Path:** `POST /mcp/v1/oidc_adapter`
- **Payload:** `{ provider: "aws"|"jenkins"|"gcp" }` (handler currently supports aws|jenkins)
- **Response:**
  - AWS → `{ provider: "aws", roles: [{ name, arn }], fetched_at }`
  - Jenkins → `{ provider: "jenkins", jobs: [{ name, url }], fetched_at }`

### GCP Adapter (Cloud Run YAML)
- **Path:** `POST /mcp/v1/gcp_adapter`
- **Payload:** Large schema covering project/region/service account, backend/frontend services, artifact registry repos, Dockerfile paths, ports, `generate_dockerfiles` flag, etc. Key fields: `branch` (default `main`), `gcp_project_id`, `gcp_region`, `workload_identity_provider`, `service_account_email`.
- **Response:** `{ success: true, data: { pipeline_name: "gcp-cloud-run-ci.yml", provider: "gcp", template: "node_app", stages: ["build","deploy"], generated_yaml } }`

### Scaffold Generator
- **Path:** `POST /mcp/v1/scaffold_generator`
- **Payload:** `{ backendPath="backend", frontendPath="frontend" }`
- **Response:** `{ ok: true, files: [{ path, content }, ...] }` (Dockerfiles and `.dockerignore` for backend/frontend)

### Pipeline Commit
- **Path:** `POST /mcp/v1/pipeline_commit`
- **Auth:** `requireSession`
- **Payload:** `{ repoFullName | repoUrl, branch="main", yaml, path?, provider="gcp", workflowName?, message? }`
- **Behavior:** Normalizes repo, writes/updates workflow file via GitHub, logs `deployment_logs`, saves `pipeline_versions`.
- **Response:** `{ ok: true, message, data: <github upsert result>, request_id }`

### Pipeline History
- **Path:** `GET /mcp/v1/pipeline_history`
- **Auth:** `requireSession`
- **Query:** `repoFullName` (required), `branch` (default `main`), `path` (default `.github/workflows/ci.yml`), `limit` (default 20, max 100)
- **Response:** `{ ok: true, versions: <pg query result with rows of pipeline_versions>, request_id }`

### Pipeline Rollback
- **Path:** `POST /mcp/v1/pipeline_rollback`
- **Auth:** `requireSession`
- **Payload:** `{ versionId }`
- **Behavior:** Fetches selected version, recommits YAML to GitHub, logs `deployment_logs`, stores a new `pipeline_versions` entry.
- **Response:** `{ ok: true, message, data: { github, deployment }, request_id }`
