# Secrets & Preflight – Technical Design

## 1. Scope

This document describes the implementation details of the **Secrets & Preflight** page and its supporting backend routes, with emphasis on:

- State management in the frontend (`useConfigStore`, `SecretsPage`).
- Backend routes and helpers for connections and secrets.
- Data flow for presence checks, secret creation, and preflight gating.

## 2. High-Level Architecture

### 2.1 Frontend components

- `client/src/pages/SecretsPage.tsx`
  - Renders the Secrets & Preflight UI.
  - Consumes `useRepoStore` (selected repo) and `useConfigStore` (env, secrets, connections, preflight state).
- `client/src/store/useConfigStore.ts`
  - Zustand store driving the page.
  - Coordinates with `client/src/lib/api.ts` for HTTP calls.
- `client/src/lib/api.ts`
  - Implements:
    - `getConnections(repo)` → `/api/connections`.
    - `getSecretPresence(repo, env)` → `/api/secrets/github/presence`.
    - `setSecret({ repo, env, key, value })` → `/api/secrets/github/upsert`.
    - `runPreflight({ repo, env, aws })` → synthesized client-side from connections + secrets.

### 2.2 Backend components

- `server/routes/connectionsStatus.js`
  - Mounted at `/api` → `GET /api/connections`.
  - Requires session via `requireSession` (through `server/server.js`).
  - Reads the current user’s GitHub token and probes the repo.
- `server/routes/githubSecrets.js`
  - Mounted at `/api/secrets/github`.
  - Routes:
    - `POST /api/secrets/github/presence`.
    - `POST /api/secrets/github/upsert`.
  - Uses `server/lib/githubSecrets.js` for GitHub Actions Secrets API calls.
- `server/lib/githubSecrets.js`
  - Pure helper module encapsulating:
    - Repo ID lookup.
    - Repo secrets list.
    - Environment public key + secrets list.
    - Repo/env secret upsert with libsodium encryption (`tweetsodium`).

## 3. Frontend Design

### 3.1 `useConfigStore` state and actions

`client/src/store/useConfigStore.ts`:

```ts
// Simplified shape

type EnvName = 'dev' | 'staging' | 'prod';

type SecretRef = { key: string; present: boolean };

type ConnectionStatus = {
  githubAppInstalled: boolean;
  githubRepoWriteOk: boolean;
  awsOidc: { connected: boolean; roleArn?: string; accountId?: string; region?: string };
};

type ConfigState = {
  env: EnvName;
  connections?: ConnectionStatus;
  secrets: SecretRef[];
  aws: { roleArn?: string; region?: string; accountId?: string };
  status: 'idle' | 'loading' | 'saving' | 'error';
  error?: string;
  preflightResults?: { label: string; ok: boolean; info?: string }[];
  lastSecretNotice?: string;
};
```

Key actions:

- `setEnv(env)`
  - Updates the selected environment.
  - The page reuses `env` when calling `getSecretPresence` and `runPreflight`.

- `load(repo)`
  - Sets `status = 'loading'`.
  - Parallel fetch:
    - `api.getConnections(repo)` → `connections`.
    - `api.getSecretPresence(repo, env)` → `secrets`.
  - On success:
    - Updates `connections`, `secrets`, `status`.
    - Seeds `aws.roleArn` from `connections.awsOidc.roleArn` if present.

- `addOrUpdateSecret(repo, key, value)`
  - Sets `status = 'saving'`, clears `lastSecretNotice`.
  - Calls `api.setSecret({ repo, env, key, value })`.
  - Re-fetches presence: `api.getSecretPresence(repo, env)`.
  - Interprets the response from `setSecret`:
    - `scope === 'environment'` → `Saved <key> as an environment secret for "<env>".`
    - `scope === 'repo' && envFallback` → `Saved <key> as a repo-level secret because GitHub environment "<env>" does not exist.`
    - `scope === 'repo'` → `Saved <key> as a repo-level secret.`
  - Writes `lastSecretNotice` and updated `secrets`, resets `status`.

- `runPreflight(repo)`
  - Delegates to `api.runPreflight({ repo, env, aws })`.
  - Writes `preflightResults`.

### 3.2 `SecretsPage` rendering logic

`client/src/pages/SecretsPage.tsx` is a thin view over the config store:

