# RAG API Contracts (Backend → Frontend/Agent)

This document describes the HTTP and MCP contracts for the new repository RAG features exposed by the AutoDeploy backend.

## 1. REST RAG HTTP API (for frontend)

### Base & Auth
- **Base URL:** backend root (e.g. `http://localhost:3000`).
- **Prefix:** `/api/rag`.
- **Auth:** all endpoints require a valid `mcp_session` JWT cookie (`requireSession`).
- **Tenancy:** all embeddings and logs are scoped to a user+repo namespace of the form:
  - `"<userId>:owner/repo"`.

---

### 1.1 `POST /api/rag/ingest/github`

Ingest a GitHub repo’s files into Pinecone for the current user.

- **Method:** `POST`
- **Path:** `/api/rag/ingest/github`
- **Content-Type:** `application/json`
- **Auth:** `mcp_session` cookie

#### Request body

```json
{
  "repoUrl": "https://github.com/OWNER/REPO",   // required
  "includeIssues": false,                        // optional; currently ignored (code-only)
  "githubToken": "<PAT>"                        // optional; currently not used for git clone
}
```

#### Success response: `200 OK`

```json
{
  "namespace": "<userId>:OWNER/REPO",
  "repo": {
    "owner": "OWNER",
    "repo": "REPO"
  },
  "includeIssues": false,

  "fileCount": 123,           // number of code files discovered
  "chunkCount": 900,          // number of text chunks generated
  "upserted": 900,            // vectors upserted into Pinecone

  "issueCount": 0,            // reserved for future issue ingestion
  "issueChunkCount": 0,
  "issueUpserted": 0
}
```

#### Error responses

- `400 Bad Request` – invalid or missing `repoUrl`.
- `401 Unauthorized` – no `mcp_session`.
- `403 Forbidden` – (reserved; not currently used here).
- `500 Internal Server Error` – git clone or embedding failures.

---

### 1.2 `POST /api/rag/ingest/zip`

Ingest a zipped repository uploaded by the frontend.

- **Method:** `POST`
- **Path:** `/api/rag/ingest/zip`
- **Content-Type:** `multipart/form-data`
- **Auth:** `mcp_session` cookie

#### Form fields

- `repoZip` (**required**, file) – a `.zip` containing the repository.
- `repoSlug` (**required**, text) – canonical slug `"OWNER/REPO"` used to build the namespace.

#### Success response: `200 OK`

```json
{
  "message": "Embedded & upserted",
  "namespace": "<userId>:OWNER/REPO",
  "jobId": "<userId>:OWNER/REPO",
  "fileCount": 35,
  "chunkCount": 291,
  "upserted": 291
}
```

Error patterns are the same as for GitHub ingest (`400`, `401`, `500`).

---

### 1.3 `POST /api/rag/query`

Run a RAG query against a previously ingested namespace.

- **Method:** `POST`
- **Path:** `/api/rag/query`
- **Content-Type:** `application/json`
- **Auth:** `mcp_session` cookie

#### Request body

```json
{
  "namespace": "<userId>:OWNER/REPO",    // required; must match the ingest response
  "question": "How does auth work?",      // required
  "topK": 5                               // optional; default 5, range 1–20
}
```

#### Behavior

1. Validates `namespace` and `question`.
2. Confirms that `namespace` starts with the current `userId + ':'`.
3. Embeds `question` using OpenAI embeddings.
4. Queries Pinecone in the given namespace (`topK` matches).
5. Builds a context string from chunk metadata and calls OpenAI chat to generate an answer.
6. Logs the interaction to Supabase (`query_history` preferred; `logs` as fallback).

#### Success response: `200 OK`

```json
{
  "answer": "Auth is handled by middleware in src/auth/middleware.ts ...",
  "sources": [
    {
      "path": "src/auth/middleware.ts",
      "idx": 0,
      "score": 0.945
    },
    {
      "path": "src/routes/login.ts",
      "idx": 1,
      "score": 0.887
    }
  ]
}
```

#### Error responses

