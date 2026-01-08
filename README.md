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
- [Database Setup](#database-setup)
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

Each tool defines:

- an `input_schema` (Zod)
- a `handler` function
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

- pages/routes: `client/src/pages`, `client/src/routes`
- state: Zustand stores in `client/src/store`
- API layer: `client/src/lib/api.ts` (REST + `/mcp/v1/*` calls)
- UI components: `client/src/components`
- Pages and routes in `client/src/pages` and `client/src/routes` implement the connect/login flow, configuration wizard, secrets management, Jenkins page, dashboard, and 404.
- Zustand stores in `client/src/store` (e.g., `usePipelineStore`, `useWizardStore`, `useDeployStore`, `useAuthStore`, `useConfigStore`) hold wizard selections, auth/session info, pipeline generation results, secrets/preflight state, and deployment data.
- `client/src/lib/api.ts` wraps REST and MCP calls, handles GitHub OAuth redirects, caches AWS roles and repo lists, and orchestrates pipeline commit and rollback.
- UI components under `client/src/components` include shared primitives (`ui/`), layout and nav (`common/`), wizard steps (`wizard/`), and dashboard widgets (`dashboard/`).

In development, the frontend talks to the backend through a Vite dev server proxy:

- `BASE = import.meta.env.VITE_API_BASE || "/api"`
- In dev, `BASE` is typically `/api`, which is proxied to the Express backend.
- `SERVER_BASE` is derived from `BASE` for direct `/mcp/v1/*` and `/auth/*` calls.

## Getting Started

### Quick-start env checklist (minimal local setup)

For a basic local setup (GitHub login + Postgres + wizard UI), you’ll need at least:

- `DATABASE_URL` – Postgres connection string.
- `PORT` – optional, defaults to `3000`.
- `GITHUB_CLIENT_ID` – from your GitHub OAuth app.
- `GITHUB_CLIENT_SECRET` – from your GitHub OAuth app.
- `GITHUB_OAUTH_REDIRECT_URI` – usually `http://localhost:3000/auth/github/callback` for local dev.
- `FRONTEND_URL` – usually `http://localhost:5173/connect` for local dev.
- `GITHUB_OAUTH_SCOPES` – e.g. `repo workflow read:user user:email`.
- `JWT_SECRET` – random secret string (used for sessions).
- `SESSION_SECRET` – random secret string for AWS/session flows.
- `SUPABASE_URL` – your Supabase project URL.
- `SUPABASE_SERVICE_ROLE` – Supabase service role key.

Optional but recommended for full wizard functionality:

- `OPENAI_API_KEY` – to enable the AI wizard agent.

Once these are set in a `.env` at the repo root, you can run the backend and frontend as described below.

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

The backend uses `dotenv` and environment variables. If you fork this repo and want a fully working setup, you’ll need to configure the following groups of variables.

### 1. Core backend + database (required)

- **`DATABASE_URL`** – Postgres connection string
  - Example: `postgresql://USER:PASSWORD@HOST:5432/DB_NAME`
  - Used in `server/db.js` to create the connection pool.
- **`PORT`** – HTTP port for the Express server (default: `3000`).

### 2. GitHub OAuth (required for login + GitHub access)

Create a GitHub OAuth app and configure:

- **`GITHUB_CLIENT_ID`** – OAuth app client ID.
- **`GITHUB_CLIENT_SECRET`** – OAuth app client secret.
- **`GITHUB_OAUTH_REDIRECT_URI`** – must match the callback URL configured in the GitHub OAuth app.
  - Local dev: `http://localhost:3000/auth/github/callback`
  - Production: `https://your-backend.example.com/auth/github/callback`
- **`GITHUB_OAUTH_SCOPES`** – suggested: `repo workflow read:user user:email`.
- **`FRONTEND_URL`** – where to redirect after a successful login.
  - Local dev: `http://localhost:5173/connect`
  - Should point to your frontend’s `/connect` route.
- **`JWT_SECRET`** – secret used to sign the `mcp_session` cookie and other tokens.

These are wired in `server/routes/auth.github.js` and are required for GitHub login and pulling repo data.

### 3. Authentication / sessions (required)

- **`SESSION_SECRET`** – legacy/session secret used by some AWS auth flows.
- **`JWT_SECRET`** – (same as above) used by `requireSession` and token encryption.

Use strong, random values for both in any non-local environment.

### 4. Supabase (required if you use the built-in DB schema)

AutoDeploy expects a Postgres database, and many user/session features assume a Supabase project:

- **`SUPABASE_URL`** – your Supabase project URL.
- **`SUPABASE_SERVICE_ROLE`** – Supabase service role key (keep this secret!).

These are read in `server/lib/requireSession.js` to load user records.

### 5. OpenAI / MCP Wizard (optional but recommended)

If you want to use the AI "wizard" flows (LLM-powered suggestions, repo analysis, etc.):

- **`OPENAI_API_KEY`** – OpenAI API key used by `server/agent/wizardAgent.js`.

Additionally, when running tools/agents outside the normal HTTP session, you can provide:

- **`MCP_SESSION_TOKEN`** – a pre-issued JWT that represents a user; used by `pipeline_generator` and `wizardAgent` when there is no cookie.

Without these, the core backend still runs, but the wizard agent will be disabled.

### 6. GitHub token override (optional)

By default, AutoDeploy uses per-user GitHub OAuth tokens stored in the database. For demos or single-user setups, you can override this with a Personal Access Token:

- **`GITHUB_PAT_OVERRIDE`** – when set, all GitHub API calls use this PAT instead of per-user tokens.

### 7. Google / GCP OAuth (optional, only for GCP integration)

If you want to connect Google Cloud (for GCP workflows and credentials):

- **`GOOGLE_CLIENT_ID`** – Google OAuth client ID.
- **`GOOGLE_CLIENT_SECRET`** – Google OAuth client secret.
- **`GOOGLE_REDIRECT_URI`** – must match the redirect URI configured in the Google OAuth client.
  - Local dev: `http://localhost:3000/auth/google/callback`
  - Production: `https://your-backend.example.com/auth/google/callback`

These are used in `server/tools/google_adapter.js` to store encrypted GCP tokens.

### 8. MCP core (optional / advanced)

If you are running a separate MCP core and want the backend to talk to it directly:

- **`MCP_URL`** – base URL of the MCP core (default `http://localhost:7000`).
- **`MCP_API_KEY`** – API key expected by that core.

These are mainly used in development paths (e.g. mock MCP core under `server/src/scripts/mockMcp.js`).

## Database Setup

AutoDeploy expects a Postgres database (often via Supabase). To recreate the core schema used by this project:

1. Ensure `DATABASE_URL` in your `.env` points at your Postgres instance.
2. Apply the schema file:

```bash
psql "$DATABASE_URL" -f server/db/schema.sql
```

This will create the `users`, `connections`, `deployment_logs`, `pipeline_versions`, `aws_connections`, `aws_device_sessions`, `pipeline_sessions`, `pipeline_events`, and `github_repos` tables (plus a few supporting types and indexes) that AutoDeploy uses.

If you are using Supabase, you can also paste the contents of `server/db/schema.sql` into the Supabase SQL editor and run it once.

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

ISC — see the `LICENSE` file for the full text.

You are free to clone, modify, and self-host AutoDeploy under the terms of the ISC license. If you build something on top of it, attribution in your docs or UI is appreciated but not required.

This project integrates with third-party services (for example GitHub, OpenAI, and various cloud providers). You are responsible for complying with their respective terms of service and for securing any API keys and secrets you configure.

AutoDeploy is provided “as is”, without any guarantees. Review the code, environment variables, and database schema before using it in production, and ensure it fits your organization’s security, compliance, and data-handling requirements.

If you discover a security issue, please avoid filing a public issue and instead contact the maintainer privately (for example via the email listed in the repository owner’s GitHub profile).

Contributions are welcome via pull requests and issues. By contributing, you agree that your contributions will be licensed under the same ISC license as this repository.
