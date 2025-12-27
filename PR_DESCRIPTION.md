# Summary

Add first-party RAG support directly to the AutoDeploy backend so we can ingest repos, embed them into Pinecone, and answer questions about them without depending on the separate AskMyRepo service.

# Changes

- **New `/api/rag` router**
  - `POST /api/rag/ingest/github`
    - Clones a GitHub repo shallowly using `simple-git`.
    - Chunks code-ish files in a temp workspace and embeds them.
    - Upserts vectors into Pinecone under a namespace scoped to the current user and repo (`<userId>:owner/repo`).
  - `POST /api/rag/ingest/zip`
    - Accepts a zipped repo via multipart upload (`repoZip`) plus a `repoSlug` (`owner/repo`).
    - Extracts, discovers files, chunks text, embeds, and upserts into the same user+repo-scoped namespace.
  - `POST /api/rag/query`
    - Given `{ namespace, question, topK? }`, embeds the question, queries Pinecone, builds a context string from the matched chunks, calls OpenAI to produce an answer, and returns `{ answer, sources }`.
    - Enforces that the `namespace` belongs to the authenticated user (prefix match on `userId:`).
  - `GET /api/rag/logs?namespace=...`
    - Fetches past RAG interactions from Supabase (`query_history` preferred, `logs` as fallback) for the given namespace, also scoped by `userId`.

