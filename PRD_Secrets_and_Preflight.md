# PRD: Secrets & Preflight Page

> Status (Dec 2025): Implemented on the `paython-mcp` branch. Secrets & Preflight is wired to real GitHub Actions secrets APIs and an AWS OIDC role mock, with repo/env-aware secret checks and user notifications when falling back from environment to repo-level scope.

## 1. Overview

The **Secrets & Preflight** page is Step 3 of the AutoDeploy wizard:

1. Connect GitHub repo (OAuth + repo selection).
2. Configure pipeline (template, provider, YAML generation).
3. **Secrets & Preflight** (this page).
4. Dashboard (deployments + history).

Its job is to:

- Confirm that core **connections** are valid for the selected repo:
  - GitHub app / access token present.
  - Repo-level write permissions.
  - AWS OIDC role available.
- Ensure required **GitHub Actions secrets** are set for the current environment (e.g. `dev`, `staging`, `prod`).
- Run a lightweight **preflight check** and only then allow the user to continue to the Dashboard.

## 2. Goals & Non-Goals

### 2.1 Goals

1. **Make secret requirements explicit**
   - Show a concise list of required secret *names* (not values).
   - Indicate whether each is present for the repo/env.
2. **Give a simple path to fix missing secrets**
   - Let the user set missing secrets directly from the wizard.
   - Prefer environment-scoped secrets when possible, with a clear fallback story.
3. **Guard the Dashboard / Deployments step**
   - The Continue → Dashboard button is only enabled if:
     - GitHub app + repo write access are healthy.
     - AWS OIDC role is available (for AWS provider flows).
     - Required secrets are present.
4. **Be transparent about scope**
   - If we fall back from environment to repo-level secrets, tell the user exactly what happened.

### 2.2 Non-Goals

- The page does **not**:
  - Manage or rotate AWS IAM roles or policies.
  - Display or edit secret values.
  - Support non-GitHub CI providers.
  - Persist environment-specific configuration outside of GitHub Actions secrets.

## 3. Users & Entry Conditions

### 3.1 Users

- Engineers using AutoDeploy to set up CI/CD for a GitHub repo.
- Typically have already:
  - Logged in (JWT session).
  - Connected GitHub.
  - Selected a repo + branch.
  - Generated at least one pipeline YAML.

### 3.2 Entry Conditions

- User must have:
  - A valid `mcp_session` (via `requireSession`).
  - `useRepoStore.repo` and `useRepoStore.branch` set.
  - `usePipelineStore.getEffectiveYaml()` non-empty (pipeline already generated).

If these are not met, the router guards redirect the user back to `/connect` or `/configure`.

## 4. UX & Interaction Model

### 4.1 Layout

The page is divided into four main areas:

1. **Connections (top left)**
   - "GitHub App: ✓/–" – whether a GitHub token exists and is authorized for the repo.
   - "Repo write: ✓/–" – whether the token has push/admin-ish rights.
   - "AWS OIDC: ✓ (ARN) / –" – whether the backend reports at least one deployable AWS role (mocked via `oidc_adapter` in v1).

2. **Environment selector**
   - Dropdown with `dev`, `staging`, `prod`.
   - Drives which environment we check secrets for.

3. **Required Secrets list**
   - Keys (v1): `GITHUB_TOKEN`, `AWS_ROLE_ARN`.
   - Each row shows `Set ✓` or an `Add` button.
   - Below the header, a small status line explains where the last secret was saved:
     - e.g. `Saved AWS_ROLE_ARN as a repo-level secret because GitHub environment "dev" does not exist.`

4. **Preflight + Gating**
   - `Run Preflight` button.
   - `Continue → Dashboard` button (disabled until all preflight checks are green).
   - Preflight result list with green/red lines summarising checks.

### 4.2 Typical Flow

1. User lands on Secrets & Preflight after configuring a pipeline.
2. On mount, the page loads:
   - Connections status for the selected repo (`GET /api/connections`).
   - Secret presence for the default env (`POST /api/secrets/github/presence`).
3. If `AWS_ROLE_ARN` is missing, user clicks **Add**, enters a value, and saves.
   - Backend attempts to create an environment secret for current env.
   - If the GitHub environment does not exist, it falls back to a repo-level secret and surfaces this to the user.
4. User presses **Run Preflight**.
   - The page recomputes a checklist of:
     - GitHub app installed.
     - Repo write access.
     - AWS OIDC configured.
     - Secrets present.
     - AWS region selected.
5. If all rows are green, **Continue → Dashboard** becomes clickable and routes to `/dashboard`.

## 5. Functional Requirements

### 5.1 Connections

- **FR-1**: When the Secrets page loads (or env changes), the client must fetch the connection status for the selected repo.
- **FR-2**: The backend must infer:
  - Whether a GitHub token is stored for the current user.
  - Whether that token is authorized for the selected repo and has at least `push`/`admin`/`maintain` permissions.
- **FR-3**: Connection status must be resilient to GitHub 401/403:
  - Logs should record the failure.
  - The UI should show `–` (not ✓) for GitHub App / Repo write when unauthorized.

### 5.2 Secrets Presence

- **FR-4**: For each env and repo, the system must answer whether required secrets exist.
- **FR-5**: In v1, `GITHUB_TOKEN` is treated as always present (built-in Actions secret) and never created or modified.
- **FR-6**: `AWS_ROLE_ARN` should be treated as present if it exists either:
  - As a repo-level Actions secret, or
  - As an environment secret for the current env.
- **FR-7**: If the GitHub Actions Secrets API returns 401/403 for presence:
  - The backend must fall back to a conservative response: `GITHUB_TOKEN` present, others absent.
  - Do **not** break the UI.

### 5.3 Secret Creation/Update

- **FR-8**: Users must be able to set a value for missing `AWS_ROLE_ARN` using only the wizard.
- **FR-9**: The backend must:
  1. Attempt to create/update an **environment** secret for the current env.
  2. If the environment does not exist (404), log the issue and fall back to creating/updating a **repo-level** secret.
- **FR-10**: The response to a successful set must include:
  - `scope: 'environment' | 'repo' | 'builtin'`.
  - `envFallback: true` when we fell back from environment to repo-level.

### 5.4 User Feedback

- **FR-11**: After saving a secret, the UI must display a one-line notice describing where it was stored, e.g.:
  - `Saved AWS_ROLE_ARN as an environment secret for "dev".`
  - `Saved AWS_ROLE_ARN as a repo-level secret because GitHub environment "dev" does not exist.`
- **FR-12**: Run Preflight must recompute the checklist and gate **Continue → Dashboard** based on those results.

## 6. Non-Functional Requirements

1. **Security**
   - Never expose secret values to the frontend.
   - Only secret *names* and presence/absence are visible.
   - All GitHub calls use the user’s stored access token or a server override (`GITHUB_PAT_OVERRIDE`).
2. **Performance**
   - Secrets presence and connection probes should return within ~1s for typical repos.
   - Preflight should complete in under ~2s in normal conditions.
3. **Resilience**
   - GitHub outages or token problems should degrade gently:
     - UI shows missing/unauthorized status.
     - Logs contain enough detail to debug.

## 7. Open Questions / Future Enhancements

1. **Real AWS OIDC integration**
   - Replace the mocked `oidc_adapter` with real AWS role discovery/validation.
2. **Dynamic required secrets**
   - Derive required secrets from the generated YAML (e.g., provider-specific secrets).
3. **Per-env dashboards**
   - Surface which secrets are env-level vs repo-level in the Dashboard itself.