- On mount (and whenever `repo` changes), it calls `cfg.load(repo)`.
- Computes `allGreen` from `preflightResults`:
  - `true` only if there is at least one result and all entries have `ok: true`.
- Renders:
  - Connections summary (uses `cfg.connections`).
  - Environment dropdown (binds to `cfg.env`).
  - Required Secrets list:
    - `cfg.secrets` – with `Set ✓` vs `Add` button.
  - `cfg.lastSecretNotice` – small text under the “Required Secrets” heading.
  - Buttons:
    - `Run Preflight` → `cfg.runPreflight(repo)`.
    - `Continue → Dashboard` disabled until `allGreen`.

Interaction with modal:

- `SecretModal` accepts a `keyName` and an `onSave` callback.
- On save:
  - Calls `cfg.addOrUpdateSecret(repo, keyName, value)`.
  - Closes the modal.

### 3.3 Preflight computation

`api.runPreflight` is currently computed entirely on the client from existing calls:

- Inputs:
  - `connections` (GitHub and AWS OIDC signals).
  - `secrets` presence for `env`.
  - Optional `aws` overrides for role ARN/region.
- Outputs:

```ts
[
  { label: 'GitHub App installed', ok: hasGithubApp },
  { label: 'Repo write access', ok: hasRepoWrite },
  { label: 'AWS OIDC configured', ok: hasAws, info: role },
  { label: 'Secret: GITHUB_TOKEN', ok: !!s.GITHUB_TOKEN },
  { label: 'Secret: AWS_ROLE_ARN', ok: !!s.AWS_ROLE_ARN, info: role },
  { label: 'AWS Region selected', ok: !!region, info: region },
]
```

This keeps Preflight lightweight and avoids additional backend endpoints.

## 4. Backend Design – Connections

### 4.1 Route: `GET /api/connections`

File: `server/routes/connectionsStatus.js` (mounted at `/api`).

- Middleware: `requireSession` (ensures `req.user` is present).
- Query params:
  - `repoFullName` – required for repo-specific checks (format: `owner/repo`).
- Data flow:

1. Resolve `userId` from `req.user.user_id` or `req.user.id`.
2. Use `getGithubAccessTokenForUser(userId)` to obtain the GitHub token.
   - If absent → `githubAppInstalled = false`, `githubRepoWriteOk = false`.
3. If token and `repoFullName` present:
   - Split `owner`, `repo` and call `GET https://api.github.com/repos/{owner}/{repo}`.
   - If 200:
     - Inspect `permissions` object; set `githubRepoWriteOk = true` if any of:
       - `permissions.push`, `permissions.admin`, `permissions.maintain`, `permissions.triage`.
   - If 401/403:
     - Log a warning.
     - Force `githubAppInstalled = false`, `githubRepoWriteOk = false`.

Response:

```json
{
  "githubAppInstalled": boolean,
  "githubRepoWriteOk": boolean
}
```

The frontend then combines this with AWS OIDC signals from MCP (`oidc_adapter`) to build the `connections` object in the store.

## 5. Backend Design – Secrets

### 5.1 Helper module: `server/lib/githubSecrets.js`

Responsibilities:

- Compose GitHub REST URLs and headers.
- Handle encryption of secret values using libsodium sealed boxes (`tweetsodium`).
- Abstract over repo vs env-level secrets.

Key functions:

- `authHeaders(token)` – attaches `Authorization`, `Accept`, `User-Agent`.
- `getRepoId({ token, owner, repo })` – `GET /repos/{owner}/{repo}` → repo ID.
- `listRepoSecrets({ token, owner, repo })` – `GET /repos/{owner}/{repo}/actions/secrets`.
- `getEnvironmentPublicKey({ token, repositoryId, environmentName })` – `GET /repositories/{id}/environments/{env}/secrets/public-key`.
- `listEnvironmentSecrets({ token, repositoryId, environmentName })` – `GET /repositories/{id}/environments/{env}/secrets`.
- `upsertRepoSecret({ token, owner, repo, name, value })` – PUT to `.../actions/secrets/{name}`.
- `upsertEnvironmentSecret({ token, repositoryId, environmentName, name, value })` – PUT to environment secret endpoint.

All network failures produce structured `Error` objects with a `status` property to allow routing logic (e.g., treat 404 specially).

