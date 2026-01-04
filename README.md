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

Notable routes:
- `GET /health` – basic health check (used by the smoke test)
- `GET /db/ping` – database connectivity check (`server/db.js`)
- `/auth/github/*` – GitHub OAuth flow
- `/api/me` – session introspection (`requireSession`)
- `/deployments/*` – deployment log APIs (retry/rollback/dispatch)
- `/agent/*` – wizard orchestration endpoints
- `/mcp/v1/*` – MCP tool façade
- `/pipeline-sessions/*` – stateful wizard backed by Supabase tables

### MCP tools
Tools are registered in `server/tools/index.js` and exposed via `server/routes/mcp.js` at `/mcp/v1/:tool_name`.

Notable tools:
- `repo`, `repo_reader` – repository discovery and branch listing
- `pipeline_generator` – synthesizes CI/CD workflow YAML
- `oidc_adapter` – AWS OIDC role discovery/selection
- `github_adapter` – GitHub automation (upsert files, workflow dispatch)
- `gcp_adapter`, `scaffold_generator` – GCP workflow + Dockerfile scaffolding

Each tool defines:
- an `input_schema` (Zod)
- a `handler` function

### Frontend
The frontend lives under `client/` and is a React + TypeScript app built with Vite.

Key elements:
- pages/routes: `client/src/pages`, `client/src/routes`
- state: Zustand stores in `client/src/store`
- API layer: `client/src/lib/api.ts` (REST + `/mcp/v1/*` calls)
- UI components: `client/src/components`

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

## Project Structure

```text
AutoDeploy/
├── client/              # React + TypeScript + Vite frontend
├── server/              # Express backend, MCP tools, auth, deployment logging
├── test/                # smoke test(s)
├── package.json         # root scripts (dev/start/test)
└── client/package.json  # frontend scripts (dev/build/lint/preview)
```

## License
ISC (see `package.json`).
