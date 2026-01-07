# AutoDeploy

Auto-generated secure CI/CD pipelines with AI + MCP.

AutoDeploy is a full-stack monorepo that:
- connects to GitHub (OAuth)
- analyzes repositories
- generates GitHub Actions workflows (AWS/GCP)
- commits workflows to repos
- tracks deployments and supports rollback

## Table of Contents
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
  - [Backend](#backend)
  - [MCP tools](#mcp-tools)
  - [Frontend](#frontend)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Run (backend)](#run-backend)
  - [Run (frontend)](#run-frontend)
  - [MCP mock core + agent (local)](#mcp-mock-core--agent-local)
- [Environment Configuration](#environment-configuration)
- [GCP (Cloud Run) Usage](#gcp-cloud-run-usage)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [License](#license)

## Features
- GitHub OAuth to securely link a GitHub account and discover repos/branches.
- Repository analysis and CI/CD pipeline generation via MCP tools.
- Commit, version history, and rollback for GitHub Actions workflow YAMLs.
- Deployment logging with retry/rollback support and workflow dispatch APIs.
- React + TypeScript wizard UI for configuring providers, templates, secrets, and deployments.

## Tech Stack

### Frontend
- React + TypeScript
- Vite
- Tailwind CSS
- Zustand (client state)

### Backend
- Node.js (ESM)
- Express
- Zod (tool input validation)
- PostgreSQL (optionally via Supabase)

### Integrations
- GitHub OAuth
- GitHub Actions (workflow generation + commit, history/rollback)
- GCP Cloud Run + Artifact Registry (Workload Identity Federation / OIDC)
- AWS OIDC (role discovery/selection)

## Architecture

### Backend
The backend lives under `server/` and is an Express app (ESM) exposing REST endpoints and an MCP-style tool router.

Key entry point:
- `server/server.js` – bootstraps the Express app, middleware, and routes.

Important route groups include:

- `GET /health` – basic health check (used by the smoke test).
- `GET /db/ping` – checks database connectivity via `healthCheck()` in `server/db.js`.
- `/auth/github/*` – GitHub OAuth flow plus `/auth/github/me` inspection.
- `/auth/local/*`, `/auth/google/*` – additional auth flows.
- `/api/me` – session introspection (uses `requireSession`).
- `/users`, `/connections` – basic user and connection CRUD backed by Postgres.
- `/deployments/*` – deployment logs API, including retry, rollback, and workflow dispatch.
- `/agent/*` – higher‑level "wizard" orchestration endpoints.
- `/mcp/v1/*` – MCP tool façade (see below).
- `/pipeline-sessions/*` – multi‑step pipeline wizard backed by Supabase tables.
- `/api/rag/*` – repository RAG APIs (GitHub + zip ingest, query, logs) backed by Pinecone + Supabase; see `server/src/RAG_API_Contracts.md` for full contracts.
- `/api/connections` – GitHub connection status endpoint used by the Secrets step to confirm that a GitHub token exists and has write access for the selected repo.
- `/api/secrets/github/*` – GitHub Actions secrets presence + upsert endpoints used by the Secrets step to check and create `AWS_ROLE_ARN` (repo/env level) without exposing values.

The backend expects a Postgres database (e.g., via a Supabase connection string) configured in `server/db.js`.

### MCP tools
Tools are registered in `server/tools/index.js` and exposed via `server/routes/mcp.js` at `/mcp/v1/:tool_name`.

Notable tools:
- `repo`, `repo_reader` – repository discovery and branch listing
- `pipeline_generator` – synthesizes CI/CD workflow YAML
- `oidc_adapter` – AWS OIDC role discovery/selection
- `github_adapter` – GitHub automation (upsert files, workflow dispatch)
- `gcp_adapter`, `scaffold_generator` – GCP workflow + Dockerfile scaffolding

- `repo`, `repo_reader` → repository discovery and branch listing.
- `pipeline_generator` → synthesizes CI/CD workflow YAML.
- `oidc`, `oidc_adapter` → handles AWS OIDC roles and related configuration.
- `github`, `github_adapter` → GitHub automation (e.g., file upserts, workflow dispatch).
- `gcp`, `gcp_adapter`, `scaffold`, `scaffold_generator` → GCP‑specific workflow scaffolding.
- `rag_ingest_zip`, `rag_ingest_github`, `rag_query_namespace`, `rag_get_logs` → local repo RAG tools (Pinecone embeddings + Supabase logs) used by MCP v2 and `/api/rag`.

Each tool defines an `input_schema` (Zod) and a `handler` function. The `mcp` route:

- Injects `user_id` and `github_username` from the current session.
- Validates input using the tool’s schema.
- Normalizes responses to `{ success: true/false, data | error }`.

> **Note:** The autodeploy-landing marketing site and docs now call these MCP v1 endpoints directly for live demos (e.g., `repo_reader` and `pipeline_history`) when pointed at the same backend, so changes to `/mcp/v1/*` should keep the v1 envelopes and contracts stable.

### Frontend
The frontend lives under `client/` and is a React + TypeScript app built with Vite.

Key elements:

- Pages and routes in `client/src/pages` and `client/src/routes` implement the connect/login flow, configuration wizard, secrets management, Jenkins page, dashboard, and 404.
- Zustand stores in `client/src/store` (e.g., `usePipelineStore`, `useWizardStore`, `useDeployStore`, `useAuthStore`, `useConfigStore`) hold wizard selections, auth/session info, pipeline generation results, secrets/preflight state, and deployment data.
- `client/src/lib/api.ts` wraps REST and MCP calls, handles GitHub OAuth redirects, caches AWS roles and repo lists, and orchestrates pipeline commit and rollback.
- UI components under `client/src/components` include shared primitives (`ui/`), layout and nav (`common/`), wizard steps (`wizard/`), and dashboard widgets (`dashboard/`).

In development, the frontend talks to the backend through a Vite dev server proxy:

- `BASE = import.meta.env.VITE_API_BASE || "/api"`
- In dev, `BASE` is typically `/api`, which is proxied to the Express backend.
- `SERVER_BASE` is derived from `BASE` for direct `/mcp/v1/*` and `/auth/*` calls.

## Getting Started

### Prerequisites
- Node.js + npm
- Postgres (e.g., Supabase connection string)
- GitHub OAuth app credentials

### Installation
From the repo root:

```bash
npm install
```

Frontend dependencies:

```bash
cd client
npm install
```

### Run (backend)
From the repo root:

```bash
# watch mode (Express + Nodemon)
npm run dev

# production mode
npm start
```

The backend listens on `PORT` (default `3000`).

### Run (frontend)
From `client/`:

```bash
npm run dev
```

The Vite dev server defaults to port `5173`.

### MCP mock core + agent (local)
Useful for developing MCP integration without a real MCP core.

```bash
cd server

# 1) Start mock MCP core (expects Bearer dev-key-123)
node src/scripts/mockMcp.js

# 2) Run MCP agent directly
node src/agents/mcpAgent.js
```

Example `.env` values:

```bash
MCP_URL=http://localhost:7070
MCP_API_KEY=dev-key-123
```

## Environment Configuration
The backend uses `dotenv` and environment variables.

Common variables:
- MCP:
  - `MCP_URL` (default `http://localhost:7000`)
  - `MCP_API_KEY`
- GitHub OAuth:
  - `GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_SECRET`
  - `GITHUB_OAUTH_REDIRECT_URI`
  - `GITHUB_OAUTH_SCOPES`
  - `FRONTEND_URL` (default `http://localhost:5173/connect`)
  - `JWT_SECRET` (signs the `mcp_session` cookie)
- Server:
  - `PORT` (default `3000`)
  - Postgres connection (see `server/db.js`)

## GCP Cloud Run Usage

### What AutoDeploy generates
When you select the **GCP** provider, AutoDeploy generates a GitHub Actions workflow that:
- builds Docker images and pushes them to GHCR
- authenticates to Google Cloud using **Workload Identity Federation (OIDC)**
- pushes images to **Artifact Registry**
- deploys **Cloud Run** services

### Repo prerequisites
Recommended repo layout:
- `server/` (backend)
- `client/` (frontend)

AutoDeploy can scaffold Dockerfiles into these folders from the Dashboard.

### Required GitHub Actions secrets
Set these as **repository secrets** (GitHub repo → Settings → Secrets and variables → Actions):
- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GCP_WIF_PROVIDER` (full Workload Identity Provider resource name)
- `GCP_DEPLOY_SA_EMAIL` (service account email)

### Generate + commit the workflow
1. In AutoDeploy UI: pick the target repo + branch.
2. Go to **Configure**:
   - set **Provider = GCP**
   - choose stages (Build/Deploy)
   - optionally override Cloud Run service names, docker contexts, and image names.
3. Click **Generate pipeline**.
4. Go to **Dashboard**:
   - Step 1: generate/commit Dockerfiles into `server/` + `client/` (if needed)
   - Step 2: commit the generated workflow YAML to the repo

### Troubleshooting

#### GHCR push denied (permission_denied: write_package)
If the workflow fails pushing to `ghcr.io/*`:
- ensure the repo allows **Workflow permissions → Read and write**
- check GitHub package permissions for the target container image name
- consider using repo-specific image names to avoid collisions

#### WIF auth fails (unauthorized_client / attribute condition)
This indicates your Workload Identity Provider or service account IAM binding is rejecting the GitHub OIDC token.
- verify the provider’s attribute condition matches the repo (e.g. `owner/repo`) and branch you are deploying from
- verify the service account grants **Workload Identity User** to the correct principalSet/principal

## Testing
Run the smoke test (backend must be running locally):

```bash
npm test
```

This runs `node test/smoke.test.js`, which calls `GET /health` and expects `{ ok: true }`.

Additional tests:

```bash
# Run authorization tests for Workflow Copilot / RAG gating
node --test test/authorization.test.js
```

These cover:

- `isPro(user)` behavior for free vs pro vs beta-pro users.
- `can(user, Actions.USE_AGENT)` (agent + RAG gating) vs `can(user, Actions.USE_MCP_TOOL)` (MCP access for all authenticated users).

### Additional backend tests

- `node --test server/tests/pipelineGeneratorYaml.test.js` – sanity-checks that `pipeline_generator` always emits syntactically valid GitHub Actions YAML for the main templates (`node_app`, `python_app`). This guards against indentation/`with:` mapping regressions.

## Project Structure

```text
AutoDeploy/
├── client/              # React + TypeScript + Vite frontend
├── server/              # Express backend, MCP tools, auth, deployment logging
├── test/                # smoke test(s)
├── package.json         # root scripts (dev/start/test)
└── client/package.json  # frontend scripts (dev/build/lint/preview)
```

## Repo housekeeping

Most internal Markdown documentation (design docs, technical notes, etc.) is intentionally not tracked in git. By default, only the root `README.md` and `client/README.md` are versioned to keep the repo lean.

## License
ISC (see `package.json`).
