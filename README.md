# AutoDeploy

Auto-Generated Secure CI/CD Pipelines with AI + MCP.

AutoDeploy is a full‑stack project that helps you analyze repositories, generate CI/CD workflows, and safely track and roll back deployments using an AI‑assisted MCP (Model Context Protocol) backend and a React wizard frontend.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
  - [Backend](#backend)
  - [MCP tools](#mcp-tools)
  - [Frontend](#frontend)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the backend](#running-the-backend)
  - [Running the frontend](#running-the-frontend)
  - [Running the MCP mock core and agent](#running-the-mcp-mock-core-and-agent)
- [Environment Configuration](#environment-configuration)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [License](#license)

---

## Features

- GitHub OAuth integration to securely link a GitHub account and fetch repository information.
- Repository analysis and CI/CD pipeline generation via MCP tools.
- Pipeline commit, history, and rollback for GitHub Actions workflow YAMLs.
- Deployment logging with retry/rollback support and workflow dispatch APIs.
- React + TypeScript wizard UI for configuring providers, templates, secrets, and deployments.

## Architecture

### Backend

The backend lives under `server/` and is an Express application (ESM) that exposes both REST and MCP‑style endpoints.

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

The backend expects a Postgres database (e.g., via a Supabase connection string) configured in `server/db.js`.

### MCP tools

Internal MCP tools are registered in `server/tools/index.js` and exposed over HTTP through `server/routes/mcp.js` at `/mcp/v1/:tool_name`.

Notable tools:

- `repo`, `repo_reader` → repository discovery and branch listing.
- `pipeline_generator` → synthesizes CI/CD workflow YAML.
- `oidc`, `oidc_adapter` → handles AWS OIDC roles and related configuration.
- `github`, `github_adapter` → GitHub automation (e.g., file upserts, workflow dispatch).
- `gcp`, `gcp_adapter`, `scaffold`, `scaffold_generator` → GCP‑specific workflow scaffolding.

Each tool defines an `input_schema` (Zod) and a `handler` function. The `mcp` route:

- Injects `user_id` and `github_username` from the current session.
- Validates input using the tool’s schema.
- Normalizes responses to `{ success: true/false, data | error }`.

### Frontend

The frontend lives under `client/` and is a React + TypeScript app built with Vite and Tailwind.

Key elements:

- Pages and routes in `client/src/pages` and `client/src/routes` implement the connect/login flow, configuration wizard, secrets management, Jenkins page, dashboard, and 404.
- Zustand stores in `client/src/store` (e.g., `usePipelineStore`, `useWizardStore`, `useDeployStore`, `useAuthStore`) hold wizard selections, auth/session info, pipeline generation results, and deployment data.
- `client/src/lib/api.ts` wraps REST and MCP calls, handles GitHub OAuth redirects, caches AWS roles and repo lists, and orchestrates pipeline commit and rollback.
- UI components under `client/src/components` include shared primitives (`ui/`), layout and nav (`common/`), wizard steps (`wizard/`), and dashboard widgets (`dashboard/`).

In development, the frontend talks to the backend through a Vite dev server proxy:

- `BASE = import.meta.env.VITE_API_BASE || "/api"`
- In dev, `BASE` is typically `/api`, which is proxied to the Express backend.
- `SERVER_BASE` is derived from `BASE` for direct `/mcp/v1/*` and `/auth/*` calls.

## Getting Started

### Prerequisites

- Node.js and npm installed.
- A Postgres database (e.g., Supabase) for the backend.
- A GitHub OAuth app for GitHub integration.

### Installation

From the repo root, install backend dependencies:

```bash
npm install
```

Then install frontend dependencies:

```bash
cd client
npm install
```

### Running the backend

From the repo root:

```bash
# Start backend in watch mode (Express + Nodemon)
npm run dev

# Start backend in production mode
npm start
```

By default the server listens on `PORT` or `3000`.

### Running the frontend

From the `client/` directory:

```bash
cd client
npm run dev
```

The Vite dev server defaults to port `5173`.

### Running the MCP mock core and agent

For local development of the MCP integration without a real MCP core, you can use the mock server and standalone agent under `server/src`.

From the `server/` directory:

```bash
# 1. Start the mock MCP core (expects Bearer dev-key-123)
cd server
node src/scripts/mockMcp.js

# 2. Run the MCP agent directly (uses MCP_URL and MCP_API_KEY)
node src/agents/mcpAgent.js
```

Example `.env` values for this flow (placed in `server/.env` or the repo root):

```bash
MCP_URL=http://localhost:7070
MCP_API_KEY=dev-key-123
```

## Environment Configuration

The backend uses `dotenv` and environment variables for configuration.

Key variables include (non‑exhaustive):

- **MCP integration** (`server/src/config/env.js`)
  - `MCP_URL` – URL of the MCP core (default `http://localhost:7000`).
  - `MCP_API_KEY` – API key used in `Authorization: Bearer` headers.
- **GitHub OAuth** (`server/routes/auth.github.js`)
  - `GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_SECRET`
  - `GITHUB_OAUTH_REDIRECT_URI`
  - `GITHUB_OAUTH_SCOPES`
  - `FRONTEND_URL` – post‑login redirect (default `http://localhost:5173/connect`).
  - `JWT_SECRET` – used to sign the `mcp_session` cookie.
- **Server**
  - `PORT` – Express listen port (default `3000`).
  - Database connection settings (see `server/db.js`), typically a Postgres connection string.

Authentication/session details:

- A JWT‑based session is stored in an `mcp_session` cookie.
- `server/lib/requireSession.js` reads this cookie and sets `req.user` and `req.supabase`.
- Most MCP and deployment‑related routes require a valid session.

## Testing

From the repo root, run the smoke test (requires the backend to be running locally):

```bash
npm test
```

This runs `node test/smoke.test.js`, which calls `GET /health` on the backend and fails if the response is not `{ ok: true }`.

## Project Structure

High‑level layout:

```text
AutoDeploy/
├── client/              # React + TypeScript + Vite frontend
│   └── src/             # Pages, routes, components, stores, lib, styles, etc.
├── server/              # Express backend, MCP tools, auth, deployment logging
│   ├── server.js        # Main Express entry point
│   ├── db.js            # Postgres connection & health check
│   ├── routes/          # Auth, MCP, deployments, pipeline sessions, Jenkins, etc.
│   ├── lib/             # Session, GitHub helpers, pipelineVersions, Supabase helpers
│   ├── tools/           # MCP tools (repo_reader, pipeline_generator, oidc_adapter, ...)
│   └── src/             # MCP agent, config, mock MCP server, backend docs
├── test/
│   └── smoke.test.js    # Simple /health smoke test
├── package.json          # Root scripts (dev, start, test) and backend deps
└── client/package.json   # Frontend scripts (dev, build, lint, preview)
```

## License

This project is licensed under the **ISC License** (see `package.json`).
