```# AutoDeploy
Auto-Generated Secure CI/CD Pipelines with AI + MCP


General plan for file structure:

mcp-ci-cd-builder/
├── client/                # React + Tailwind + Zustand frontend (Victoria)
│   ├── src/
│   ├── public/
│   └── package.json
├── server/                # MCP orchestrator + adapters (Lorenc)
│   ├── src/
│   ├── package.json
│   └── mcp.config.json
├── infra/                 # AWS OIDC + GitHub Actions workflows (Alex)
│   ├── workflows/
│   └── terraform/ or aws-oidc.yml
├── tests/                 # Shared test utilities (Paython)
│   ├── integration/
│   └── unit/
├── .github/
│   └── workflows/
│       └── ci.yml
├── README.md
└── .env.example

Added by Lorenc - the file structure of the backend and the current back end flow:

sequenceDiagram
Frontend ->> Backend: GET /auth/github/start
Backend ->> GitHub: Redirect user to OAuth consent
GitHub ->> Backend: Redirect back with code & state
Backend ->> GitHub: POST /login/oauth/access_token
GitHub ->> Backend: Returns access_token
Backend ->> GitHub: GET /user, GET /user/emails
Backend ->> Supabase: Upsert users + connections
Backend ->> Frontend: Redirect / JSON success

AutoDeploy/
│
├── server/                      # main backend service
    └── lib/
       └── github-oauth.js      # helper functions for GitHub API
       ├── state.js             # CSRF state store (in-memory)
    ├── routes/
        └── auth.github.js       # all GitHub OAuth + /me routes
		└── deployments.js
		└── usersRoutes
   ├── server.js                # Express bootstrap & route mounting
   ├── db.js                    # pg Pool + query() + healthCheck()

├── .env                         # environment variables (GitHub, DB)
├── package.json / lock.json
├── .gitignore
└── (optional) client/           # frontend or test scripts

 Includes:
	•	CSRF protection via state (in-memory store).
	•	Token exchange & user fetch with live GitHub API calls.
	•	Upsert logic for both users and connections (idempotent).
	•	Sanity check before using any stored token.

FUNCTIONAL STATUS:
+-------------------+------------+-------------------------------------------------------------+
| Component         | Status     | Notes                                                       |
+-------------------+------------+-------------------------------------------------------------+
| Express app       | ✅ Working | Clean middleware (CORS, Helmet, JSON, logging)              |
| DB connection     | ✅ Working | Postgres via Supabase connection string                     |
| /health           | ✅ Working | Returns uptime                                              |
| /db/ping          | ✅ Working | Validates DB connectivity                                   |
| /users (POST/GET) | ✅ Working | Basic user CRUD                                             |
| /auth/github/*    | ✅ Working | OAuth flow complete                                         |
| /auth/github/me   | ✅ Working | Token sanity check + GitHub user info                       |
+-------------------+------------+-------------------------------------------------------------+

Deployment Logs API

Overview:
This Deployment Logs API provides a lightweight, flexible way to record, update, and retrieve deployment acitvity from GitHub Actions or other CI/CD providers.
It's designed to power the MCP CI/CD Builder's deployment tracking and reporting system.

The schema covers:
	-Status tracking (queued, running, success, failed, canceled)
	-Basic context (provider, repo_full_name, environment, branch)
	-Timing data (created_at, finished_at, duration_ms)
	-Flexible metadata fir provider-specific details (GitHub run IDs, AWS region)

API Endpoints

POST
/deployments
Create a new deployment record (status = queued).

PATCH
/deployments/:id/status
Update deployment status and merge metadata.

GET
/deployments
List deployments (filter by repo, environment, or status).

GET
/deployments/:id
Retrieve a single deployment record by ID.

----------------------------------------------------------------------------------------------------

🔁 Deployment Retry & Rollback

🧩 Overview

The Retry & Rollback system extends the existing Deployment Logs API by adding the ability to:
	•	🔁 Retry a failed or flaky deployment using the same commit (commit_sha).
	•	⏮️ Rollback to a previously known-good commit.
	•	🧠 Automatically track these events in the deployment_logs table with clear action types:
deploy, retry, and rollback.

Each new action creates its own immutable record, preserving the complete deployment history and lineage.


Endpoints

POST
/deployments/:id/retry
Retries a previous deployment by ID. Creates a new queued record using the same commit, repo, and environment.

POST
/deployments/rollback
Manually rolls back to a specific commit (commit_sha).

POST
/deployments/rollback/last-success
Automatically rolls back to the last successful commit for the same repository and environment.

---------------------------------------------------------------------------------------------------

Database changes

ALTER TABLE public.deployment_logs
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'deploy',  -- deploy | retry | rollback
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.deployment_logs(id);


---------------------------------------------------------------------------------------------------

🧠 How It Works
	•	Every retry or rollback creates a new row in deployment_logs.
	•	The parent_id field links back to the original deployment for traceability.
	•	The action field indicates intent:
	•	deploy → new deployment
	•	retry → same commit, new attempt
	•	rollback → revert to previous commit
	•	status starts as queued and can transition to running, success, or failed using the /deployments/:id/status endpoint.


                           ┌───────────────────────────────┐
                           │        User / API Call        │
                           └──────────────┬────────────────┘
                                          │
                                          ▼
                          ┌──────────────────────────────────┐
                          │     Express Backend (API)        │
                          │  /deployments /rollback /retry   │
                          └──────────────┬───────────────────┘
                                         │
               ┌─────────────────────────┼─────────────────────────┐
               │                         │                         │
               ▼                         ▼                         ▼
     ┌────────────────┐       ┌──────────────────┐       ┌────────────────┐
     │  deploy (new)  │       │   retry (same)   │       │ rollback (old) │
     │ action=deploy  │       │ action=retry     │       │ action=rollback│
     └────────────────┘       └──────────────────┘       └────────────────┘
               │                         │                         │
               └──────────────┬──────────┴──────────┬──────────────┘
                              ▼                     ▼
                      ┌─────────────────────────────────────┐
                      │      Supabase deployment_logs       │
                      │  - repo_full_name, environment      │
                      │  - branch, commit_sha               │
                      │  - status, action, parent_id        │
                      │  - metadata (extra info)            │
                      └─────────────────────────────────────┘
                                          │
                                          ▼
                            ┌────────────────────────────┐
                            │     GitHub Actions API     │
                            │  (workflow_dispatch call)  │
                            └──────────────┬─────────────┘
                                           │
                                           ▼
                               ┌──────────────────────────┐
                               │   Deploy Workflow Runs   │
                               │ (build, test, release)   │
                               └──────────────────────────┘

Adding this line to test the workflows
Another test2
test3
test 4
  // "build": "tsc -b && vite build",

Testtt
```
