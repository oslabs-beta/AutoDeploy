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

