# Secrets & Preflight – API Contracts

This document describes the HTTP contracts for backend endpoints used by the **Secrets & Preflight** page.

## 1. `GET /api/connections`

### Summary

Return GitHub connection status for the currently authenticated user and a specific repo.

### Route

- Method: `GET`
- Path: `/api/connections`
- Auth: `requireSession` (JWT cookie, `mcp_session`).

### Query Parameters

- `repoFullName` (string, required)
  - Format: `owner/repo`.

### Request Example

```http
GET /api/connections?repoFullName=octo-org/demo-repo HTTP/1.1
Cookie: mcp_session=...
```

### Response

```json
{
  "githubAppInstalled": true,
  "githubRepoWriteOk": true
}
```

#### Field Semantics

- `githubAppInstalled` (boolean)
  - `true` if a GitHub access token can be resolved for the current user (`connections` row or `GITHUB_PAT_OVERRIDE`).
  - Forced to `false` if the repo probe returns 401/403.
- `githubRepoWriteOk` (boolean)
  - `true` if the token has at least one of: `push`, `admin`, `maintain`, `triage` permissions for the repo.
  - `false` otherwise or when the probe fails.

### Error Responses

- `401 Unauthorized`
  - No valid session (`requireSession` failure).
- `5xx`
  - Unexpected error; response body:

```json
{ "error": "Failed to load connection status", "detail": "..." }
```

---

## 2. `POST /api/secrets/github/presence`

### Summary

Return presence/absence of required GitHub Actions secrets for the given repo and environment.

### Route

- Method: `POST`
- Path: `/api/secrets/github/presence`
- Auth: `requireSession`.

### Request Body

```json
{
  "repoFullName": "octo-org/demo-repo",
  "env": "dev",
  "requiredKeys": ["GITHUB_TOKEN", "AWS_ROLE_ARN"]
}
```

#### Fields

- `repoFullName` (string, required)
  - GitHub slug, `owner/repo`.
- `env` (string, optional but recommended)
  - Environment name (e.g., `dev`, `staging`, `prod`).
  - Used to lookup environment-level secrets.
- `requiredKeys` (string[], optional)
  - Override list of secret names to check.
  - If omitted, defaults to `['GITHUB_TOKEN', 'AWS_ROLE_ARN']`.

### Successful Response (200)

```json
{
  "secrets": [
    { "key": "GITHUB_TOKEN", "present": true },
    { "key": "AWS_ROLE_ARN", "present": false }
  ],
  "env": "dev",
  "githubUnauthorized": false
}
```

#### Field Semantics

- `secrets` (array)
  - One entry per requested key:
    - `key` (string): the secret name.
    - `present` (boolean):
      - `true` if key is `GITHUB_TOKEN` (built-in), or if a repo-level or env-level secret exists with that name.
      - `false` otherwise.
- `env` (string or null)
  - Echo of the environment used for lookup (if any).
- `githubUnauthorized` (boolean, optional)
  - `true` if GitHub returned 401/403 for secrets / repo probes and the backend had to return a conservative presence set.

### Unauthorized Token Behavior

If GitHub returns 401/403 when fetching repo or environment secrets:

- Logs: `[githubSecrets] /presence error: ...`.
- Response is downgraded but still 200 with conservative defaults, e.g.:

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

### Error Responses

- `400 Bad Request`

```json
{ "error": "repoFullName is required" }
```

- `401 Unauthorized`

```json
{ "error": "No user in session" }
```

- `5xx`

```json
{ "error": "Failed to check GitHub secrets", "detail": "..." }
```

---

## 3. `POST /api/secrets/github/upsert`

### Summary

Create or update a GitHub Actions secret (repo-level or environment-level) for the given repo and environment.

### Route

- Method: `POST`
- Path: `/api/secrets/github/upsert`
- Auth: `requireSession`.

### Request Body

```json
{
  "repoFullName": "octo-org/demo-repo",
  "env": "dev",
  "key": "AWS_ROLE_ARN",
  "value": "arn:aws:iam::123456789012:role/mcp-deploy-role"
}
```

#### Fields

- `repoFullName` (string, required)
  - GitHub slug, `owner/repo`.
- `env` (string, optional)
  - GitHub environment name.
  - If provided, the backend attempts env-level secret first.
- `key` (string, required)
  - Secret name.
  - v1 supports `AWS_ROLE_ARN` (and treats `GITHUB_TOKEN` as a special case).
- `value` (string, required for non-builtin keys)
  - Secret value to encrypt and store.

### Behavior

1. If `key === 'GITHUB_TOKEN'`:
   - No secret is created; this is a built-in Actions secret.
   - Response:

```json
{ "ok": true, "builtin": true, "scope": "builtin" }
```

2. Otherwise:
   - If `env` is provided:
     - Attempt env-level upsert via GitHub Actions Secrets API:
       - `GET /repositories/{id}/environments/{env}/secrets/public-key`.
       - `PUT /repositories/{id}/environments/{env}/secrets/{key}`.
     - If successful:

```json
{ "ok": true, "env": "dev", "scope": "environment" }
```

     - If GitHub returns 404 for the environment public key:
       - Log warning and fall through to repo-level upsert.
   - Repo-level upsert:
     - `GET /repos/{owner}/{repo}/actions/secrets/public-key`.
     - `PUT /repos/{owner}/{repo}/actions/secrets/{key}`.
     - Response:

```json
{
  "ok": true,
  "env": "dev",
  "scope": "repo",
  "envFallback": true
}
```

   - If `env` is not provided, repo-level upsert is performed directly and `envFallback` is omitted or `false`.

### Successful Response Shapes

- Built-in:

```json
{ "ok": true, "builtin": true, "scope": "builtin" }
```

- Environment-level secret:

```json
{ "ok": true, "env": "dev", "scope": "environment" }
```

- Repo-level secret (no env requested):

```json
{ "ok": true, "env": null, "scope": "repo" }
```

- Repo-level secret (fallback from env):

```json
{ "ok": true, "env": "dev", "scope": "repo", "envFallback": true }
```

### Error Responses

- `400 Bad Request`
  - Missing `repoFullName` or `key`:

```json
{ "error": "repoFullName and key are required" }
```

  - Missing `value` for non-builtin keys:

```json
{ "error": "value is required" }
```

- `401 Unauthorized`

```json
{ "error": "No user in session" }
```

- `401/403 from GitHub`
  - Propagated as `5xx` from the route with error details:

```json
{
  "error": "Failed to create or update GitHub secret",
  "detail": "Get repo public key failed: 401 Unauthorized ..."
}
```

---

## 4. Authentication & Rate Limits

All endpoints above require a valid `mcp_session` cookie and rely on `requireSession` to:

- Decode and verify the JWT.
- Attach `req.user` (Populated from Supabase `public.users`).

GitHub rate limits and failures are not surfaced directly to the user; instead:

- Logs contain the HTTP status and body from GitHub.
- Responses to the client are normalized error objects as shown above.

## 5. Versioning & Extensions

- These endpoints are considered part of the v1 AutoDeploy internal API.
- Future changes should:
  - Preserve field names and semantics where possible.
  - Add optional fields rather than changing types.
  - Consider introducing a `/api/secrets/github/v2/...` prefix if a breaking change is needed.
