Here’s a tightened PRD incorporating your answers and assumptions about the v1 scope.

---

# PRD: Workflow Copilot Agent

> **Status (Dec 2025):** v1 of the Workflow Copilot has been implemented on the `paython-mcp` branch. Most core behaviors (User vs Pro modes, MCP + RAG integration, suggestions, and basic workflow analysis) are live; deeper repo profiling, diff/patch flows, and richer telemetry remain future work.

## 1. Overview

The **Workflow Copilot Agent** is a lightweight, chat-based assistant that helps users understand and improve the CI/CD workflows of their GitHub repositories.

- It reads the repo (via existing tools + RAG for Pro users).
- It explains current workflows and identifies gaps.
- It proposes short, concrete workflow improvements with example YAML.
- It behaves as a **copilot**: advisory only. It does not directly edit the repo, but guides the user through one-click steps that can culminate in a commit/push using existing flows (e.g., pipeline generator / PR creation).

---

## 2. Goals & Non‑Goals

### 2.1 Goals

1. **Explain current automation**
   - Summarize the repo’s CI/CD setup (GitHub Actions in v1): what runs, when, and on which branches.
   - Answer workflow-related questions in natural language (“What does my CI do today?”).

2. **Suggest concise improvements**
   - Identify missing or weak CI/CD practices.
   - Propose a **short, prioritized list** of improvements, each with a rationale.
   - Provide copy-pasteable GitHub Actions YAML snippets or small diffs.

3. **Fit into an end-to-end flow**
   - Guide the user via **chat + one-click actions** from:
     - “Analyze my repo” → “Review suggestions” → “Generate/update workflow YAML” → “Open PR / commit”.
   - The copilot remains advisory; actual writes/PRs use existing AutoDeploy flows.

4. **Two capability tiers**
   - **User mode:** heuristic + tool-based repo reading, no RAG.
   - **Pro mode:** adds RAG-backed deep context and better answers, gated by a Pro flag.

5. **Scoped, efficient indexing**
   - Index only what’s needed to propose or refine workflow YAML, on a per-request basis.
   - For large repos, index only relevant parts (workflows, build/test configs, Docker, infra files).

### 2.2 Non‑Goals (v1)

- The agent does **not**:
  - Directly write to the repo, push commits, or merge PRs.
  - Run or schedule deployments.
  - Support non-GitHub CI providers (those may be future extensions).
  - Persist long-term chat history beyond the current browser session.

---

## 3. Users, Modes, and Access

### 3.1 Target Users

- **App developers and small teams** wanting straightforward CI/CD guidance.
- **DevOps-curious engineers** who are comfortable with code but not CI/CD details.
- **Pro/beta users** evaluating more advanced, RAG-powered understanding.

### 3.2 Modes

1. **User Mode (default)**
   - Available to all authenticated users.
   - Uses:
     - Existing repo-reader / file APIs.
     - Heuristics over key files (workflows, package scripts, Docker, tests).
   - Limitations vs Pro:
     - Less context for complex monorepos.
     - Less detailed explanations and cross-file reasoning.

2. **Pro Mode**
   - Enabled by a **Pro flag** (e.g., in the DB) on the authenticated user.
   - Adds:
     - RAG-powered answers over repo content.
     - On-demand, per-request indexing into Pinecone + Supabase, scoped by **user + repo namespace**.
     - Smarter reasoning over large repos with partial indexing of only relevant files.

---

## 4. UX & Interaction Model

### 4.1 Chat UI

**FR-1: Chat-style interface**

- A dedicated “Workflow Copilot” chat surface (e.g., panel or page).
- Users can:
  - Type free-form questions.
  - Trigger **one-click entry points** such as:
    - “Analyze current workflows”
    - “Suggest missing checks”
    - “Propose a complete CI pipeline”
- The agent replies with:
  - Explanations.
  - Short prioritized lists (e.g., top 3 suggestions).
  - Example YAML or diffs.

**FR-2: Session flow with guided next steps**

- After each major step, the copilot presents **next one-click actions** until the user reaches a natural “task complete” state, such as:
  - “View current workflows” → “See suggestions” → “Generate workflow YAML” → “Open PR”.
- The copilot **does not** directly commit or push; instead, it:
  - Calls existing generation APIs (where appropriate).
  - Surfaces buttons like “Generate pipeline YAML”, “Open PR with this YAML”, which tie into existing AutoDeploy flows.

**FR-3: Ephemeral per-session conversations**

- Chat history is:
  - Kept in browser memory or short-lived storage for the duration of the session.
  - Not persisted long-term on the backend as a conversation log (beyond what is needed for request handling or analytics).
- Pro mode may store required minimal context in Supabase/Pinecone per request, but not full transcripts.

---

## 5. Functional Requirements

### 5.1 Repo Understanding

**FR-4: GitHub-only CI detection (v1)**