- `400 Bad Request` – missing `namespace` or `question`.
- `401 Unauthorized` – no `mcp_session`.
- `403 Forbidden` – `namespace` does not belong to the current user.
- `500 Internal Server Error` – embedding/Pinecone/OpenAI failures.

---

### 1.4 `GET /api/rag/logs?namespace=...&limit=...`

Fetch recent RAG interactions for a namespace.

- **Method:** `GET`
- **Path:** `/api/rag/logs`
- **Query string:**
  - `namespace` (**required**): must be a namespace owned by the current user.
  - `limit` (optional): max rows to return (default `50`).
- **Auth:** `mcp_session` cookie

#### Success response: `200 OK`

Returns an array of rows from Supabase:

```json
[
  {
    "id": "3b8a648e-4e14-4e2c-a967-a3f43e5595e3",
    "job_id": "<userId>:OWNER/REPO",
    "question": "How does auth work?",
    "answer": "Auth is handled by middleware ...",
    "prompt": "Question:\n...\nContext:\n...",
    "created_at": "2025-12-22T21:59:12.345Z"
  }
]
```

(Exact columns depend on the Supabase schema, but `job_id`/`session_id`, `question`, `answer`, `prompt`, and `created_at` are available.)

#### Error responses

- `400 Bad Request` – missing `namespace` query param.
- `401 Unauthorized` – no `mcp_session`.
- `403 Forbidden` – `namespace` does not belong to the current user.
- `500 Internal Server Error` – Supabase failures.

---

## 2. MCP v2 RAG Tools (for agent / advanced clients)

These tools are exposed over the MCP v2 router at `/mcp/v2/tools/*`. They mirror the REST behavior but are invoked as tool calls. The router automatically injects `user_id` from the session into each tool’s input.

### 2.1 `rag_ingest_github`

- **Path:** `POST /mcp/v2/tools/rag_ingest_github`
- **Auth:** `mcp_session` cookie + `USE_MCP_TOOL` capability

#### Input schema (after injection)

```json
{
  "user_id": "<userId>",                      // injected by router
  "repoUrl": "https://github.com/OWNER/REPO", // required
  "includeIssues": false,                      // optional; currently ignored
  "githubToken": "<PAT>"                      // optional (reserved for future use)
}
```

#### Output

Same as `POST /api/rag/ingest/github`.

---

### 2.2 `rag_ingest_zip`

- **Path:** `POST /mcp/v2/tools/rag_ingest_zip`

#### Input schema (after injection)

```json
{
  "user_id": "<userId>",                      // injected by router
  "file_path": "/path/to/repo.zip",           // required; server filesystem
  "repoSlug": "OWNER/REPO"                     // optional; fallback = zip basename
}
```

#### Output

Same as `POST /api/rag/ingest/zip`.

---

### 2.3 `rag_query_namespace`

- **Path:** `POST /mcp/v2/tools/rag_query_namespace`

#### Input schema (after injection)

```json
{
  "user_id": "<userId>",
  "namespace": "<userId>:OWNER/REPO",
  "question": "How does auth work?",
  "topK": 5
}
```

The tool enforces that `namespace` starts with `user_id + ':'`.

#### Output

Same as `POST /api/rag/query`:

```json
{
  "answer": "...",
  "sources": [ { "path": "...", "idx": 0, "score": 0.9 } ]
}
```

---

### 2.4 `rag_get_logs`

- **Path:** `POST /mcp/v2/tools/rag_get_logs`

#### Input schema (after injection)

```json
{
  "user_id": "<userId>",
  "namespace": "<userId>:OWNER/REPO",
  "limit": 50
}
```

The tool enforces that the namespace belongs to `user_id` and then reads from Supabase.

#### Output

Same as `GET /api/rag/logs` (array of history rows).

---

## 3. Frontend usage notes

- Persist the `namespace` returned from any ingest call and reuse it for:
  - `/api/rag/query`
  - `/api/rag/logs`
- All endpoints rely on the existing auth flow (GitHub/local login issuing `mcp_session`), so the frontend should not send separate auth headers for RAG.
- In local dev, the Vite proxy can safely forward `/api/rag/*` to the backend without additional configuration as long as it already proxies `/api/*`.