- **New RAG helper modules (`server/lib/rag`)**
  - `pineconeClient.js`
    - Wraps `@pinecone-database/pinecone` with `upsertVectors`, `queryVectors`, and a `buildNamespace({ userId, repoSlug })` helper.
  - `embeddingService.js`
    - Provides `embedBatch(texts)` using OpenAI embeddings.
    - Model configurable via `RAG_EMBED_MODEL` (defaults to `text-embedding-3-small`).
  - `openaiRag.js`
    - `answerWithContext(question, context, { style })` that calls an OpenAI chat model (`RAG_MODEL`, default `gpt-4o-mini`) with a RAG-focused system prompt and requires a `Sources:` footer.
  - `supabaseRag.js`
    - Uses the existing Supabase instance (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE`/`SUPABASE_SERVICE_KEY`) to:
      - `logInteraction({ namespace, jobId, question, answer, prompt })` into `query_history`, with a fallback to `logs`.
      - `getHistoryByNamespace({ namespace, limit })` that reads from `query_history` or `logs`.
  - `githubService.js`
    - `parseGitHubRepoUrl`, `cloneGithubRepoShallow`, and a `fetchRepoIssues` helper (currently only the clone path is used; issues can be wired up later if needed).

- **Ingestion quality improvements**
  - File discovery ignores heavy/irrelevant paths (`node_modules`, `.git`, `dist`, `build`).
  - Added explicit skip patterns for noisy lockfiles:
    - `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`.
  - Keeps existing chunking behavior with a sliding window and overlap to preserve code context.

- **Dependencies**
  - Added:
    - `@pinecone-database/pinecone`
    - `multer`
    - `fast-glob`
    - `extract-zip`
    - `simple-git`
  - Reuses existing `openai` and `@supabase/supabase-js` dependencies.

- **Server wiring**
  - Mounted the new router in `server/server.js` under `/api/rag`.
  - All `/api/rag/*` routes are protected by `requireSession` and rely on the existing JWT cookie (`mcp_session`) / Supabase-backed user resolution.
  - Added local RAG MCP tools in `server/tools/askmyrepo_rag.js` and registered them in `server/tools/index.js` as:
    - `rag_ingest_zip`, `rag_ingest_github` – ingest local zip or GitHub repo into Pinecone under a user+repo namespace.
    - `rag_query_namespace` – run a RAG query against a namespace, returning `{ answer, sources }`.
    - `rag_get_logs` – fetch recent interaction history for a namespace from Supabase.
  - Captured the HTTP + MCP contracts in `server/src/RAG_API_Contracts.md` so frontend/agent clients and the marketing site can rely on stable shapes.

# Environment / config

- **OpenAI**
  - `OPENAI_API_KEY` (required)
  - `RAG_EMBED_MODEL` (optional, default `text-embedding-3-small`)
  - `RAG_MODEL` (optional, default `gpt-4o-mini`)
  - `RAG_TEMPERATURE` (optional, default `0.2`)

- **Pinecone**
  - `PINECONE_API_KEY` (required)
  - `PINECONE_INDEX` (required; index must be compatible with chosen embedding model)

- **Supabase**
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE` (or `SUPABASE_SERVICE_KEY`)

  Expected tables:

  - `query_history(job_id text, question text, answer text, created_at timestamptz default now(), …)`
  - `logs(session_id text, question text, prompt text, answer text, created_at timestamptz default now(), …)`

# Testing

- Manually verified end-to-end with a real GitHub repo:

  - `POST /api/rag/ingest/github` with `repoUrl=https://github.com/PVeazie951/soloProject` and a valid `mcp_session` cookie returns:
    - `200 OK` with `{ namespace, fileCount, chunkCount, upserted }`.
    - Pinecone dashboard shows `namespace=<userId>:PVeazie951/soloProject` with ~291 records.

  - `POST /api/rag/query` with the returned namespace and a natural-language question returns:
    - `200 OK` with an `answer` and a `sources` array referencing code files.

---

## MCP v1 Endpoint Contracts & Landing Site Integration (Notes)

- Documented current MCP v1 endpoint contracts in `server/src/MCP_v1_Endpoint_Contracts.md`, including:
  - `/mcp/v1/status`
  - dynamic tool dispatcher `/mcp/v1/:tool_name` (e.g., `repo_reader`, `pipeline_generator`, `oidc_adapter`, `gcp_adapter`, `scaffold_generator`)
  - pipeline routes: `/mcp/v1/pipeline_commit`, `/mcp/v1/pipeline_history`, `/mcp/v1/pipeline_rollback`.
- Confirmed v1 envelopes match the landing site’s expectations:
  - Tool responses: `{ success: true, data, request_id }` / `{ success: false, error, request_id }`.
  - Pipeline routes: `{ ok: true, data?, message?, request_id }` / `{ ok: false, error, request_id }`.
- The `autodeploy-landing` repo now uses these v1 endpoints for:
  - A home-page demo panel that calls `repo_reader` and `pipeline_history` when a backend session exists.
  - Docs callouts that surface `/mcp/v1/status` and pipeline history/rollback flows.

These notes are here to keep the backend and marketing/demo surfaces in sync; future changes to `/mcp/v1/*` should either preserve the v1 contracts or ship a coordinated update to the landing SPA.

---

## Workflow Copilot Agent (User vs Pro) + RAG Gating

- Introduced a lightweight "Workflow Copilot" agent on the Configure page that helps users:
  - Analyze existing GitHub Actions workflows for the connected repo.
  - Suggest concise CI/CD improvements.
  - Propose a complete pipeline based on the current wizard settings.
- Agent behavior is now **mode-aware**:
  - **User mode** – available to all authenticated users:
    - Uses MCP tools only (e.g., `github_adapter` and `pipeline_generator`).
    - For "Analyze workflows" it calls `github_adapter` (`workflows` action) to list existing workflows per repo.
    - For "Suggest improvements" it surfaces natural-language suggestions directly without forcing a tool call.
  - **Pro mode** – gated behind `Actions.USE_AGENT`/`isPro(user)` and RAG access:
    - Adds on-demand RAG via `/api/rag/ingest/github` + `/api/rag/query` to answer deep workflow questions.
    - Extracts up to three workflow suggestions from the RAG answer and surfaces them in the UI.
- RAG HTTP endpoints are now Pro-only:
  - `/api/rag/ingest/zip`, `/api/rag/ingest/github`, `/api/rag/query`, `/api/rag/logs` are protected with `requireCapability(Actions.USE_AGENT)`.
  - This reuses the same `isPro(user)` logic as the agent mode selector.
- UX improvements:
  - The Configure page now shows a `USER` / `PRO` badge in the Workflow Copilot panel.
  - Added quick-action chips: "Analyze workflows", "Suggest improvements", and "Propose CI pipeline".
  - When a user types intent like "remove the deploy part" the frontend:
    - Interprets it as a request to disable the deploy stage.
    - Updates the wizard stages, regenerates the pipeline via `pipeline_generator`, and keeps YAML in sync.
  - The agent responds with an explanation instead of a generic "no matching tool" error.

## Tests

- Added `test/authorization.test.js` using Node's built-in `node:test` runner to validate authz helpers:
  - `isPro(user)` returns `false` for `plan = 'free'` unless `beta_pro_granted` is set.
  - `isPro(user)` returns `true` for `plan = 'pro'` or `beta_pro_granted = true`.
  - `can(user, Actions.USE_AGENT)` matches the pro gating behavior.
- `can(user, Actions.USE_MCP_TOOL)` remains allowed for any authenticated user.

---

## Secrets & Preflight (Step 3 of the wizard)

This PR also wires up a real **Secrets & Preflight** step between Configure → Dashboard so users can confirm connections and required GitHub secrets before attempting deploys.

### Backend changes

- **New routes**
  - `GET /api/connections`
    - Uses `requireSession` and `getGithubAccessTokenForUser(userId)` to:
      - Confirm that a GitHub token exists for the current user.
      - Probe the selected repo via `GET /repos/{owner}/{repo}` to check `permissions.push/admin/maintain/triage`.
    - Returns `{ githubAppInstalled, githubRepoWriteOk }`.
    - If GitHub responds 401/403, logs the error and returns both flags as `false`.
  - `POST /api/secrets/github/presence`
    - Given `{ repoFullName, env, requiredKeys? }`, checks for required secret *names* using the GitHub Actions Secrets API.
    - Treats `GITHUB_TOKEN` as always present (built-in) and looks up `AWS_ROLE_ARN` in both repo‑level and environment secrets.
    - If GitHub responds 401/403, falls back to a conservative response and sets `githubUnauthorized: true` in the payload.
  - `POST /api/secrets/github/upsert`
    - Creates/updates GitHub Actions secrets via a new helper module `server/lib/githubSecrets.js` using libsodium (`tweetsodium`) sealed boxes.
    - Behavior:
      - If `key === 'GITHUB_TOKEN'`, returns `{ ok: true, builtin: true, scope: 'builtin' }` and does not touch secrets (this is a built-in Actions secret).
      - If `env` is provided, first attempts to upsert an **environment-level** secret:
        - `GET /repositories/{id}/environments/{env}/secrets/public-key`.
        - `PUT /repositories/{id}/environments/{env}/secrets/{key}`.
      - If the environment public key endpoint returns 404, logs a warning and falls back to a repo‑level secret via:
        - `GET /repos/{owner}/{repo}/actions/secrets/public-key`.
        - `PUT /repos/{owner}/{repo}/actions/secrets/{key}`.
    - Successful responses include scope metadata used by the frontend:
      - Env success: `{ ok: true, env, scope: 'environment' }`.
      - Repo success: `{ ok: true, env, scope: 'repo', envFallback: boolean }`.
- **Helper module**
  - `server/lib/githubSecrets.js`
    - Wraps GitHub Actions Secrets REST endpoints for repo + environment secrets.
    - Provides:
      - `getRepoId`, `listRepoSecrets`, `listEnvironmentSecrets`.
      - `upsertRepoSecret`, `upsertEnvironmentSecret` with sodium-based encryption.

### Frontend changes

- **New store state**
  - `useConfigStore` (Secrets & Preflight) now tracks:
    - `connections` → `{ githubAppInstalled, githubRepoWriteOk, awsOidc }`.
    - `secrets` → `[{ key, present }]` for required secrets.
    - `lastSecretNotice` → one-line explanation of where the last secret was saved.
    - `preflightResults` → array of `[{ label, ok, info? }]` used to gate the Continue button.
- **API client hooks** in `client/src/lib/api.ts`:
  - `getConnections(repo)`
    - Calls `GET /api/connections?repoFullName=<owner/repo>` via `SERVER_BASE`.
    - Combines this with OIDC role info from the `oidc_adapter` MCP tool to compute the `connections` object.
  - `getSecretPresence(repo, env)`
    - Calls `POST /api/secrets/github/presence` with `{ repoFullName, env }`.
  - `setSecret({ repo, env, key, value })`
    - Calls `POST /api/secrets/github/upsert` and returns `{ ok, scope, envFallback, env }`.
  - `runPreflight({ repo, env, aws })`
    - Derives a checklist client-side from `connections` + `secrets` + AWS options (role ARN, region).
- **SecretsPage UX** (`client/src/pages/SecretsPage.tsx`):
  - Shows a Connections card with:
    - GitHub App ✓/– (based on `githubAppInstalled`).
    - Repo write ✓/– (based on `githubRepoWriteOk`).
    - AWS OIDC ✓ + ARN (based on `connections.awsOidc`).
  - Environment dropdown for `dev/staging/prod`.
  - Required Secrets list for `GITHUB_TOKEN` and `AWS_ROLE_ARN`:
    - `GITHUB_TOKEN` is always shown as `Set ✓` and never editable.
    - `AWS_ROLE_ARN` exposes an **Add** button that opens a secret modal.
  - After saving a secret, a small notice explains where it was stored, e.g.:
    - `Saved AWS_ROLE_ARN as an environment secret for "dev".`
    - `Saved AWS_ROLE_ARN as a repo-level secret because GitHub environment "dev" does not exist.`
  - `Run Preflight` recomputes the checklist, and `Continue → Dashboard` remains disabled until all rows are green.