- For the selected repo/branch, the copilot can:
  - Detect existing GitHub Actions workflows (e.g., `.github/workflows/*.yml`).
  - Identify key signals:
    - When workflows run (triggers).
    - What they do (build, test, lint, deploy).
    - Which services they touch (e.g., Docker, AWS, etc., if inferable).

**FR-5: Broader workflow context**

- The copilot should inspect (via tools and/or RAG):
  - Test locations (`tests/`, `__tests__`, etc.).
  - Build configs (e.g., `package.json` scripts, Makefiles, build.gradle).
  - Dockerfiles and infra configs relevant to deployment.
- Output a concise “workflow profile” in natural language:
  - “You have X workflows. The main CI runs on push to main, runs tests in folder Y, and builds Docker image Z.”

### 5.2 Suggestions & Improvements

**FR-6: Gap analysis**

- Given the workflow profile, the copilot identifies:
  - Missing or weak pieces (e.g., “No tests are run in CI”, “No build step”, “No deploy step, only build/test”).
- Returns a **short prioritized list** (e.g., 3–5 items max) with:
  - A title (e.g., “Add test step to CI”).
  - One-sentence rationale.
  - Optional difficulty/impact hint (lightweight, no strict labels needed).

**FR-7: Example workflows and diffs**

- Generate:
  - New workflow YAML files (e.g., recommended `.github/workflows/ci.yml`).
  - Patches to existing workflows (e.g., adding cache, adding test matrix, splitting jobs).
- Requirements:
  - YAML must be syntactically valid GitHub Actions YAML.
  - The response clearly marks:
    - File path.
    - Whether it is a **new file** or **modified existing file**.
- Where possible, surface these suggestions as:
  - “Apply via pipeline wizard” type buttons.
  - “Open PR with this change” buttons that delegate to existing mechanisms.

### 5.3 RAG & Indexing (Pro Only)

**FR-8: On-demand, per-request indexing**

- When a Pro user asks a question requiring deeper context:
  - Identify relevant files and chunks.
  - Index them on-the-fly into Pinecone under a **user+repo namespace**.
  - Store minimal metadata in Supabase pointing to embeddings/chunks.
- For large repos:
  - Only index files likely relevant to workflows (workflows, build/test configs, deployment manifests, Dockerfiles, infra code).
- No full-repo “crawl everything upfront” approach in v1.

**FR-9: RAG-augmented answers**

- Pro mode responses:
  - Cite or reference specific files/sections where relevant (e.g., filenames, key paths).
  - Use retrieved context to provide more specific, accurate explanations and suggestions.

### 5.4 Auth, Permissions, and Gating

**FR-10: Auth & session requirements**

- Copilot access requires:
  - Valid authenticated session (JWT cookie).
  - A currently selected GitHub repo/branch that AutoDeploy is allowed to inspect.

**FR-11: Mode gating**

- The backend determines mode per request:
  - If user has Pro flag → Pro mode (RAG + extended reasoning).
  - Else → User mode (non-RAG capabilities only).
- RAG endpoints (`/api/rag`) are *only* invocable for Pro users.

### 5.5 Telemetry

**FR-12: Logging and metrics**

- Log non-sensitive events:
  - Copilot session start/end.
  - Mode (User vs Pro).
  - Repo and branch.
  - Which entry points and next-step buttons are clicked.
- Key metrics:
  - # unique users using the copilot.
  - # sessions, # prompts per session.
  - Latency of responses.
  - Conversion from “Analyze” → “Generated workflow YAML” → “Opened PR/commit” (end-to-end engagement).

---

## 6. Non‑Functional Requirements

1. **Performance**
   - Common queries on medium repos should respond within 5–7 seconds.
   - Indexing in Pro mode must be scoped to needed files to stay within latency targets.

2. **Reliability**
   - If RAG or tools fail, Pro mode falls back gracefully:
     - “I can’t access deep context right now; here’s what I can infer from high-level signals.”
   - Provide clear error messaging rather than silent failures.

3. **Security & Privacy**
   - All repo access honors existing permissions/auth flows.
   - RAG namespaces are isolated by user + repo.
   - No secrets or PII logged; chat text only logged in aggregate or redacted form for analytics if needed.

4. **UX clarity**
   - The UI clearly communicates:
     - User vs Pro capabilities (e.g., upsell messaging in User mode for RAG features).
     - That the copilot is advisory and does not auto-commit.
   - Suggestions are short, concrete, and actionable.

---

## 7. Design Notes

- Treat this as a **copilot**, not an autonomous “do-everything” agent:
  - Keep the user in control with clear one-click steps.
  - Use the agent to bridge understanding and suggestion → then hand off to existing generation and PR flows.
- Future extensions can:
  - Add support for additional CI providers (GitLab CI, etc.).
  - Introduce optional, explicit “auto-PR” capabilities if/when you’re comfortable letting the agent propose branches/PRs automatically.

---