### 5.2 Route: `POST /api/secrets/github/presence`

File: `server/routes/githubSecrets.js`.

- Middleware: `requireSession`.
- Body:

```json
{
  "repoFullName": "owner/repo",
  "env": "dev" | "staging" | "prod",
  "requiredKeys": ["GITHUB_TOKEN", "AWS_ROLE_ARN"] // optional override
}
```

Algorithm:

1. Validate `repoFullName` and session.
2. Load GitHub token for the user.
3. Parse `owner`, `repo`; compute `repoId`.
4. Compute `keys` = `requiredKeys` or default list.
5. List repo secrets.
6. If `env` is provided:
   - Try to list environment secrets.
   - If 404 → treat as “no env secrets yet” (empty list).
   - Other failures bubble up.
7. Union repo + env secret names into a set.
8. For each key:
   - If key is `GITHUB_TOKEN` → `present = true`.
   - Else → `present = set.has(key)`.

Error handling:

- If GitHub returns 401/403 at any point:
  - Logs `[githubSecrets] /presence error: ...`.
  - Returns 200 with conservative defaults:

```json
{
  "secrets": [
    { "key": "GITHUB_TOKEN", "present": true },
    { "key": "AWS_ROLE_ARN", "present": false }
  ],
  "env": "dev",
  "githubUnauthorized": true
}
```

### 5.3 Route: `POST /api/secrets/github/upsert`

- Middleware: `requireSession`.
- Body:

```json
{
  "repoFullName": "owner/repo",
  "env": "dev" | "staging" | "prod",
  "key": "AWS_ROLE_ARN" | "GITHUB_TOKEN",
  "value": "<secret-string>" // omitted for GITHUB_TOKEN
}
```

Logic:

1. Validate `repoFullName` and `key`.
2. If `key === 'GITHUB_TOKEN'`:
   - Early return:

```json
{ "ok": true, "builtin": true, "scope": "builtin" }
```

3. Validate `value` is non-empty.
4. Resolve user + token, parse `owner`/`repo`.
5. If `env` is provided:
   - Try env-level secret upsert via `upsertEnvironmentSecret`.
   - On success:

```json
{ "ok": true, "env": "dev", "scope": "environment" }
```

   - On 404 (env missing):
     - Log a warning.
     - Fall through to repo-level upsert.
6. Repo-level upsert via `upsertRepoSecret`.
   - Response:

```json
{
  "ok": true,
  "env": "dev",        // or null if no env provided
  "scope": "repo",
  "envFallback": true    // only true if we attempted env first
}
```

7. Any other error (non-404, non-2xx) returns 5xx with an error message.

## 6. Data & Error Flows

### 6.1 Env missing while saving secret

1. User selects env `dev`, enters `AWS_ROLE_ARN` and clicks Save.
2. Backend requests environment public key for `dev`.
3. GitHub returns 404 (environment not defined).
4. Backend logs a warning and falls back to repo-level secret creation.
5. Response:

```json
{ "ok": true, "env": "dev", "scope": "repo", "envFallback": true }
```

6. Store sets `lastSecretNotice` to:

> Saved AWS_ROLE_ARN as a repo-level secret because GitHub environment "dev" does not exist.

### 6.2 Unauthorized GitHub token

- Presence call fails with 401/403.
- Backend responds with conservative presence, marks `githubUnauthorized: true`.
- Connections call also sets `githubAppInstalled = false`, `githubRepoWriteOk = false`.
- UI shows:
  - `GitHub App: –`, `Repo write: –`.
  - Secrets list with `AWS_ROLE_ARN` as not set.

## 7. Testing Strategy

- Unit-level:
  - Mock `fetch` in `githubSecrets.js` to validate behavior for 200/401/403/404.
- Integration-level:
  - Spin up backend with a test GitHub PAT against a throwaway repo.
  - Verify that:
    - Creating a `dev` environment produces `scope: 'environment'`.
    - Absence of that env produces fallback to `scope: 'repo'` and correct notice.
  - Verify connections logic with a token that has and does not have repo access.

## 8. Future Work

- Track and expose per-secret scope in `getSecretPresence` (e.g., `source: 'repo' | 'env'`).
- Add support for provider-specific secrets (e.g., different keys for GCP).
- Move preflight computation to a backend endpoint if it becomes more complex or provider-aware.
