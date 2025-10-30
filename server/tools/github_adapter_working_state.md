# GitHub Adapter — Working State Documentation

**Date:** 2025-10-22 22:00:16

---

## ✅ Overview

The `github_adapter.js` module has been updated to provide **better resilience**, **improved error handling**, and **user-friendly messages** when interacting with the GitHub API.

These changes were made to address issues where the adapter returned unclear `403 Forbidden` errors when GitHub enforced **OAuth App access restrictions** on organization-owned or forked repositories.

---

## 🧩 Key Improvements

### 1. Added Required `User-Agent` Header
GitHub requires a `User-Agent` header for all API requests.  
Without this, requests could fail with ambiguous 403 responses.

```js
'User-Agent': 'AutoDeploy-App'
```

---

### 2. Enhanced Error Handling and Logging
The previous version only threw:
```js
throw new Error(`Failed to fetch repo data: ${response.status} ${response.statusText}`);
```

This was replaced with a full logging and structured response system:

```js
if (!response.ok) {
  const errorBody = await response.json().catch(() => ({}));
  console.error("[github_adapter] GitHub API error:", {
    status: response.status,
    message: errorBody.message || response.statusText,
  });

  let userMessage = `GitHub API error ${response.status}: ${response.statusText}`;
  if (response.status === 403 && /OAuth App access restrictions/i.test(errorBody.message || '')) {
    userMessage =
      "Access denied: This repo is protected by an organization's OAuth App restrictions. " +
      "Please request org admin approval for your AutoDeploy app in GitHub settings.";
  }

  return {
    success: false,
    error: userMessage,
    details: errorBody.message || null,
  };
}
```

✅ **Benefits:**
- Clear terminal logs for developers.
- User-friendly JSON messages for API consumers.
- Safe parsing of API error payloads.

---

### 3. Stable Repo Data Return

The adapter now returns structured repo metadata:
```js
return {
  repo_name: data.full_name,
  default_branch: data.default_branch,
  language: data.language,
  stars: data.stargazers_count,
  visibility: data.private ? 'private' : 'public',
};
```

---

## 🧠 Why This Matters

- Helps identify **OAuth App restrictions** early.
- Prevents developers from debugging blind 403s.
- Improves developer experience by logging precise cause and user guidance.

---

## 🧪 Next Steps

1. Approve your AutoDeploy OAuth App in your GitHub org settings.  
2. Retest the `/mcp/v1/github?repo=<owner>/<repo>` route.  
3. Confirm that public repos succeed and private/org repos give clear access instructions.

---

**Maintainer:** Paython Veazie  
**Component:** MCP → Tools → GitHub Adapter  
**Environment:** Node.js / Supabase / OAuth / Fetch API  
