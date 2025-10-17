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
│       ├── state.js             # CSRF state store (in-memory)
│       └── github-oauth.js      # helper functions for GitHub API
    ├── routes/
│   │   └── auth.github.js       # all GitHub OAuth + /me routes
│   ├── server.js                # Express bootstrap & route mounting
│   ├── db.js                    # pg Pool + query() + healthCheck()
│
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

```
