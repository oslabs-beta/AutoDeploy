# MCP v1 – Endpoint Contracts (Mock-Backed)

## Common
- **Base URL:** `/mcp/v1`
- **Auth headers:**
  - `x-mcp-api-key: <string>`
  - `x-user-id: <uuid | string>` (for logging/user context)
- **Error shape (all endpoints):**
```json
{
  "error": {
    "code": "BAD_REQUEST | UNAUTHORIZED | INTERNAL",
    "message": "Human readable message",
    "details": { "optional": "context" }
  }
}
```

---

## 1) Repo Reader
**Path:** `GET /mcp/v1/repo_reader`  
**Query params (optional):** `provider=github` (defaults to `github`)

### Response (200)
```json
{
  "user": "alex-python",
  "provider": "github",
  "repositories": [
    { "name": "ci-cd-demo", "full_name": "org/ci-cd-demo", "branches": ["main","dev","feature/auth"] },
    { "name": "askmyrepo", "full_name": "org/askmyrepo", "branches": ["main","staging"] }
  ],
  "fetched_at": "2025-10-15T18:45:00Z"
}
```

### Why the frontend cares
- Fill a **repo selector** + **branch selector** in the wizard.
- No pagination yet; mock returns a small curated set.

---

## 2) Pipeline Generator
**Path:** `POST /mcp/v1/pipeline_generator`

### Request Body
```json
{
  "repo": "org/ci-cd-demo",
  "branch": "main",
  "provider": "aws | jenkins",
  "template": "node_app | python_app | container_service",
  "options": {
    "run_tests": true,
    "include_trivy_scan": true,
    "artifact_name": "app-image"
  }
}
```

### Response (200)
```json
{
  "pipeline_name": "aws-node-ci.yml",
  "language": "node",
  "stages": ["build","test","deploy"],
  "generated_yaml": "name: CI/CD Pipeline\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n      - run: npm ci && npm test\n  deploy:\n    needs: build\n    runs-on: ubuntu-latest\n    steps:\n      - uses: aws-actions/configure-aws-credentials@v4\n      - run: echo Deploying...",
  "metadata": {
    "provider": "aws",
    "oidc_required": true,
    "created_at": "2025-10-15T18:45:00Z"
  }
}
```

### Why the frontend cares
- Preview YAML, allow **“Save to repo”** later.
- Show which stages will run and toggle options.

---

## 3) OIDC Adapter (AWS or Jenkins)
**Path:** `POST /mcp/v1/oidc_adapter`

### Request Body
```json
{
  "provider": "aws | jenkins"
}
```

### Response (200) – AWS
```json
{
  "provider": "aws",
  "roles": [
    { "name": "mcp-deploy-role", "arn": "arn:aws:iam::123456789012:role/mcp-deploy-role" },
    { "name": "mcp-staging-role", "arn": "arn:aws:iam::123456789012:role/mcp-staging-role" }
  ],
  "fetched_at": "2025-10-15T18:45:00Z"
}
```

### Response (200) – Jenkins
```json
{
  "provider": "jenkins",
  "jobs": [
    { "name": "build_main", "url": "https://jenkins.example.com/job/build_main" },
    { "name": "deploy_staging", "url": "https://jenkins.example.com/job/deploy_staging" }
  ],
  "fetched_at": "2025-10-15T18:45:00Z"
}
```

### Why the frontend cares
- Populate **Role/Job** dropdowns during deploy setup.

---

## 4) (Stretch) Status
**Path:** `GET /mcp/v1/status`

### Response (200)
```json
{
  "status": "ok",
  "version": "v1.0.0",
  "timestamp": "2025-10-15T18:45:00Z"
}
```

---

# Next Steps (tonight)
1) **Wire routes in `server.js`** to return the above mock payloads.  
2) Add simple request logging: `x-user-id`, endpoint, and timestamp.  
3) Keep the handler signatures stable so we can swap in real MCP calls later.

---

## ✅ Checkpoint
Confirm when ready to proceed to wiring these endpoints into `server.js`.
