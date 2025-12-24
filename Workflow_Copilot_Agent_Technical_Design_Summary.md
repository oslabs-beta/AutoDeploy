

> **Status (Dec 2025):** This design has been largely implemented in the `paython-mcp` branch. The final implementation keeps `/agent/wizard/ai` as the copilot transport, adds mode-aware behavior in `runWizardAgent`, gates RAG under `Actions.USE_AGENT`, and wires the Configure page Workflow Copilot panel. For a high-level summary of what shipped, see `PR_DESCRIPTION.md`.

**Files Read:**

**/Users/paythonveazie/Documents/codesmith/AutoDeploy/server/routes/agent.js**
```
/* just commenting on this file to say:
in your /routes folder, make sure to keep your router names consistent!
*/

import express from 'express';
import { runWizardAgent } from '../agent/wizardAgent.js';
// OLD: runWizardAgent no longer exists
// import { generateYAML, editYAML, runWizardAgent } from "../agent/wizardAgent.js";
import { pipeline_generator } from '../tools/pipeline_generator.js';
import { repo_reader } from '../tools/repo_reader.js';
import { oidc_adapter } from '../tools/oidc_adapter.js';
import { requireSession } from '../lib/requireSession.js';
import { Actions, requireCapability } from '../lib/authorization.js';

const router = express.Router();

// Trigger full pipeline wizard (MVP agent)
router.post(
  '/wizard',
  requireSession,
  requireCapability(Actions.USE_AGENT),
  async (req, res) => {
  try {
    const { repoUrl, provider, branch } = req.body;
    if (!repoUrl || !provider || !branch) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: repoUrl, provider, branch',
      });
    }
    const result = await runWizardAgent({
      repoUrl,
      provider,
      branch,
      cookie: req.headers.cookie,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Wizard Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger wizard agent with AI prompt
router.post(
  '/wizard/ai',
  requireSession,
  requireCapability(Actions.USE_AGENT),
  async (req, res) => {
  try {
    const {
      prompt,
      repoUrl,
      provider,
      branch,
      pipelineSnapshot,
    } = req.body;

    if (!prompt) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing required field: prompt' });
    }

    console.log('🧠 Wizard AI request received:', {
      repoUrl,
      provider,
      branch,
      hasPipelineSnapshot: !!pipelineSnapshot,
      snapshotKeys: pipelineSnapshot ? Object.keys(pipelineSnapshot) : [],
    });

    const result = await runWizardAgent({
      prompt,
      repoUrl,
      provider,
      branch,
      pipelineSnapshot,
      cookie: req.headers.cookie,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Wizard AI Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Normailize the repoUrl
function normalizeRepo(repoUrlOrSlug) {
  // If it's already "owner/repo", return it
  if (repoUrlOrSlug && !repoUrlOrSlug.startsWith('http')) {
    return repoUrlOrSlug;
  }

  // If it's a URL, extract owner/repo
  const url = new URL(repoUrlOrSlug);
  const parts = url.pathname
    .replace(/^\//, '')
    .replace(/\.git$/, '')
    .split('/');

  return `${parts[0]}/${parts[1]}`;
}

// Generate pipeline only
router.post('/pipeline', requireSession, async (req, res) => {
  try {
    const {
      repoUrl,
      branch = 'main',
      template = 'node_app',
      options = {},
    } = req.body;

    if (!repoUrl) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing required field: repoUrl' });
    }

    const repoSlug = normalizeRepo(repoUrl);

    const result = await pipeline_generator.handler({
      repo: repoSlug, // ✅ owner/repo (GitHub API safe)
      repoUrl, // optional: keep if cloning elsewhere
      branch,
      provider: 'gcp',
      template,
      options,
    });

    return res.json(result);
  } catch (err) {
    console.error('[pipeline error]', err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Generate pipeline only
// router.post('/pipeline', requireSession, async (req, res) => {
//   try {
//     const { repoUrl } = req.body;
//     if (!repoUrl) {
//       return res
//         .status(400)
//         .json({ success: false, error: 'Missing required field: repoUrl' });
//     }
//     const yaml = await pipeline_generator.handler({
//       repo: repoUrl,
//       // provider: 'aws', testing
//       provider: 'gcp',
//       template: 'node_app',
//     });
//     res.json({ success: true, data: yaml });
//   } catch (err) {
//     res.status(500).json({ success: false, error: err.message });
//   }
// });

// Read repository metadata
router.post('/analyze', requireSession, async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing required field: repoUrl' });
    }
    const summary = await repo_reader.handler({ repo: repoUrl });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Deploy to AWS (via OIDC)
router.post('/deploy', requireSession, async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing required field: provider' });
    }
    const deployLog = await oidc_adapter.handler({ provider });
    res.json({ success: true, data: deployLog });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Agent heartbeat
router.get('/status', (_req, res) => {
  res.json({ success: true, data: { ok: true, uptime: process.uptime() } });
});

export default router;

```

**/Users/paythonveazie/Documents/codesmith/AutoDeploy/server/server.js**
```
// library dependencies
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import 'dotenv/config';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

// routes
import meRouter from './routes/me.js';
import authAws from './routes/auth.aws.js';
import authGoogle from './routes/auth.google.js';
import mcpRouter from './routes/mcp.js';
import mcpV2Router from './routes/mcp.v2.js';
import agentRouter from './routes/agent.js';
import githubAuthRouter from './routes/auth.github.js';
import deploymentsRouter from './routes/deployments.js';
import authRouter from './routes/authRoutes.js';
import localAuthRouter from './routes/auth.local.js';
import userRouter from './routes/usersRoutes.js';
import systemBannerRouter from './routes/systemBanner.js';
import pipelineCommitRouter from './routes/pipelineCommit.js';
import pipelineSessionsRouter from './routes/pipelineSessions.js';
import scaffoldCommitRouter from './routes/scaffoldCommit.js';
import workflowCommitRouter from './routes/workflowCommit.js';
import ragRouter from './routes/rag.js';
// app.use(authRoutes);
import jenkinsRouter from './routes/jenkins.js';

// helper functions / constants / other data
import { healthCheck } from './db.js';
import { query } from './db.js';

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(morgan('dev'));
app.use(cookieParser());

// --- Request ID Middleware ---
// Generates a lightweight request ID for traceability and surfaces it to clients.
app.use((req, res, next) => {
  req.requestId =
    req.headers['x-request-id'] ||
    `req_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  res.setHeader('x-request-id', req.requestId);
  next();
});

// --- Request Logging Middleware ---
app.use((req, _res, next) => {
  const user = req.headers['x-user-id'] || 'anonymous';
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${
      req.originalUrl
    } | user=${user}`
  );
  next();
});

// Health & DB ping
app.get('/health', (_req, res) =>
  res.json({ ok: true, uptime: process.uptime() })
);

app.get('/db/ping', async (_req, res) => {
  try {
    const ok = await healthCheck();
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Routes
app.use("/api", meRouter);
app.use("/api", systemBannerRouter);
app.use('/api/rag', ragRouter);
// Admin-ish user management routes (all of these are now authz-protected
// inside usersRoutes.js using MANAGE_USERS capability).

// --- Request ID Middleware ---
// Generates a lightweight request ID for traceability and surfaces it to clients.
app.use((req, res, next) => {
  req.requestId =
    req.headers['x-request-id'] ||
    `req_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  res.setHeader('x-request-id', req.requestId);
  next();
});

app.use('/', userRouter);
app.use('/deployments', deploymentsRouter);
app.use('/agent', agentRouter);
app.use('/mcp/v1', pipelineCommitRouter);
app.use('/mcp/v1', mcpRouter);
app.use('/mcp/v1', scaffoldCommitRouter);
app.use('/mcp/v1', workflowCommitRouter);
app.use('/mcp/v2', mcpV2Router);
app.use('/auth/local', localAuthRouter);
app.use('/auth/github', githubAuthRouter);
app.use(authRouter);
// not currently using
// app.use('/auth/aws', authAws);
app.use('/auth/google', authGoogle);
app.use('/jenkins', jenkinsRouter);
app.use('/pipeline-sessions', pipelineSessionsRouter);

// Legacy inline /users endpoints have been superseded by routes/usersRoutes.js,
// which now includes authz and a small admin API for promoting users. Keeping
// everything user-related in that router keeps server.js lighter.

app.get('/connections', async (_req, res) => {
  try {
    const rows = await query(
      `select * from connections order by created_at desc limit 100;`
    );
    res.json({ connections: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Global Error Handler ---
app.use((err, _req, res, _next) => {
  console.error('Global Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message,
  });
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Listening on port: ${port}`));

```

**/Users/paythonveazie/Documents/codesmith/AutoDeploy/client/src/lib/api.ts**
```
import { usePipelineStore } from "../store/usePipelineStore";

// In dev: talk to Vite dev server proxy at /api
// In prod: use the real backend URL from VITE_API_BASE (e.g. https://api.autodeploy.app)
const DEFAULT_API_BASE = import.meta.env.MODE === "development" ? "/api" : "";

export const BASE = import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;

// SERVER_BASE is the same as BASE but without trailing /api,
// so we can call /mcp and /auth directly.
const SERVER_BASE = BASE.endsWith("/api")
  ? BASE.slice(0, -4)
  : BASE;

// Generic REST helper for /api/* endpoints
async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "include",
    ...opts,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || res.statusText);
  return data as T;
}


// Helper for MCP tool calls on the server at /mcp/v1/:tool_name
async function mcp<T>(
  tool: string,
  input: Record<string, any> = {}
): Promise<T> {
  const url = `${SERVER_BASE}/mcp/v1/${encodeURIComponent(tool)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || (payload as any)?.success === false) {
    const msg = (payload as any)?.error || res.statusText || "MCP error";
    throw new Error(msg);
  }
  return (payload as any).data as T;
}


  // A single saved YAML version from pipeline_history
export type PipelineVersion = {
  id: string;
  user_id: string;
  repo_full_name: string;
  branch: string;
  workflow_path: string;
  yaml: string;
  yaml_hash: string;
  source: string;
  created_at: string;
};

// // Derive the server base without any trailing "/api" for MCP calls
// const SERVER_BASE = BASE.replace(/\/api$/, "");

// // Generic REST helper for /api/* endpoints
// async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
//   const res = await fetch(`${BASE}${path}`, {
//     headers: { "Content-Type": "application/json" },
//     credentials: "include",
//     ...opts,
//   });
//   const data = await res.json().catch(() => ({}));
//   if (!res.ok) throw new Error((data as any)?.error || res.statusText);
//   return data as T;
// }

// // Helper for MCP tool calls on the server at /mcp/v1/:tool_name
// async function mcp<T>(
//   tool: string,
//   input: Record<string, any> = {}
// ): Promise<T> {
//   const res = await fetch(
//     `${SERVER_BASE}/mcp/v1/${encodeURIComponent(tool)}`,
//     {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       credentials: "include",
//       body: JSON.stringify(input),
//     }
//   );
//   const payload = await res.json().catch(() => ({}));
//   if (!res.ok || (payload as any)?.success === false) {
//     const msg = (payload as any)?.error || res.statusText || "MCP error";
//     throw new Error(msg);
//   }
//   // payload = { success: true, data: {...} }
//   return (payload as any).data as T;
// }

// Simple in-memory cache for AWS roles to avoid hammering MCP
let cachedAwsRoles: string[] | null = null;
let awsRolesAttempted = false;

let cachedRepos: string[] | null = null;

const cachedBranches = new Map<string, string[]>();

export const api = {

  me: () => request<{ userId: string; email?: string }>("/api/me"),

  // ===== Pipeline history + rollback =====

  async getPipelineHistory(params: {
    repoFullName: string;
    branch?: string;
    path?: string;
    limit?: number;
  }): Promise<PipelineVersion[]> {
    const { repoFullName, branch, path, limit } = params;

    const qs = new URLSearchParams();
    qs.set("repoFullName", repoFullName);
    if (branch) qs.set("branch", branch);
    if (path) qs.set("path", path);
    if (limit) qs.set("limit", String(limit));

    const res = await fetch(
      `${SERVER_BASE}/mcp/v1/pipeline_history?${qs.toString()}`,
      {
        method: "GET",
        credentials: "include",
      }
    );

    const payload = await res.json().catch(() => ({} as any));
    if (!res.ok || !payload.ok) {
      throw new Error(payload.error || res.statusText || "History failed");
    }

    // Back-end shape: { ok: true, versions: { rows: [...] } }
    const rows = (payload.versions?.rows ?? []) as PipelineVersion[];
    return rows;
  },

  async rollbackPipeline(versionId: string): Promise<any> {
    const res = await fetch(`${SERVER_BASE}/mcp/v1/pipeline_rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ versionId }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.ok) {
      throw new Error(payload.error || res.statusText || "Rollback failed");
    }

    // Backend mention: data.data.github.commit.html_url, etc
    return payload.data;
  },


  async listAwsRoles(): Promise<{ roles: string[] }> {
    // If we've already successfully fetched roles, reuse them.
    if (cachedAwsRoles && cachedAwsRoles.length > 0) {
      return { roles: cachedAwsRoles };
    }

    // If we've already *tried* once (and it failed), don't hammer the server.
    if (awsRolesAttempted) {
      return { roles: [] };
    }

    awsRolesAttempted = true;

    try {
      const data = await mcp<{ roles?: { name: string; arn: string }[] }>(
        "oidc_adapter",
        { provider: "aws" }
      );

      const roles = (data.roles ?? []).map((r) => r.arn);
      cachedAwsRoles = roles;
      return { roles };
    } catch (err) {
      console.error("[api.listAwsRoles] failed:", err);
      // Don't throw again to avoid retry loops; just return empty.
      return { roles: [] };
    }
  },


  // AI wizard – talks to /agent/wizard on the backend
  // askYamlWizard: async (input: {
  //   repoUrl: string;
  //   provider: string;
  //   branch: string;
  //   message?: string;
  //   yaml?: string;
  // }) => {
  //   const res = await fetch(`${SERVER_BASE}/agent/wizard/ai`, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     credentials: "include",
  //     body: JSON.stringify(input),
  //   });

  //   const payload = await res.json().catch(() => ({}));
  //   if (!res.ok || (payload as any)?.success === false) {
  //     throw new Error(
  //       (payload as any)?.error || res.statusText || "Agent error"
  //     );
  //   }

  //   // whatever runWizardAgent returns is in payload.data
  //   return (payload as any).data;
  // },

  askYamlWizard: async (input: {
  repoUrl: string;
  provider: string;
  branch: string;
  message?: string;   // frontend name
  yaml?: string;
}) => {
  const payload = {
    ...input,
    prompt: input.message ?? "",   // 👈 REQUIRED BY BACKEND
  };

  delete (payload as any).message;  // 👈 prevent backend confusion

  const res = await fetch(`${SERVER_BASE}/agent/wizard/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || res.statusText || "Agent error");
  }

  return data.data;
},

  // ===== MCP helpers for repos / branches / pipeline generation =====
  async listRepos(): Promise<{ repos: string[] }> {
    if (cachedRepos && cachedRepos.length > 0) return { repos: cachedRepos };

    try {
      const outer = await mcp<{
        success?: boolean;
        data?: { repositories: { full_name: string }[] };
        repositories?: { full_name: string }[];
      }>("repo_reader", {});

      const body = (outer as any)?.data ?? outer; // unwrap tool payload
      const repos = body?.repositories?.map((r: any) => r.full_name) ?? [];
      cachedRepos = repos;
      return { repos };
    } catch (err) {
      console.error("[api.listRepos] failed:", err);
      // allow retry on next call if this failed
      cachedRepos = null;
      return { repos: [] };
    }
  },

  async listBranches(repo: string): Promise<{ branches: string[] }> {
    const cached = cachedBranches.get(repo);
    if (cached) return { branches: cached };

    try {
      const outer = await mcp<{
        success?: boolean;
        data?: { repositories: { full_name: string; branches?: string[] }[] };
        repositories?: { full_name: string; branches?: string[] }[];
      }>("repo_reader", { repoFullName: repo });

      const body = (outer as any)?.data ?? outer;
      const match = body?.repositories?.find((r: any) => r.full_name === repo);
      const branches = match?.branches ?? [];
      cachedBranches.set(repo, branches);
      return { branches };
    } catch (err) {
      console.error("[api.listBranches] failed:", err);
      return { branches: cachedBranches.get(repo) ?? [] };
    }
  },
//  async listRepos(): Promise<{ repos: string[] }> {
//     //  If we already have repos cached, reuse them.
//     if (cachedRepos && cachedRepos.length > 0) {
//       return { repos: cachedRepos };
//     }

//     //  If we've already tried once and failed, don't hammer the server.
//     if (reposAttempted && !cachedRepos) {
//       return { repos: [] };
//     }

//     reposAttempted = true;

//     try {
//       const outer = await mcp<{
//         provider: string;
//         user: string;
//         repositories: { full_name: string }[];
//       }>("repo_reader", {});

//       const repos = outer?.repositories?.map((r) => r.full_name) ?? [];
//       cachedRepos = repos;
//       return { repos };
//     } catch (err) {
//       console.error("[api.listRepos] failed:", err);
//       // Don't throw to avoid retry loops from effects; just return whatever we have (or empty).
//       return { repos: cachedRepos ?? [] };
//     }
//   },

  //   async listBranches(repo: string): Promise<{ branches: string[] }> {
  //   // ✅ If we already have branches cached for this repo, reuse them.
  //   const cached = cachedBranches.get(repo);
  //   if (cached) {
  //     return { branches: cached };
  //   }

  //   try {
  //     // For now we still use repo_reader, but we only call it
  //     // when the cache is cold. We can later swap this to a
  //     // more specific MCP tool like "repo_branches".
  //     const outer = await mcp<{
  //       success?: boolean;
  //       data?: { repositories: { full_name: string; branches?: string[] }[] };
  //       repositories?: { full_name: string; branches?: string[] }[];
  //     }>("repo_reader", {
  //       // This extra input is safe: current server ignores it,
  //       // future server can use it to optimize.
  //       repoFullName: repo,
  //     });

  //     // Unwrap the payload (tool responses come back as { success, data })
  //     const body = (outer as any)?.data ?? outer;

  //     const match = body?.repositories?.find((r: any) => r.full_name === repo);
  //     const branches = match?.branches ?? [];

  //     // Cache even empty arrays so we don't re-query a repo with no branches
  //     cachedBranches.set(repo, branches);

  //     return { branches };
  //   } catch (err) {
  //     console.error("[api.listBranches] failed:", err);

  //     // If we have anything cached (even empty), use it.
  //     const fallback = cachedBranches.get(repo) ?? [];
  //     return { branches: fallback };
  //   }
  // },

  async createPipeline(payload: any) {
    const {
      repo,
      branch,
      template = "node_app",
      provider = "aws",
      options,
    } = payload || {};
    const data = await mcp("pipeline_generator", {
      repo,
      branch,
      provider,
      template,
      options: options || {},
    });
    return data;
  },

  // ===== OIDC roles (AWS) with caching =====

  // async listAwsRoles(): Promise<{ roles: string[] }> {
  //   if (cachedAwsRoles && cachedAwsRoles.length > 0) {
  //     console.log("[api.listAwsRoles] Using cached roles:", cachedAwsRoles);
  //     return { roles: cachedAwsRoles };
  //   }

  //   console.log(
  //     "[api.listAwsRoles] Fetching roles from MCP oidc_adapter (server)..."
  //   );

  //   const data = await mcp<{ roles?: { name: string; arn: string }[] }>(
  //     "oidc_adapter",
  //     { provider: "aws" }
  //   );

  //   const roles = (data.roles ?? []).map((r) => r.arn);
  //   cachedAwsRoles = roles;

  //   console.log("[api.listAwsRoles] Cached roles:", cachedAwsRoles);

  //   return { roles };
  // },

  async openPr(_payload: any) {
    throw new Error("openPr is not implemented on the server (no MCP tool)");
  },

  // --- Mocked config/secrets endpoints for Secrets/Preflight flow ---
  async getConnections(
    _repo: string
  ): Promise<{
    githubAppInstalled: boolean;
    githubRepoWriteOk: boolean;
    awsOidc: {
      connected: boolean;
      roleArn?: string;
      accountId?: string;
      region?: string;
    };
  }> {
    // Try to fetch roles to populate a default role ARN
    let roleArn: string | undefined;
    try {
      const { roles } = await this.listAwsRoles();
      roleArn = roles[0];
    } catch (e) {
      console.warn("[api.getConnections] Failed to load roles:", e);
    }
    return {
      githubAppInstalled: true,
      githubRepoWriteOk: true,
      awsOidc: {
        connected: !!roleArn,
        roleArn,
        accountId: "123456789012",
        region: "us-east-1",
      },
    };
  },

  async getSecretPresence(
    repo: string,
    env: string
  ): Promise<{ key: string; present: boolean }[]> {
    const required = ["GITHUB_TOKEN", "AWS_ROLE_ARN"];
    const store = readSecrets(repo, env);
    return required.map((k) => ({ key: k, present: !!store[k] }));
  },

  async setSecret({
    repo,
    env,
    key,
    value,
  }: {
    repo: string;
    env: string;
    key: string;
    value: string;
  }) {
    const store = readSecrets(repo, env);
    store[key] = value;
    writeSecrets(repo, env, store);
    return { ok: true } as const;
  },

  async runPreflight({
    repo,
    env,
    aws,
  }: {
    repo: string;
    env: string;
    aws?: { roleArn?: string; region?: string };
  }): Promise<{ results: { label: string; ok: boolean; info?: string }[] }> {
    const connections = await this.getConnections(repo);
    const secrets = await this.getSecretPresence(repo, env);
    const hasGithubApp = connections.githubAppInstalled;
    const hasRepoWrite = connections.githubRepoWriteOk;
    const role = aws?.roleArn || connections.awsOidc.roleArn;
    const hasAws = !!role;
    const region = aws?.region || connections.awsOidc.region || "us-east-1";
    const s = Object.fromEntries(
      secrets.map((x) => [x.key, x.present] as const)
    );

    const results = [
      { label: "GitHub App installed", ok: hasGithubApp },
      { label: "Repo write access", ok: hasRepoWrite },
      { label: "AWS OIDC configured", ok: hasAws, info: role },
      { label: "Secret: GITHUB_TOKEN", ok: !!s.GITHUB_TOKEN },
      { label: "Secret: AWS_ROLE_ARN", ok: !!s.AWS_ROLE_ARN, info: role },
      { label: "AWS Region selected", ok: !!region, info: region },
    ];
    return { results };
  },

  // --- Deploy APIs for Dashboard ---
  async startDeploy({
    repoFullName: fromCallerRepo,
    branch,
    env,
    yaml: fromCallerYaml,
    provider,
    path,
  }: {
    repoFullName?: string;
    branch?: string;
    env?: string;
    yaml?: string;
    provider?: string;
    path?: string;
  }) {
    const pipelineStore = usePipelineStore.getState();
    const repoFullName =
      fromCallerRepo ||
      pipelineStore?.repoFullName ||
      (pipelineStore as any)?.result?.repo;
    const selectedBranch = branch || (pipelineStore as any)?.selectedBranch || "main";
    const yaml =
  fromCallerYaml ||
  (pipelineStore as any)?.result?.generated_yaml ||
  "";

    const environment = env || (pipelineStore as any)?.environment || "dev";

    const providerFinal = provider || (pipelineStore as any)?.provider || "aws";
    const pathFinal =
      path || `.github/workflows/${environment}-deploy.yml`;

    console.group("[Deploy Debug]");
    console.log("repoFullName:", repoFullName);
    console.log("selectedBranch:", selectedBranch);
    console.log("environment:", environment);
    console.log("provider:", providerFinal);
    console.log("path:", pathFinal);
    console.log("YAML length:", yaml ? yaml.length : 0);
    console.groupEnd();

    const payload = {
      repoFullName,
      branch: selectedBranch,
      env: environment,
      yaml,
      provider: providerFinal,
      path: pathFinal,
    };

    console.log("[Deploy] Final payload:", payload);
if (!repoFullName) throw new Error("startDeploy: missing repoFullName");
if (!selectedBranch) throw new Error("startDeploy: missing branch");
if (!yaml || yaml.trim().length === 0) throw new Error("startDeploy: missing yaml");

    const res = await fetch(`${SERVER_BASE}/mcp/v1/pipeline_commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    console.group("[Deploy Response]");
    console.log("Status:", res.status);
    console.log("Data:", data);
    console.groupEnd();

    if (!res.ok)
      throw new Error(`Pipeline commit failed: ${res.statusText}`);
    return data;
  },

  streamJob(
    _jobId: string,
    onEvent: (e: { ts: string; level: "info"; msg: string }) => void
  ) {
    const steps = [
      "Connecting to GitHub...",
      "Committing workflow file...",
      "Verifying commit...",
      "Done ✅",
    ];
    let i = 0;
    const timer = setInterval(() => {
      if (i >= steps.length) return;
      onEvent({
        ts: new Date().toISOString(),
        level: "info",
        msg: steps[i++],
      });
      if (i >= steps.length) clearInterval(timer);
    }, 600);
    return () => clearInterval(timer);
  },
};

// Helper to start GitHub OAuth (server redirects back after callback)
export function startGitHubOAuth(
  redirectTo: string = window.location.origin
) {
  const serverBase = BASE.replace(/\/api$/, "");
  const url = `${serverBase}/auth/github/start?redirect_to=${encodeURIComponent(
    redirectTo
  )}`;
  window.location.href = url;
}

// --- Local storage helpers for mock secrets ---
function secKey(repo: string, env: string) {
  return `secrets:${repo}:${env}`;
}
function readSecrets(repo: string, env: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(secKey(repo, env));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeSecrets(repo: string, env: string, obj: Record<string, string>) {
  try {
    localStorage.setItem(secKey(repo, env), JSON.stringify(obj));
  } catch {}
}

// in-memory job storage for mock deploys
const JOBS: Map<string, any> = new Map();

```

**/Users/paythonveazie/Documents/codesmith/AutoDeploy/client/src/App.tsx**
```
// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import ConnectPage from "./pages/ConnectPage";
import ConfigurePage from "./pages/ConfigurePage";
import SecretsPage from "./pages/SecretsPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import { useRepoStore } from "./store/useRepoStore";
import { usePipelineStore } from "./store/usePipelineStore";
import { useAuthStore } from "./store/useAuthStore";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

function NeedRepo({ children }: { children: JSX.Element }) {
  const { repo, branch } = useRepoStore();
  return !repo || !branch ? <Navigate to="/connect" replace /> : children;
}
function NeedPipeline({ children }: { children: JSX.Element }) {
  const { result } = usePipelineStore();
  const hasYaml = result?.generated_yaml || result?.yaml || result?.data?.generated_yaml;
  return !hasYaml ? <Navigate to="/configure" replace /> : children;
}

// optional: simple active-link helper
function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={
        "transition-colors " +
        (active
          ? "text-white"
          : "text-slate-200/80 hover:text-white")
      }
    >
      {children}
    </Link>
  );
}

export default function App() {
  return (
    <div className="relative min-h-screen text-slate-100 overflow-hidden">
      {/* Base gradient */}
      <div className="fixed inset-0 -z-20 bg-gradient-to-br from-slate-900 via-slate-800 to-gray-900" />
      {/* Subtle dark veil for contrast */}
      <div className="fixed inset-0 -z-10 bg-black/20" />
      {/* Frosted glass shimmer – IMPORTANT: pointer-events-none so it never blocks clicks */}
      <div className="fixed inset-0 -z-10 bg-white/10 backdrop-blur-3xl pointer-events-none" />

      {/* App content above blur */}
      <div className="relative z-10">
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </div>
    </div>
  );
}

function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const showNav = pathname !== "/login";
  const { user, refreshMe, signOut, startGoogleLogin } = useAuthStore();

  useEffect(() => {
    if (!showNav) return;
    refreshMe().catch(() => undefined);
  }, [showNav, refreshMe]);

  return (
    <>
      {showNav && (
        <header className="border-b border-white/15 px-4 py-3 bg-white/5 backdrop-blur">
          <nav className="flex items-center gap-5 text-sm">
            <NavLink to="/connect">1 Connect</NavLink>
            <NavLink to="/configure">2 Configure</NavLink>
            <NavLink to="/secrets">3 Secrets</NavLink>
            <NavLink to="/dashboard">4 Dashboard</NavLink>
            <div className="ml-auto flex items-center gap-3">
              {user?.email && (
                <span className="text-slate-200/80 text-xs truncate max-w-[240px]">
                  {user.email}
                </span>
              )}
              <Button
                size="sm"
                variant="glass"
                className="px-2 py-1 h-auto"
                aria-label="Sign in with Google"
                onClick={() =>
                  startGoogleLogin(`${window.location.origin}/connect`)
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  className="h-4 w-4"
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.15 0 5.98 1.08 8.21 3.2l6.15-6.15C34.93 3.05 29.87 1 24 1 14.95 1 6.8 5.92 2.74 13.26l7.18 5.58C11.58 13.08 17.27 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.5 24c0-1.55-.14-3.04-.39-4.5H24v9h12.7c-.55 2.93-2.24 5.42-4.74 7.08l7.18 5.58C43.66 37.4 46.5 31.17 46.5 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.92 28.74c-.5-1.47-.79-3.03-.79-4.74s.29-3.27.79-4.74l-7.18-5.58C2.64 16.37 1.5 20.06 1.5 24s1.14 7.63 3.24 10.32l6.18-5.58z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 46.5c6.48 0 11.91-2.14 15.88-5.81l-7.18-5.58c-2 1.35-4.56 2.14-8.7 2.14-6.73 0-12.42-3.58-15.08-8.84l-7.18 5.58C6.8 42.08 14.95 46.5 24 46.5z"
                  />
                  <path fill="none" d="M1.5 1.5h45v45h-45z" />
                </svg>
              </Button>
              {user?.user_id && (
                <Button
                  size="sm"
                  variant="glass"
                  onClick={async () => {
                    await signOut();
                    navigate("/login", { replace: true });
                  }}
                  className="px-3 py-1 h-auto"
                >
                  Log out
                </Button>
              )}
            </div>
          </nav>
        </header>
      )}

      <main className="p-4 md:p-6 max-w-[960px] mx-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/connect" element={<ConnectPage />} />
          <Route
            path="/configure"
            element={
              <NeedRepo>
                <ConfigurePage />
              </NeedRepo>
            }
          />
          <Route
            path="/secrets"
            element={
              <NeedRepo>
                <NeedPipeline>
                  <SecretsPage />
                </NeedPipeline>
              </NeedRepo>
            }
          />
          <Route
            path="/dashboard"
            element={
              <NeedRepo>
                <DashboardPage />
              </NeedRepo>
            }
          />
        </Routes>
      </main>
    </>
  );
}

```

**/Users/paythonveazie/Documents/codesmith/AutoDeploy/client/src/pages/ConfigurePage.tsx**
```
import { useEffect, useState } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { usePipelineStore } from "../store/usePipelineStore";
import { useWizardStore } from "../store/useWizardStore";
import { api } from "../lib/api";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function ConfigurePage() {
  const { repo, branch } = useRepoStore();

  const {
    template,
    stages,
    options,
    provider,
    roles,
    status,
    error,
    result,
    setTemplate,
    setProvider,
    toggleStage,
    setOption,
    setResultYaml,
    loadAwsRoles,
    regenerate,
    openPr,
    editing,
    setEditing,
    editedYaml,
    setEditedYaml,
    getEffectiveYaml,
    hydrateFromWizard,
  } = usePipelineStore();

  const {
    repoInfo,
    pipelineInfo,
    setRepoInfo,
    setPipelineInfo,
    setLastToolCalled,
  } = useWizardStore();

  const yaml = getEffectiveYaml();
  const busy = status === "loading";

  // ---- AI Wizard Chat State ----
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your CI/CD wizard. Tell me about your repo and how you'd like your GitHub Actions YAML to behave (build, test, deploy, environments, branches, etc.).",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Load AWS roles when repo/branch is picked and provider is aws
  useEffect(() => {
    if (!repo || !branch || provider !== "aws") return;
    loadAwsRoles().catch(console.error);
  }, [repo, branch, provider, loadAwsRoles]);

  const handleGenerate = async () => {
    if (!repo || !branch) {
      alert("Pick a repo + branch on the Connect page first.");
      return;
    }

    await regenerate({
      repo,
      branch,
      template,
      provider,
      stages,
      options,
    });
  };

  const handleOpenPr = async () => {
    if (!repo || !branch) {
      alert("Pick a repo + branch on the Connect page first.");
      return;
    }
    try {
      await openPr({ repo, branch });
      alert("PR opened (or queued) successfully!");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to open PR");
    }
  };

  const toggleStageChecked = (stage: "build" | "test" | "deploy") =>
    stages.includes(stage);

  // ---- AI Wizard: send message ----
  const handleSendChat = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    // --- Sync AI intent with pipeline stages BEFORE sending to backend ---
    // The AI is a planner, not an authority. UI state must be updated first.
    const lower = trimmed.toLowerCase();

    // Reset to defaults first
    let nextStages: Array<"build" | "test" | "deploy"> = ["build", "test", "deploy"];

    if (lower.includes("just build") || lower.includes("only build")) {
      nextStages = ["build"];
    } else if (
      lower.includes("build and test") ||
      (lower.includes("build") && lower.includes("test") && !lower.includes("deploy"))
    ) {
      nextStages = ["build", "test"];
    } else if (
      lower.includes("no deploy") ||
      lower.includes("without deploy")
    ) {
      nextStages = ["build", "test"];
    }

    // Apply stage changes to the pipeline store
    (["build", "test", "deploy"] as const).forEach((stage) => {
      const shouldEnable = nextStages.includes(stage);
      const isEnabled = stages.includes(stage);
      if (shouldEnable !== isEnabled) {
        toggleStage(stage);
      }
    });

    if (!repo || !branch) {
      alert(
        "Pick a repo + branch on the Connect page first so I can give better suggestions."
      );
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    try {
      // Send the same provider/config context that the manual generator uses.
      // This prevents the wizard from producing generic placeholder provider steps.
      const pipelineSnapshot = {
        template,
        provider,
        branch,
        stages: nextStages,
        options,
      };

      const res = await api.askYamlWizard({
        repoUrl: repo,
        provider,
        branch: branch,
        message: trimmed,
        yaml,
        // Extra context for the backend/wizard toolchain (safe to ignore if unused)
        pipelineSnapshot,
      });

      if ((res as any)?.tool_called) {
        setLastToolCalled((res as any).tool_called);
      }

      if (repo) {
        setRepoInfo({
          fullName: repo,
        });
      }

      if ((res as any)?.tool_called === "pipeline_generator") {
        const generatedYaml =
          (res as any)?.generated_yaml ??
          (res as any)?.tool_output?.data?.generated_yaml;

        const pipelineName =
          (res as any)?.pipeline_metadata?.data?.pipeline_name ??
          (res as any)?.pipeline_metadata?.pipeline_name;

        if (generatedYaml) {
          hydrateFromWizard({
            repo,
            generatedYaml,
            pipelineName,
          });
        }

        setPipelineInfo({
          pipelineName,
          branch,
          provider,
          // 🔒 Never override stages from backend / metadata
          stages: pipelineSnapshot.stages,
          options,
        } as any);
      }

      let text: string;

      if ((res as any)?.reply) {
        text = (res as any).reply;
      } else if ((res as any)?.message) {
        text = (res as any).message;
      } else if (
        (res as any)?.tool_called === "repo_reader" &&
        Array.isArray((res as any)?.tool_output?.data?.data?.repositories)
      ) {
        const count = (res as any).tool_output.data.data.repositories.length;
        text = `I found ${count} repositories. You can select one from the list to continue.`;
      } else if (repoInfo?.fullName) {
        text = `I'm looking at ${repoInfo.fullName}. What would you like to change about the pipeline?`;
      } else {
        text =
          "I couldn't map that request to an action yet. You can ask me to modify the pipeline, deploy settings, or AWS role.";
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: text,
      };

      setChatMessages((prev) => [...prev, assistantMessage]);
    } catch (e: any) {
      console.error("[ConfigurePage] AI wizard error:", e);
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content:
          "Sorry, I ran into an issue talking to the AI backend.\n\n" +
          `Error: ${e?.message ?? "Unknown error"}`,
      };
      setChatMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (
    e
  ) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

  return (
    <div className="min-h-screen text-slate-100">
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Configure CI/CD pipeline
          </h1>
          {repo && branch ? (
            <p className="text-sm text-slate-200">
              Targeting{" "}
              <span className="font-mono text-white">{repo}</span> @{" "}
              <span className="font-mono text-white">{branch}</span>
            </p>
          ) : (
            <p className="text-sm text-amber-300">
              Pick a GitHub repo + branch on the Connect page first.
            </p>
          )}
        </header>

        {/* Top grid: Config form (left) + AI wizard (right) */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ===== Left: Config form ===== */}
          <section className="space-y-6 rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md shadow-glass p-6 text-white">
            {/* Template */}
            <label className="grid gap-1">
              <span className="text-sm font-medium text-white">Template</span>
              <select
                disabled={busy}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="rounded-md border border-white/25 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-500"
              >
                <option value="node_app">Node.js app</option>
                <option value="python_app">Python App</option>
                <option value="container_service">Container</option>
              </select>
              <span className="text-xs text-slate-200">
                Pick the closest match to your repo; the MCP backend refines it.
              </span>
            </label>

            {/* Provider */}
            <label className="grid gap-1">
              <span className="text-sm font-medium">Provider</span>
              <select
                disabled={busy}
                value={provider}
                onChange={(e) => setProvider(e.target.value as "aws" | "gcp")}
                className="rounded-md border border-white/25 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-500"
              >
                <option value="aws">AWS</option>
                <option value="gcp">GCP</option>
              </select>
              <span className="text-xs text-slate-200">
                Choose where to run and deploy your pipeline.
              </span>
            </label>

            {/* Stages */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-white">Enabled stages</legend>
              <div className="flex flex-wrap gap-3">
                {(["build", "test", "deploy"] as const).map((stage) => (
                  <label
                    key={stage}
                    className="inline-flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={toggleStageChecked(stage)}
                      onChange={() => toggleStage(stage)}
                      className="h-4 w-4 rounded border-white/40 bg-white/10"
                    />
                    <span className="capitalize">{stage}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Runtime version + commands */}
            <div className="grid gap-4">
              <label className="grid gap-1">
                <span className="text-sm font-medium text-white">Node version</span>
                <input
                  disabled={busy}
                  value={options.nodeVersion}
                  onChange={(e) => setOption("nodeVersion", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="20"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium text-white">Install command</span>
                <input
                  disabled={busy}
                  value={options.installCmd}
                  onChange={(e) => setOption("installCmd", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="npm ci"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium text-white">Test command</span>
                <input
                  disabled={busy}
                  value={options.testCmd}
                  onChange={(e) => setOption("testCmd", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="npm test"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium text-white">Build command</span>
                <input
                  disabled={busy}
                  value={options.buildCmd}
                  onChange={(e) => setOption("buildCmd", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="npm run build"
                />
              </label>
            </div>

            {provider === "aws" && stages.includes("deploy") && (
              <>
              <label className="grid gap-1">
                <span className="text-sm font-medium">AWS Role (OIDC)</span>
                <select
                  disabled={busy || !roles.length}
                  value={options.awsRoleArn ?? ""}
                  onChange={(e) => setOption("awsRoleArn", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm bg-black text-white"
                >
                  <option value="">-- select --</option>
                  {roles.map((r) => (
                    <option key={r.arn} value={r.arn}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-200">
                  Roles come from the backend OIDC adapter; we’ll wire this into
                  the deploy job.
                </span>
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-medium">AWS Role Session Name</span>
                <input
                  disabled={busy}
                  value={options.awsSessionName ?? ""}
                  onChange={(e) => setOption("awsSessionName", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="autodeploy"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium">AWS Region</span>
                <input
                  disabled={busy}
                  value={options.awsRegion ?? ""}
                  onChange={(e) => setOption("awsRegion", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="us-east-1"
                />
              </label>
              </>
            )}

            {provider === "gcp" && (
              <label className="grid gap-1">
                <span className="text-sm font-medium">
                  GCP Service Account Email
                </span>
                <input
                  disabled={busy}
                  value={options.gcpServiceAccountEmail ?? ""}
                  onChange={(e) =>
                    setOption("gcpServiceAccountEmail", e.target.value)
                  }
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="service-account@project.iam.gserviceaccount.com"
                />
                <span className="text-xs text-slate-200">
                  Provide the service account that should run deployments.
                </span>
              </label>
            )}

            {/* Generate / Open PR buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy || !repo || !branch}
                className="rounded-md bg-white/20 hover:bg-white/30 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Generating…" : "Generate pipeline"}
              </button>
              {status === "success" && (
                <span className="text-xs text-emerald-200">
                  YAML ready — review or edit below, then open a PR.
                </span>
              )}
            </div>

            {error && (
              <p className="text-sm text-red-300">
                Error: {error}
              </p>
            )}
          </section>

          {/* ===== Right: AI YAML Wizard Chat ===== */}
          <section className="flex flex-col rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md shadow-glass p-6 text-white">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">AI YAML wizard</h2>
                <p className="text-xs text-slate-200">
                  Describe how you want your workflow to behave. I’ll suggest
                  envs, branches, caching, matrix builds, etc.
                </p>
              </div>
            </div>

            {/* Chat messages */}
            <div className="flex-1 min-h-[200px] max-h-[320px] overflow-y-auto rounded-md border border-white/20 bg-white/5 px-3 py-2 space-y-2">
              {chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${
                    m.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`rounded-lg px-3 py-2 text-xs whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-white/20 text-white border border-white/30"
                        : "bg-white text-slate-900 border border-slate-200"
                    } max-w-[80%]`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <p className="text-[11px] text-slate-200">
                  Thinking about your pipeline…
                </p>
              )}
            </div>

            {/* Chat input */}
            <div className="mt-3 space-y-2">
              <textarea
                className="w-full rounded-md border border-white/25 bg-white/10 text-white px-3 py-2 text-xs resize-none placeholder-white/60"
                rows={3}
                placeholder="E.g. I want this to run only on main and PRs, use Node 20, cache npm, and deploy to prod on tags starting with v*…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                disabled={chatLoading}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSendChat}
                  disabled={chatLoading || !chatInput.trim()}
                  className="rounded-md bg-white/20 hover:bg-white/30 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {chatLoading ? "Asking…" : "Ask wizard"}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* ===== YAML Preview / Editor (full width) ===== */}
        <section className="space-y-3 rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md text-slate-100 p-4 shadow-glass">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium">GitHub Actions YAML</h2>
              <p className="text-xs text-slate-200">
                Review the generated workflow. Switch to manual mode to tweak
                before opening a PR.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setEditing(!editing)}
              disabled={!result}
              className="rounded-md border border-white/40 px-3 py-1.5 text-xs font-medium text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editing ? "Back to wizard view" : "Edit YAML manually"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  const toSave = editedYaml ?? yaml;
                  if (toSave) {
                    setResultYaml(toSave);
                    setEditing(false);
                  }
                }}
                disabled={!editedYaml && !yaml}
                className="rounded-md bg-white/20 hover:bg-white/30 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save YAML
              </button>
            )}
          </div>

          {status === "loading" && (
            <p className="text-xs text-slate-200">Generating pipeline…</p>
          )}

          {!result && status !== "loading" && (
            <p className="text-xs text-slate-200">
              Generate a pipeline above to see the YAML preview.
            </p>
          )}

          {result && yaml && (
            <>
              {!editing ? (
                <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-slate-900 text-slate-100 text-xs p-3 font-mono whitespace-pre">
                  {yaml}
                </pre>
              ) : (
                <textarea
                  className="mt-2 w-full h-96 rounded-md border border-slate-700 bg-slate-950 text-slate-100 text-xs font-mono p-3 resize-y"
                  spellCheck={false}
                  value={editedYaml ?? yaml}
                  onChange={(e) => setEditedYaml(e.target.value)}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

```





**Files Read:**

**/Users/paythonveazie/Documents/codesmith/AutoDeploy/server/routes/rag.js**
```
import express from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import extract from 'extract-zip';
import fg from 'fast-glob';

import { requireSession } from '../lib/requireSession.js';
import { embedBatch } from '../lib/rag/embeddingService.js';
import { upsertVectors, queryVectors, buildNamespace } from '../lib/rag/pineconeClient.js';
import { answerWithContext } from '../lib/rag/openaiRag.js';
import { logInteraction, getHistoryByNamespace } from '../lib/rag/supabaseRag.js';
import { parseGitHubRepoUrl, cloneGithubRepoShallow } from '../lib/rag/githubService.js';

const router = express.Router();

// --- Multer setup for zip uploads ---
const upload = multer({ dest: os.tmpdir() }).single('repoZip');

// --- Simple text chunker (AskMyRepo-style) ---
const CHUNK = 1800;
const OVERLAP = 200;

function chunkText(s) {
  const out = [];
  for (let i = 0; i < s.length; i += CHUNK - OVERLAP) {
    out.push(s.slice(i, i + CHUNK));
  }
  return out;
}

const CODE_EXT = /\.(js|ts|tsx|jsx|json|md|yml|yaml|sql|sh|html|css|scss|xml)$/i;
const IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

// lockfiles and other noisy artifacts we generally do not want to treat as context
const SKIP_PATH_PATTERNS = [
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)pnpm-lock\.ya?ml$/i,
  /(^|\/)bun\.lockb$/i,
];

function shouldSkipFile(relPath) {
  return SKIP_PATH_PATTERNS.some((re) => re.test(relPath));
}

function getUserId(req) {
  return req.user?.user_id || req.user?.id || null;
}

async function ingestWorkspaceCodeToNamespace({ workspace, namespace, repoSlug, userId }) {
  // 1) Discover files
  const files = await fg(['**/*.*'], {
    cwd: workspace,
    onlyFiles: true,
    ignore: IGNORE,
  });

  const codeFiles = files.filter((p) => CODE_EXT.test(p) && !shouldSkipFile(p));

  // 2) Read + chunk
  const chunks = [];
  for (const rel of codeFiles) {
    const full = path.join(workspace, rel);
    let text = '';
    try {
      text = await fs.readFile(full, 'utf8');
    } catch {
      // ignore unreadable files
    }
    if (!text) continue;
    const parts = chunkText(text);
    parts.forEach((t, idx) => chunks.push({ path: rel, idx, text: t }));
  }

  // 3) Embed + upsert in small batches
  let upserted = 0;
  const BATCH = 64;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const vectors = await embedBatch(slice.map((c) => c.text));
    const payload = vectors.map((values, k) => ({
      id: `${namespace}:${i + k}`,
      values,
      metadata: {
        path: slice[k].path,
        idx: slice[k].idx,
        text: slice[k].text,
        repo: repoSlug,
        user_id: String(userId),
      },
    }));
    await upsertVectors(namespace, payload);
    upserted += payload.length;
  }

  return { fileCount: codeFiles.length, chunkCount: chunks.length, upserted };
}

// --- POST /api/rag/ingest/zip ---
// multipart/form-data
// - repoZip: .zip file (required)
// - repoSlug: owner/repo string (required)
router.post('/ingest/zip', requireSession, (req, res, next) => {
  upload(req, res, async (err) => {
    try {
      if (err) throw err;
      if (!req.file?.path) {
        return res
          .status(400)
          .json({ error: 'Send a .zip file in field "repoZip"' });
      }

      const rawRepoSlug = req.body?.repoSlug || req.body?.repo || '';
      const repoSlug = String(rawRepoSlug || '').trim();
      if (!repoSlug) {
        return res
          .status(400)
          .json({ error: 'Missing required form field "repoSlug" (owner/repo)' });
      }

      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'No active session' });
      }

      const namespace = buildNamespace({ userId, repoSlug });

      // 1) Extract into a temp workspace
      const workspace = path.join(os.tmpdir(), `repo_ws_${Date.now()}`);
      await fs.mkdir(workspace, { recursive: true });
      await extract(req.file.path, { dir: workspace });

      const { fileCount, chunkCount, upserted } = await ingestWorkspaceCodeToNamespace({
        workspace,
        namespace,
        repoSlug,
        userId,
      });

      // Cleanup uploaded zip (best-effort)
      try {
        await fs.unlink(req.file.path);
      } catch {
        // ignore
      }

      return res.status(200).json({
        message: 'Embedded & upserted',
        namespace,
        jobId: namespace,
        fileCount,
        chunkCount,
        upserted,
      });
    } catch (e) {
      return next(e);
    }
  });
});

// --- POST /api/rag/ingest/github ---
// JSON body: { repoUrl, includeIssues?, githubToken? }
// - repoUrl is required and must be a valid GitHub repo URL
router.post('/ingest/github', requireSession, async (req, res, next) => {
  try {
    const { repoUrl, includeIssues = false, githubToken } = req.body || {};

    if (!repoUrl) {
      return res.status(400).json({ error: 'Missing "repoUrl" in body' });
    }

    const parsed = parseGitHubRepoUrl(repoUrl);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid GitHub repoUrl' });
    }

    const repoSlug = `${parsed.owner}/${parsed.repo}`;
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'No active session' });
    }

    const namespace = buildNamespace({ userId, repoSlug });

    const workspace = path.join(
      os.tmpdir(),
      `rag_github_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      await fs.mkdir(workspace, { recursive: true });
      const repoDir = path.join(workspace, 'repo');
      await cloneGithubRepoShallow({ repoUrl, dest: repoDir });

      const { fileCount, chunkCount, upserted } = await ingestWorkspaceCodeToNamespace({
        workspace: repoDir,
        namespace,
        repoSlug,
        userId,
      });

      // NOTE: includeIssues is accepted but currently ignored.
      // If you want to ingest GitHub Issues as well, we can extend this
      // to call fetchRepoIssues(...) and upsert those chunks into the same
      // namespace with kind: 'issue' metadata.

      return res.status(200).json({
        namespace,
        repo: { owner: parsed.owner, repo: parsed.repo },
        includeIssues,
        fileCount,
        chunkCount,
        upserted,
        issueCount: 0,
        issueChunkCount: 0,
        issueUpserted: 0,
      });
    } finally {
      // best-effort cleanup
      try {
        await fs.rm(workspace, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  } catch (e) {
    return next(e);
  }
});

// --- POST /api/rag/query ---
// { namespace, question, topK? }
router.post('/query', requireSession, async (req, res, next) => {
  try {
    const { namespace, question, topK = 5 } = req.body || {};

    if (!namespace || !question) {
      return res
        .status(400)
        .json({ error: 'Missing "namespace" or "question" in body' });
    }

    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'No active session' });
    }

    // Enforce that the namespace belongs to this user
    if (!String(namespace).startsWith(`${userId}:`)) {
      return res.status(403).json({ error: 'Forbidden namespace for this user' });
    }

    // 1) Embed the question
    const [qVec] = await embedBatch([question]);

    // 2) Pinecone search
    const matches = await queryVectors(namespace, qVec, Number(topK) || 5);

    // 3) Build context string
    const context = matches
      .map((m) => {
        const meta = m.metadata || {};
        const header = `File: ${meta.path} (chunk ${meta.idx}) [score ${
          m.score?.toFixed?.(3) ?? m.score
        }]`;
        return `${header}\n${meta.text || ''}`;
      })
      .join('\n\n---\n\n');

    // 4) Ask the LLM using the retrieved context
    const answer = await answerWithContext(question, context);

    // 5) Log interaction to Supabase (namespace = jobId)
    await logInteraction({ namespace, jobId: namespace, question, answer });

    // 6) Return answer + sources
    const sources = matches.map((m) => ({
      path: m.metadata?.path,
      idx: m.metadata?.idx,
      score: m.score,
    }));

    return res.status(200).json({ answer, sources });
  } catch (e) {
    return next(e);
  }
});

// --- GET /api/rag/logs?namespace=...&limit=... ---
router.get('/logs', requireSession, async (req, res, next) => {
  try {
    const { namespace, limit } = req.query || {};

    if (!namespace) {
      return res
        .status(400)
        .json({ error: 'Missing "namespace" query param' });
    }

    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'No active session' });
    }

    if (!String(namespace).startsWith(`${userId}:`)) {
      return res.status(403).json({ error: 'Forbidden namespace for this user' });
    }

    const rows = await getHistoryByNamespace({
      namespace,
      limit: limit ? Number(limit) : 50,
    });

    return res.status(200).json(rows);
  } catch (e) {
    return next(e);
  }
});

export default router;

```

**/Users/paythonveazie/Documents/codesmith/AutoDeploy/server/lib/authorization.js**
```
// Centralized authorization helpers: roles, plans, capabilities
// This builds on `requireSession`, which populates `req.user` from the JWT + `public.users`.

export const Actions = {
  USE_AGENT: 'USE_AGENT',
  USE_MCP_TOOL: 'USE_MCP_TOOL',
  MANAGE_USERS: 'MANAGE_USERS',
  MANAGE_BANNERS: 'MANAGE_BANNERS',
  // Future examples:
  // DEPLOY_PROJECT: 'DEPLOY_PROJECT',
};

const BETA_TREAT_ALL_AS_PRO = process.env.BETA_TREAT_ALL_AS_PRO === 'true';

function isPro(user) {
  // During beta, a single env flag can allow all authenticated users to behave as "pro".
  if (BETA_TREAT_ALL_AS_PRO) return true;

  // Per-user beta flag: permanently treat these users as pro, even after
  // global beta ends. This is useful for grandfathering early adopters.
  if (user?.beta_pro_granted) return true;

  // `plan` comes from `public.users.plan` (enum: 'free' | 'pro').
  // Be defensive in case user is null/undefined.
  return user?.plan === 'pro';
}

export function can(user, action) {
  if (!user) return false;

  // System / god users: separate trust zone. For now they can do everything.
  if (user.role === 'SYSTEM_ADMIN') {
    return true;
  }

  switch (action) {
    case Actions.USE_AGENT:
      // Only pro users (or everyone during beta) can use the agent.
      return isPro(user);

    case Actions.USE_MCP_TOOL:
      // MCP core tools are part of the main product. For now, any authenticated
      // user can reach them. If you later want them pro-only, change this to
      // `return isPro(user);`.
      return true;

    case Actions.MANAGE_USERS:
      // Non-system admins are not allowed to manage users. Note that we already
      // returned true above for SYSTEM_ADMIN users.
      return false;

    default:
      return false;
  }
}

// Express middleware factory
export function requireCapability(action) {
  return function capabilityMiddleware(req, res, next) {
    const user = req.user;

    if (!user) {
      // If this fires, it usually means `requireSession` was not mounted before
      // `requireCapability` on the route.
      return res.status(401).json({ error: 'No active session' });
    }

    if (!can(user, action)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return next();
  };
}

```

**/Users/paythonveazie/Documents/codesmith/AutoDeploy/server/routes/me.js**
```
import { Router } from "express";
import { requireSession } from "../lib/requireSession.js";

const router = Router();

// Basic session introspection for the frontend.
// Mounted at /api, so this becomes GET /api/me.
router.get("/me", requireSession, (req, res) => {
  const user = req.user || null;

  if (!user) {
    return res.json({ ok: false, user: null });
  }

  // Expose a stable, frontend-friendly shape. Avoid leaking sensitive columns
  // like password verifiers or raw access tokens.
  const safeUser = {
    id: user.id,
    email: user.email,
    github_username: user.github_username,
    role: user.role,
    plan: user.plan,
    beta_pro_granted: user.beta_pro_granted,
    created_at: user.created_at,
  };

  res.json({ ok: true, user: safeUser });
});

export default router;


```





**Files Read:**

**/Users/paythonveazie/Documents/codesmith/AutoDeploy/server/agent/wizardAgent.js**
```
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const MCP_BASE_URL =
  (process.env.MCP_BASE_URL || 'http://localhost:3000/mcp/v1').replace(
    /\/$/,
    ''
  );

// Added by Lorenc
// Lazily create the OpenAI client so the server can boot even if OPENAI_API_KEY is missing.
// We only require the key when the wizard agent actually needs to call OpenAI.
let _openaiClient = null;
function getOpenAIClient() {
  if (_openaiClient) return _openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is missing. Set it as an environment variable (e.g., in Cloud Run) to use the wizard agent.'
    );
  }

  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}
// -----------------------

// --- Intent extraction using LLM (structured, no regex routing) ---
async function extractGitHubIntent(llmClient, userText) {
  const intentPrompt = `
You are an intent classifier for a GitHub automation agent.

Return ONLY valid JSON. Do not explain anything.

Valid intents:
- list_repos
- repo_info
- list_root
- list_path
- check_file
- check_dir
- read_file
- list_workflows
- list_branches
- list_commits

Return JSON with exactly these fields:
{
  "intent": string,
  "repo": string | null,
  "path": string | null
}

User request:
"${userText}"
`;

  const res = await llmClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: intentPrompt }],
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch (e) {
    console.warn("⚠️ Failed to parse intent JSON, falling back to repo_info");
    return { intent: "repo_info", repo: null, path: null };
  }
}

// Helper: call MCP routes dynamically, with error handling
async function callMCPTool(tool, input, cookie) {
  try {
    const response = await fetch(`${MCP_BASE_URL}/${tool}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie:
          cookie ||
          (process.env.MCP_SESSION_TOKEN
            ? `mcp_session=${process.env.MCP_SESSION_TOKEN}`
            : ''),
      },
      body: JSON.stringify(input),
    });
    return await response.json();
  } catch (err) {
    console.warn('⚠️ MCP call failed:', err.message || err);
    return {
      success: false,
      error: 'MCP server unreachable',
      details: err?.message,
    };
  }
}

// Wizard Agent Core
export async function runWizardAgent(userPrompt) {
  // Normalize userPrompt into a consistent text form + extract cookie
  const userPromptText =
    typeof userPrompt === 'string'
      ? userPrompt
      : userPrompt?.content ||
        userPrompt?.message ||
        userPrompt?.prompt ||
        userPrompt?.body?.content ||
        userPrompt?.body?.message ||
        userPrompt?.body?.prompt ||
        '';

  // 🛑 Intent guard: handle meta / capability questions WITHOUT tools
  if (/what can you do|what do you do|help|capabilities|how does this work/i.test(userPromptText)) {
    return {
      success: true,
      agent_decision: "capabilities",
      tool_called: null,
      message: `
I’m your CI/CD wizard. Here’s what I can help you with:

• Analyze your GitHub repositories
• Generate GitHub Actions CI/CD pipelines
• Suggest best practices (branches, caching, matrix builds)
• Configure Node, Python, or container-based workflows
• Help commit workflows and open pull requests
• Explain CI/CD concepts step by step

Tell me what you’d like to do next.
`
    };
  }

  // Guard: prevent empty or meaningless prompts from reaching the LLM
  if (!userPromptText || userPromptText.trim().length < 3) {
    return {
      success: false,
      agent_decision:
        "Your message was too short or empty. Please provide more detail, such as 'list my repos' or 'tell me about user/repo'.",
      tool_called: null,
      message: 'Please provide a more descriptive request.',
    };
  }

  const cookie = userPrompt?.cookie || '';
  const pipelineSnapshot =
    userPrompt?.pipelineSnapshot ||
    userPrompt?.body?.pipelineSnapshot ||
    null;
  const systemPrompt = `
  You are the MCP Wizard Agent.
  You have full access to the following connected tools and APIs:
  - repo_reader: reads local and remote repositories, useful for listing or describing repositories
  - pipeline_generator: generates CI/CD YAMLs
  - oidc_adapter: lists AWS roles or Jenkins jobs
  - github_adapter: fetches real-time GitHub repository data through an authenticated API connection
  - gcp_adapter: fetches Google Cloud information
  Do not say that you lack access to GitHub or external data — you can retrieve this information directly through the available tools.
  Only call tools when the user explicitly asks for data retrieval or actions. Do NOT call tools for explanations, help, or capability questions.

  If the user asks:
  - “What repositories do I have on GitHub?” → use \`github_adapter\` with \`{ action: "repos" }\`
  - “Tell me about [username/repo]” → use \`github_adapter\` with \`{ action: "info", repo: "[username/repo]" }\`
  - “Tell me about [username/repo] using repo_reader” → use \`repo_reader\` with \`{ username: "...", repo: "[username/repo]" }\`
  - “List branches for [username/repo]” → use \`github_adapter\` with \`{ action: "branches", repo: "[username/repo]" }\`
  - “Show recent commits for [username/repo]” → use \`github_adapter\` with \`{ action: "commits", repo: "[username/repo]" }\`
  - “List workflows for [username/repo]” → use \`github_adapter\` with \`{ action: "workflows", repo: "[username/repo]" }\`
  - “List repos”, “List repositories”, or “repositories” → use \`repo_reader\` with optional \`{ username: "...", user_id: "..." }\`
  Valid CI/CD template types are ONLY:
  - node_app
  - python_app
  - container_service

  When selecting or generating a pipeline template, you MUST return one of these exact values.
  Never invent new template names. If unsure, default to "node_app".
  `;
  // Added by Lorenc
  let client;
  try {
    client = getOpenAIClient();
  } catch (e) {
    // Important: do not crash the whole server/container if OpenAI isn't configured.
    return {
      success: false,
      agent_decision: 'OpenAI not configured',
      tool_called: null,
      message: e?.message || 'OPENAI_API_KEY is missing.',
    };
  }
  //--------------

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content:
          typeof userPrompt === 'string'
            ? userPrompt
            : userPrompt?.content ||
              userPrompt?.message ||
              userPrompt?.prompt ||
              '',
      },
    ],
  });

  const decision = completion.choices[0].message.content;
  console.log('\n🤖 Agent decided:', decision);

  let agentMeta = {
    agent_decision: decision,
    tool_called: null,
  };

  // Tool mapping using regex patterns
  const toolMap = {
    repo_reader: /\b(list repos|list repositories|repo_reader)\b/i,
    pipeline_generator: /\bpipeline\b/i,
    pipeline_commit:
      /\b(yes commit|commit (the )?(pipeline|workflow|file)|apply (the )?(pipeline|workflow)|save (the )?(pipeline|workflow)|push (the )?(pipeline|workflow))\b/i,
    oidc_adapter: /\b(role|jenkins)\b/i,
    github_adapter:
      /\b(github|repo info|repositories?|repos?\b|repo\b|[\w-]+\/[\w-]+)\b/i,
  };

  // Short-circuit if agent_decision is "capabilities"
  if (agentMeta.agent_decision === "capabilities") {
    return {
      success: true,
      agent_decision: agentMeta.agent_decision,
      tool_called: null
    };
  }

  for (const [toolName, pattern] of Object.entries(toolMap)) {
    if (pattern.test(userPromptText)) {
      console.log('🔧 Triggering MCP tool:', toolName);

      // --- Extract context dynamically from userPrompt or decision ---
      // Prefer explicit labels like: "repo owner/name", "template node_app", "provider aws"
      const labeledRepo =
        userPromptText.match(
          /\brepo\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i
        ) || decision.match(/\brepo\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i);
      const genericRepo = (userPromptText + ' ' + decision).match(
        /\b(?!ci\/cd\b)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/
      );
      const repo =
        labeledRepo?.[1] ||
        genericRepo?.[1] ||
        pipelineSnapshot?.repo ||
        null;

      const labeledProvider =
        userPromptText.match(/\bprovider\s+(aws|jenkins|gcp|azure)\b/i) ||
        decision.match(/\bprovider\s+(aws|jenkins|gcp|azure)\b/i);
      const genericProvider =
        userPromptText.match(/\b(aws|jenkins|github actions|gcp|azure)\b/i) ||
        decision.match(/\b(aws|jenkins|github actions|gcp|azure)\b/i);
      const provider = (labeledProvider?.[1] || genericProvider?.[1] || null)
        ?.toLowerCase()
        .replace(/\s+/g, ' ');

      const labeledTemplate =
        userPromptText.match(/\btemplate\s+([a-z_][a-z0-9_]+)\b/i) ||
        decision.match(/\btemplate\s+([a-z_][a-z0-9_]+)\b/i);
      const genericTemplate =
        userPromptText.match(
          /\b(node_app|python_app|container_service|node|python|react|express|django|flask|java|go)\b/i
        ) ||
        decision.match(
          /\b(node_app|python_app|container_service|node|python|react|express|django|flask|java|go)\b/i
        );
      const template = (
        labeledTemplate?.[1] ||
        genericTemplate?.[1] ||
        null
      )?.toLowerCase();

      if (toolName === "repo_reader") {
        // Prevent accidental file reads with repo_reader
        if (/\b(read|get|open)\b.*\b(file|contents)\b/i.test(userPromptText)) {
          return {
            success: false,
            error: "File reading is handled by the GitHub adapter. Please specify a GitHub repository and file path."
          };
        }
        // Extract optional username, user_id, and repo info
        const usernameMatch = userPromptText.match(
          /\busername[:=]?\s*([\w-]+)\b/i
        );
        const userIdMatch = userPromptText.match(
          /\buser[_ ]?id[:=]?\s*([\w-]+)\b/i
        );
        const repoMatch = userPromptText.match(/\b([\w-]+\/[\w-]+)\b/);

        const payload = {};
        if (usernameMatch) payload.username = usernameMatch[1];
        if (userIdMatch) payload.user_id = userIdMatch[1];
        if (repoMatch) {
          const [username, repo] = repoMatch[1].split('/');
          payload.username = username;
          payload.repo = `${username}/${repo}`;
        }

        agentMeta.tool_called = 'repo_reader';
        const output = await callMCPTool('repo_reader', payload, cookie);
        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          tool_output: output,
        };
      }

      if (toolName === 'pipeline_generator') {
        // Only allow pipeline generation if we have a repo context
        if (!repo) {
          console.warn('⚠️ Missing repo context for pipeline generation.');
          return {
            success: false,
            error:
              "I couldn’t determine which repository you meant. Please specify it, e.g., 'generate pipeline for user/repo'.",
          };
        }

        // Build payload strictly from UI/intent, NOT from any AI-generated YAML
        const payload = { repo };
        // 🔒 Template is authoritative from UI snapshot
        if (pipelineSnapshot?.template) {
          console.log(`🔒 Template locked from pipeline snapshot: ${pipelineSnapshot.template}`);
          payload.template = pipelineSnapshot.template;
        }
        if (pipelineSnapshot?.branch) {
          payload.branch = pipelineSnapshot.branch;
        }
        // Provider locked from pipelineSnapshot if present
        if (pipelineSnapshot?.provider) {
          payload.provider = pipelineSnapshot.provider;
          console.log(`🔒 Provider locked from pipeline snapshot: ${payload.provider}`);
        } else if (provider) {
          payload.provider = provider;
        }
        // Template explicit or inferred, but UI snapshot is authoritative
        if (!payload.template && template) payload.template = template;
        // Fetch GitHub repo details to help infer template/provider if needed
        let repoInfo = null;
        try {
          const info = await callMCPTool(
            'github_adapter',
            { action: 'info', repo },
            cookie
          );
          if (info?.data?.success) {
            repoInfo = info.data;
            console.log(`📦 Retrieved repo info from GitHub:`, repoInfo);
          }
        } catch (err) {
          console.warn(
            '⚠️ Failed to fetch GitHub info before pipeline generation:',
            err.message
          );
        }
        // Merge language or visibility into payload if available
        if (repoInfo?.language && !payload.language)
          payload.language = repoInfo.language.toLowerCase();
        if (repoInfo?.visibility && !payload.visibility)
          payload.visibility = repoInfo.visibility;
        // Infer template ONLY if not provided by UI or user
        if (!payload.template) {
          if (
            repoInfo?.language?.toLowerCase().includes('javascript') ||
            repoInfo?.language?.toLowerCase().includes('typescript') ||
            /js|ts|node|javascript/i.test(repo)
          ) {
            payload.template = 'node_app';
          } else if (
            repoInfo?.language?.toLowerCase().includes('python') ||
            /py|flask|django/i.test(repo)
          ) {
            payload.template = 'python_app';
          } else {
            payload.template = 'container_service';
          }
          console.log(`🪄 Inferred template: ${payload.template}`);
        }
        // --- Auto-correct short template names ---
        if (payload.template === 'node') payload.template = 'node_app';
        if (payload.template === 'python') payload.template = 'python_app';
        if (payload.template === 'container')
          payload.template = 'container_service';
        // --- Validate template against allowed values ---
        const allowedTemplates = [
          'node_app',
          'python_app',
          'container_service',
        ];
        if (!allowedTemplates.includes(payload.template)) {
          console.warn(
            '⚠ Invalid template inferred:',
            payload.template,
            '— auto-correcting to node_app.'
          );
          payload.template = 'node_app';
        }
        // --- Add options and stages from pipelineSnapshot only ---
        if (pipelineSnapshot?.options) {
          payload.options = pipelineSnapshot.options;
        }
        // 🔐 Authoritative enforcement: AI may suggest, UI decides
        if (pipelineSnapshot?.stages) {
          payload.stages = pipelineSnapshot.stages;
        }
        // Defensive: ensure AI cannot override stages, only UI/UX
        // (already enforced above)
        console.log('🧩 Final payload to pipeline_generator:', payload);
        agentMeta.tool_called = 'pipeline_generator';
        const output = await callMCPTool('pipeline_generator', payload, cookie);
        // Extract YAML for confirmation step (NO AI YAML merging, only backend-generated)
        const generatedYaml =
          output?.data?.data?.generated_yaml ||
          output?.data?.generated_yaml ||
          null;
        // Return confirmation-required structure
        return {
          success: true,
          requires_confirmation: true,
          message:
            'A pipeline has been generated. Would you like me to commit this workflow file to your repository?',
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          generated_yaml: generatedYaml,
          pipeline_metadata: output,
        };
      }

      if (toolName === 'pipeline_commit') {
        console.log('📝 Commit intent detected.');

        // ❗ Guard: Prevent confusing "repo commit history" with "pipeline commit"
        if (
          /recent commits|commit history|see commits|show commits|view commits/i.test(
            decision + ' ' + userPromptText
          )
        ) {
          console.log(
            '⚠ Not pipeline commit. Detected intention to view repo commit history.'
          );
          agentMeta.tool_called = 'github_adapter';

          const repoForCommits = repo || pipelineSnapshot?.repo || null;
          if (!repoForCommits) {
            return {
              success: false,
              error:
                "Please specify a repository, e.g. 'show commits for user/repo'.",
            };
          }

          const output = await callMCPTool(
            'github_adapter',
            { action: 'commits', repo: repoForCommits },
            cookie
          );

          return {
            success: true,
            agent_decision: agentMeta.agent_decision,
            tool_called: agentMeta.tool_called,
            tool_output: output,
          };
        }

        // Ensure we have a repo
        const commitRepo = repo || pipelineSnapshot?.repo || null;
        if (!commitRepo) {
          return {
            success: false,
            error:
              "I don’t know which repository to commit to. Please specify the repo (e.g., 'commit to user/repo').",
          };
        }

        // Extract YAML from userPrompt or fallback to last generated YAML
        const yamlMatch = userPromptText.match(/```yaml([\s\S]*?)```/i);
        const yamlFromPrompt = yamlMatch ? yamlMatch[1].trim() : null;

        const yaml =
          yamlFromPrompt ||
          pipelineSnapshot?.generated_yaml ||
          pipelineSnapshot?.yaml ||
          null;

        if (!yaml) {
          return {
            success: false,
            error:
              'I don’t have a pipeline YAML to commit. Please generate one first.',
          };
        }

        const commitPayload = {
          repoFullName: commitRepo,
          yaml,
          branch: 'main',
          path: '.github/workflows/ci.yml',
        };

        agentMeta.tool_called = 'pipeline_commit';
        const output = await callMCPTool(
          'pipeline_commit',
          commitPayload,
          cookie
        );

        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          committed_repo: commitRepo,
          committed_path: '.github/workflows/ci.yml',
          tool_output: output,
        };
      }

      if (toolName === 'oidc_adapter') {
        const payload = provider ? { provider } : {};
        agentMeta.tool_called = 'oidc_adapter';
        const output = await callMCPTool('oidc_adapter', payload, cookie);
        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          tool_output: output,
        };
      }

      if (toolName === "github_adapter") {
        agentMeta.tool_called = "github_adapter";

        // --- Structured intent extraction ---
        const intentData = await extractGitHubIntent(client, userPromptText);
        const { intent, repo: intentRepo, path: intentPath } = intentData;

        const resolvedRepo = repo || intentRepo;

        // 🔒 Path always implies filesystem, never GitHub Actions metadata
        let normalizedIntent = intent;
        if (intentPath && intent === "list_workflows") {
          normalizedIntent = "list_path";
        }

        // Map intent → github_adapter action
        let action;
        let path;

        switch (normalizedIntent) {
          case "list_repos":
            action = "repos";
            break;

          case "list_root":
            action = "contents";
            break;

          case "list_path":
            action = "contents";
            path = intentPath;
            break;

          case "check_dir":
            action = "contents";
            path = intentPath;
            break;

          case "check_file":
            action = "file";
            path = intentPath;
            break;

          case "read_file":
            action = "file";
            path = intentPath;
            break;

          case "list_workflows":
            action = "workflows";
            break;

          case "list_branches":
            action = "branches";
            break;

          case "list_commits":
            action = "commits";
            break;

          case "repo_info":
          default:
            action = "info";
            break;
        }

        // Repos listing does not require repo
        if (action === "repos") {
          const output = await callMCPTool("github_adapter", { action }, cookie);
          return {
            success: true,
            agent_decision: agentMeta.agent_decision,
            tool_called: agentMeta.tool_called,
            tool_output: output,
          };
        }

        // All other actions require a repo
        if (!resolvedRepo) {
          return {
            success: false,
            error: "Please specify a repository (e.g. 'user/repo')."
          };
        }

        const payload = { action, repo: resolvedRepo };
        if (path) payload.path = path;

        const output = await callMCPTool("github_adapter", payload, cookie);

        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          tool_output: output
        };
      }
    }
  }

  return {
    success: false,
    agent_decision: agentMeta.agent_decision,
    tool_called: null,
    message:
      'No matching tool found. Try asking about a repo, pipeline, or AWS role.',
  };
}

// Example local test (can comment out for production)
if (process.argv[2]) {
  const input = process.argv.slice(2).join(' ');
  runWizardAgent(input)
    .then((res) => {
      console.log('\n📦 Tool Output:\n', JSON.stringify(res, null, 2));
    })
    .catch(console.error);
}

```





**Documents Created:**

**Document 3958acc1-5afa-4f94-b536-1d54fd7555aa**
```
# Workflow Copilot Agent – Technical Design
## 1. Scope and Objectives
This design implements the Workflow Copilot Agent described in the PRD as a chat-style, repo-aware assistant focused on CI/CD workflows for GitHub repos.
Key goals
* Chat-based UX with one-click entry points and guided next steps, from analysis through to workflow YAML generation and optionally committing via existing flows.
* Two capability tiers: User mode (no RAG) and Pro mode (RAG-backed, deeper repo understanding), gated by existing user plan flags.
* Advisory-only agent: it reads repos, explains workflows, and proposes YAML or diffs, but does not perform direct writes; commits and pushes are performed via existing MCP tools and dashboard flows.
* RAG available only to Pro users, indexing per request and limited to files relevant for workflows.
Non-goals
* Supporting non-GitHub CI providers in v1.
* Persisting long-lived chat history; conversations are ephemeral to the current browser session.
## 2. Current State Overview
Backend
* Express app in server/server.js.
* Agent router in server/routes/agent.js exposes
    * POST /agent/wizard and POST /agent/wizard/ai → runWizardAgent in server/agent/wizardAgent.js.
    * /agent/pipeline, /agent/analyze, /agent/deploy, /agent/status.
* wizardAgent (server/agent/wizardAgent.js)
    * Uses OpenAI chat completions (gpt-4o-mini) with a hand-written system prompt.
    * Calls MCP tools via HTTP to MCP_BASE_URL (default [http://localhost:3000/mcp/v1):](http://localhost:3000/mcp/v1):) repo_reader, pipeline_generator, pipeline_commit, oidc_adapter, github_adapter.
    * Handles some meta intents (capabilities, empty prompts) directly.
    * Contains its own tool-routing logic based on regexes and a structured GitHub intent helper.
    * Can currently generate pipelines and also trigger pipeline_commit.
* RAG router in server/routes/rag.js exposes
    * POST /api/rag/ingest/zip and /api/rag/ingest/github: ingest code into Pinecone with per-user namespaces and log interactions into Supabase.
    * POST /api/rag/query: query vectors and answer via answerWithContext.
    * GET /api/rag/logs: retrieve RAG interaction history.
    * Uses requireSession but no plan-based gating.
* Authorization
    * server/lib/authorization.js defines Actions.USE_AGENT and can(user, action) with isPro(user) using plan and beta_pro_granted, plus BETA_TREAT_ALL_AS_PRO.
    * /agent routes already use requireSession + requireCapability(Actions.USE_AGENT) for wizard endpoints.
Frontend
* App shell in client/src/App.tsx with main flow: /login → /connect → /configure → /secrets → /dashboard.
* ConfigurePage in client/src/pages/ConfigurePage.tsx
    * Left side: pipeline configuration form and YAML preview/editor backed by usePipelineStore.
    * Right side: "AI YAML wizard" chat with local ChatMessage state and api.askYamlWizard.
    * askYamlWizard in client/src/lib/api.ts calls POST SERVER_BASE/agent/wizard/ai with prompt and pipelineSnapshot (template, provider, branch, stages, options) and optional yaml.
    * Chat replies currently read res.reply or res.message, or fall back to generic text.
* MCP and repo APIs are wrapped in client/src/lib/api.ts via mcp and request helpers.
## 3. High-Level Design
We will introduce a Workflow Copilot Agent as a specialization of the existing wizard agent stack, keeping the transport and most wiring but tightening the scope and adding mode-aware behavior.
Key decisions
* Reuse /agent/wizard/ai as the copilot transport initially, but refine its behavior and prompt to be
    * Workflow- and repo-workflow-specific.
    * Read-only (no direct pipeline_commit calls from the agent path used by the frontend copilot).
* Add explicit User vs Pro mode logic in the backend entrypoint, mapping to
    * User mode: MCP tools only (github_adapter, repo_reader, pipeline_generator) with heuristics.
    * Pro mode: MCP tools plus calls to /api/rag/ingest/github and /api/rag/query when deeper context is needed.
* Gating
    * Keep Actions.USE_AGENT as the capability for any copilot usage.
    * Gate RAG usage behind the same effective Pro logic (isPro(user)), by updating ragRouter to enforce Pro-only access.
* Frontend
    * Rename and slightly reshape the AI panel on ConfigurePage into "Workflow Copilot".
    * Add one-click entry points and guided next-step buttons.
    * Keep chat state ephemeral in React; do not persist conversation server-side beyond a single request.
## 4. Backend Design
### 4.1 New copilot entrypoint contract
We keep the existing POST /agent/wizard/ai route but treat it as the Workflow Copilot endpoint.
Request body (from frontend)
* prompt: string (required) – user message.
* repoUrl: string (required when repo selected).
* branch: string (optional, but recommended).
* provider: string ("aws" | "gcp") for context only.
* pipelineSnapshot: object – same shape as current ConfigurePage passes
    * template: string (node_app | python_app | container_service).
    * provider: string.
    * branch: string.
    * stages: string[] (build, test, deploy).
    * options: record of runtime / command options (nodeVersion, installCmd, etc.).
* yaml: string (optional) – current YAML for comparison or modification.
Response shape (normalized)
* success: boolean.
* mode: "user" | "pro".
* data: object with
    * reply: string – assistant message explaining what it did or answering the question.
    * suggestions?: array of
        * id: string.
        * title: string.
        * description: string.
    * workflow_profile?: object – structured summary of current workflows where available.
    * generated_yaml?: string – suggested full workflow YAML.
    * yaml_diff?: string – optional patch or annotated diff.
    * tool_called?: string – MCP tool or RAG action used (for debugging / UI hints).
We will update runWizardAgent to always return reply in this normalized manner for the copilot path, while keeping backward-compatible behavior for any other internal uses.
### 4.2 Mode detection (User vs Pro)
We will add a thin wrapper around runWizardAgent in server/routes/agent.js that
* Relies on requireSession and requireCapability(Actions.USE_AGENT) for access control.
* Reads req.user from requireSession to inspect
    * plan.
    * beta_pro_granted.
    * BETA_TREAT_ALL_AS_PRO.
* Derives
    * const pro = isPro(req.user) (leveraging the helper from authorization.js).
* Passes mode: pro ? "pro" : "user" into runWizardAgent.
Signature change for runWizardAgent
* export async function runWizardAgent(userPrompt, opts = {}) where opts can include
    * mode: "user" | "pro".
    * user: minimal safe user record (id, email, plan, beta_pro_granted).
### 4.3 RAG gating and integration
RAG gating
* Update server/routes/rag.js to enforce Pro-only access:
    * Import { Actions, requireCapability } from "../lib/authorization.js".
    * Wrap core RAG endpoints with requireCapability(Actions.USE_AGENT), in addition to requireSession.
    * This ensures only effective Pro users can call /api/rag/ingest/* and /api/rag/query while preserving existing per-user namespace protection.
Copilot RAG integration (Pro mode only)
* Inside runWizardAgent, when mode === "pro" and the LLM determines that a workflow-specific answer needs deeper code context, we add helper functions
    * async function ensureRepoIndexed({ user, repoUrl }):
        * Use parseGitHubRepoUrl(repoUrl) to derive owner/repo.
        * Compute namespace via buildNamespace({ userId: user.id, repoSlug }).
        * Option 1 (simplest): call /api/rag/ingest/github with repoUrl, then immediately /api/rag/query on that namespace.
        * Option 2 (more incremental): track an in-memory cache of last-ingested namespaces by user+repo and re-use if fresh; this can be added later.
        * Apply file filtering for large repos by reusing CODE_EXT/IGNORE from rag.js and optionally restricting ingestion to
        * .github/workflows/**.
        * package.json, requirements.txt, Dockerfiles, infra manifests.
        * tests/**.
        * V1 can reuse ingestWorkspaceCodeToNamespace as-is but called from ragRouter only; runWizardAgent should orchestrate via HTTP to /api/rag rather than re-importing helper functions.
    * async function askRag({ user, repoUrl, question }):
        * Calls ensureRepoIndexed to get namespace.
        * POST /api/rag/query with { namespace, question, topK }.
        * Returns { answer, sources }.
Tool routing decision
* The LLM system prompt will be updated to prefer MCP tools for
    * Listing workflows.
    * Reading GitHub repo metadata.
* When the user asks
    * Deep questions about test coverage, build graphs, or complex, multi-service workflows.
    * Or free-form "How does this whole repo deploy?" type questions.
* The agent can choose to call askRag for additional context and blend the RAG answer into the final reply.
### 4.4 Tightening tool surface and read-only behavior
We will adjust wizardAgent tool routing for the copilot path to enforce read-only semantics.
Changes
* Remove pipeline_commit from the toolMap for copilot usage, or gate it under an explicit opt-in path that is not used by ConfigurePage.
* Ensure that
    * pipeline_generator calls always return generated_yaml and metadata but do not commit anything.
    * Any commit actions are expected to be initiated by the frontend via existing REST endpoints and MCP tools (e.g., /mcp/v1/pipeline_commit), not initiated by the LLM.
* Keep repo_reader, github_adapter, and oidc_adapter as read-only data sources.
Implementation strategy
* Add a new option flag in runWizardAgent options: allowPipelineCommit (default false).
* For the copilot entrypoint, call runWizardAgent with allowPipelineCommit: false, and early-return with a friendly error if the tool routing would hit pipeline_commit.
* For any legacy or future power-user endpoints that intentionally allow LLM-initiated commits, pass allowPipelineCommit: true.
### 4.5 Prompt and behavior tuning
We will revise the system prompt in wizardAgent to focus it as a Workflow Copilot.
Key prompt changes
* Clearly define responsibilities
    * Explain current GitHub Actions workflows and when they run.
    * Identify missing best practices (tests, build, deploy, caching, branches).
    * Propose short, prioritized lists of suggested improvements.
    * Generate GitHub Actions YAML snippets and diffs.
* Make explicit mode behavior
    * In User mode: rely on GitHub adapter and pipeline_generator; do not reference RAG or long-term memory.
    * In Pro mode: you may call a RAG helper to answer deeper questions and reference file paths in your answers.
* Limit suggestion length
    * Encourage returning at most 3–5 improvements at a time.
* Clarify that the agent should never say it can directly commit; instead, it should offer guidance and mention that the UI will handle applying changes.
### 4.6 Telemetry
We will add lightweight logging in server/routes/agent.js around the copilot endpoint
* Log
    * requestId (already available in req.requestId).
    * user id.
    * mode (user vs pro).
    * repo slug (if available).
    * whether MCP or RAG calls were made.
* Optionally, define a simple events table later (not required for v1) to track
    * copilot_session_started, copilot_prompt, copilot_suggestion_generated, etc.
## 5. Frontend Design
### 5.1 Workflow Copilot UI surface
We will evolve the existing AI YAML wizard panel on ConfigurePage into the Workflow Copilot.
Visual changes
* Rename headers and help text from "AI YAML wizard" to "Workflow Copilot".
* Add a small mode badge near the header
    * "User" for non-pro users.
    * "Pro" for users where me().user.plan === 'pro' or beta_pro_granted is true.
Behavioral changes
* Replace the initial assistant message with a prompt aligned to the PRD
    * Explain that it can read the repo, summarize workflows, suggest improvements, and propose YAML.
* Introduce one-click entry chips/buttons above the chat input, for example
    * "Analyze current workflows".
    * "Suggest missing checks".
    * "Propose full CI pipeline".
* These buttons
    * Pre-fill chatInput with a template prompt and trigger handleSendChat.
### 5.2 Ephemeral session state
Chat state
* Continue to maintain chatMessages and chatInput in Component state.
* Do not persist chat history beyond the lifetime of the tab/session.
* Optionally, keep the last N messages and send them to the backend for better contextual answers (v1 can send only the latest user message and rely on pipelineSnapshot).
User vs Pro mode
* Extend useAuthStore or a small helper to expose
    * isPro = user.plan === 'pro' or beta_pro_granted.
* Pass mode implicitly
    * The backend can infer mode from req.user; the frontend does not need to send it explicitly but can use isPro to
        * Show Pro badge.
        * Gate UI decorations such as a "Deep repo analysis (Pro)" chip.
### 5.3 Request/response handling
We will adapt ConfigurePage.handleSendChat to the normalized copilot response.
When calling api.askYamlWizard
* Continue sending
    * repoUrl, provider, branch, message (mapped to prompt), yaml, pipelineSnapshot.
* After receiving the response data
    * Use data.reply as the assistant message body.
    * If data.suggestions exists, render them as a short bullet list under the message or as clickable chips.
    * If data.generated_yaml exists
        * Call hydrateFromWizard to update usePipelineStore.result and effective YAML.
        * Update useWizardStore.setPipelineInfo as today, but ensure that stages remain authoritative from UI.
We may extend api.askYamlWizard type definitions to reflect the new response shape, but in v1 we can treat data as any while wiring up the minimal fields.
### 5.4 Guided next steps
We will add a small section under the chat input or below the latest assistant message that conditionally renders next-step one-click buttons based on the last response, for example
* After an analysis-only reply
    * "Generate CI YAML from these suggestions" → triggers a pipeline_generator-focused prompt.
* After YAML generation
    * "Review YAML below" (no action, just hint).
    * "Open PR with this YAML" → uses existing startDeploy or pipeline_commit flow, not the LLM.
Implementation
* Track a small piece of local state, lastCopilotContext, containing
    * lastAction: "analysis" | "suggestions" | "yaml_generated".
    * lastRepo: string.
* Render context-specific buttons that call
    * handleGenerate (existing manual generator) or a new wrapper that reuses generated_yaml from the copilot.
    * startDeploy or a dashboard action to commit via MCP tools.
## 6. Data and Auth
User model
* Rely on existing public.users.plan and beta_pro_granted as surfaced via /api/me.
Auth enforcement
* Access to /agent/wizard/ai and /api/rag/* remains behind requireSession.
* Capability-based gating for
    * /agent/wizard/ai: requireCapability(Actions.USE_AGENT) (already applied).
    * /api/rag/*: add requireCapability(Actions.USE_AGENT) to enforce Pro-only RAG access.
Namespaces and indexing
* RAG namespaces continue to use buildNamespace({ userId, repoSlug }).
* For each Pro copilot request that chooses to use RAG
    * The agent orchestrates ingestion via /api/rag/ingest/github.
    * Queries via /api/rag/query for that namespace.
## 7. Rollout and Migration
Phase 1: Internal wiring
* Implement mode detection and read-only guard in runWizardAgent.
* Update agent route to pass user info and mode.
* Add RAG capability gating.
* Adjust wizardAgent prompt and output normalization to return reply and suggestions consistently.
Phase 2: Frontend integration
* Update ConfigurePage labels and helper text to "Workflow Copilot".
* Wire chat handling to the new normalized response shape, including suggestions and generated_yaml.
* Add mode badge and one-click entry points.
Phase 3: Hardening
* Log copilot usage metrics and basic latency.
* Tune prompts based on observed behavior.
* Optionally, refine RAG indexing to only include workflow-related files for large repos.
## 8. Open Implementation Details
* How many previous messages, if any, should the backend see per request for better context.
* How aggressively to cache RAG ingestion for a given user+repo to avoid re-cloning on every Pro request.
* Exact UX for "Open PR" buttons and how tightly to couple them with the YAML produced by the copilot versus the existing wizard generator.

```



Here’s the technical design in a concise form (already saved as a plan in your repo context).

---

# Workflow Copilot Agent – Technical Design (Summary)

## 1. Scope and Objectives

- Implement the **Workflow Copilot Agent** as a chat-style, repo-aware assistant focused on **GitHub Actions** workflows.
- Two modes:
  - **User**: MCP-only, no RAG.
  - **Pro**: Adds RAG-backed deep repo understanding.
- Agent is **advisory only**: no direct commits; actual writes go through existing MCP tools / dashboard flows.
- RAG is **Pro-only**, indexing **per request**, limited to workflow-relevant files.

---

## 2. Current State (Relevant Pieces)

- **Backend**
  - `server/server.js`: mounts `/agent` and `/api/rag`.
  - `server/routes/agent.js`:
    - `POST /agent/wizard` and `POST /agent/wizard/ai` → `runWizardAgent` in `server/agent/wizardAgent.js`.
    - Other routes: `/pipeline`, `/analyze`, `/deploy`, `/status`.
  - `server/agent/wizardAgent.js`:
    - Uses OpenAI (`gpt-4o-mini`).
    - Calls MCP tools via HTTP: `repo_reader`, `pipeline_generator`, `pipeline_commit`, `oidc_adapter`, `github_adapter`.
    - Has internal tool-routing logic (regex + GitHub intent helper).
  - `server/routes/rag.js`:
    - `/api/rag/ingest/zip`, `/api/rag/ingest/github`, `/api/rag/query`, `/api/rag/logs`.
    - Uses per-user+repo namespaces, Pinecone, Supabase.
    - Currently only `requireSession` (no plan-based gating).
  - `server/lib/authorization.js`:
    - `Actions.USE_AGENT` gated by `isPro(user)` (`plan === 'pro'` or `beta_pro_granted`, or global beta flag).
- **Frontend**
  - `client/src/App.tsx`: `/connect` → `/configure` → `/secrets` → `/dashboard` flow.
  - `client/src/pages/ConfigurePage.tsx`:
    - Left: pipeline config + YAML preview/editor (`usePipelineStore`).
    - Right: **“AI YAML wizard”** chat (local state).
    - Calls `api.askYamlWizard()` → `POST /agent/wizard/ai`.
  - `client/src/lib/api.ts`:
    - `askYamlWizard({ repoUrl, provider, branch, message, yaml, pipelineSnapshot })` → `POST ${SERVER_BASE}/agent/wizard/ai`.

---

## 3. High-Level Design

- **Reuse** `/agent/wizard/ai` as the transport for the Workflow Copilot (to avoid new routes).
- Make `runWizardAgent`:
  - Mode-aware (`user` vs `pro`).
  - Workflow-focused.
  - **Read-only** for the copilot entrypoint (no `pipeline_commit` calls).
- **Gating**:
  - Keep `/agent/wizard/ai` behind `requireSession` + `requireCapability(Actions.USE_AGENT)` (already there).
  - Add Pro-only gating to `/api/rag/*` using the same capability.
- **Frontend**:
  - Turn “AI YAML wizard” into **“Workflow Copilot”** with:
    - Mode badge (User / Pro).
    - One-click entry prompts.
    - Ephemeral chat, richer structured responses.

---

## 4. Backend Design

### 4.1 Copilot Endpoint Contract

**Endpoint:** `POST /agent/wizard/ai` (unchanged URL, new semantics).

**Request (from frontend)**

- `prompt` (string, required).
- `repoUrl` (string; required when repo is selected).
- `branch` (string, optional but recommended).
- `provider` (`"aws" | "gcp"`, context only).
- `pipelineSnapshot`:
  - `template`: `"node_app" | "python_app" | "container_service"`.
  - `provider`, `branch`.
  - `stages`: `("build" | "test" | "deploy")[]`.
  - `options`: `{ nodeVersion?, installCmd?, testCmd?, buildCmd?, awsRoleArn?, ... }`.
- `yaml` (optional): current workflow YAML.

**Normalized Response**

```json
{
  "success": true,
  "mode": "user" | "pro",
  "data": {
    "reply": "Human-readable explanation / answer",
    "suggestions": [
      { "id": "s1", "title": "Add test step", "description": "..." }
    ],
    "workflow_profile": { /* summary of current workflows */ },
    "generated_yaml": "name: CI ...",
    "yaml_diff": "diff-like or annotated text",
    "tool_called": "pipeline_generator" // or "github_adapter", "rag_query", etc.
  }
}
```
`runWizardAgent` should always produce a `reply` for this path; other fields are optional.

### 4.2 Mode Detection

In `server/routes/agent.js`:

- Still use:

```js
router.post(
  '/wizard/ai',
  requireSession,
  requireCapability(Actions.USE_AGENT),
  async (req, res) => { ... }
);
```
- Inside handler:
  - Inspect `req.user` (populated by `requireSession`).
  - Use `isPro(req.user)` from `authorization.js` to derive `mode: "pro" | "user"`.
  - Call:

```js
const result = await runWizardAgent(
  { ...req.body, cookie: req.headers.cookie },
  { mode, user: req.user }
);
```
- Wrap `result` into the normalized response `{ success, mode, data: result }`.

In `wizardAgent.js`:

- Change signature to:

```js
export async function runWizardAgent(rawInput, opts = {}) {
  const { mode = "user", user, allowPipelineCommit = false } = opts;
  ...
}
```
### 4.3 RAG Gating & Integration

**Gating RAG (Pro-only)**

In `server/routes/rag.js`:

- Import:

```js
import { Actions, requireCapability } from '../lib/authorization.js';
```
- For each route (`/ingest/zip`, `/ingest/github`, `/query`, `/logs`), chain:

```js
router.post('/ingest/github',
  requireSession,
  requireCapability(Actions.USE_AGENT),
  async (req, res, next) => { ... }
);
```
This keeps RAG strictly Pro-only (via `USE_AGENT` capability).

**Copilot RAG Integration (Pro mode)**

Within `wizardAgent.js` (or a helper module):

- Add helpers called only when `mode === "pro"`:

```js
async function ensureRepoIndexed({ user, repoUrl, cookie }) {
  // 1) Derive owner/repo
  // 2) Compute namespace via existing buildNamespace semantics.
  // 3) POST /api/rag/ingest/github with { repoUrl } (from backend, via fetch).
  // 4) Return namespace.
}

async function askRag({ user, repoUrl, question, cookie }) {
  const namespace = await ensureRepoIndexed({ user, repoUrl, cookie });
  // POST /api/rag/query with { namespace, question, topK: 5 }
  // Return { answer, sources }
}
```
- The LLM (via updated system prompt) can decide to call `askRag()` for deep questions:
  - e.g., complex test coverage, multi-service workflow analysis.

RAG remains **per-request** and can be further optimized with caching later.

### 4.4 Read-Only Behavior (No LLM-driven commits)

Current `wizardAgent` tool map includes `pipeline_commit`. For the copilot path:

- Add an option flag: `allowPipelineCommit` (default `false`).
- In the logic where it would choose `toolName === 'pipeline_commit'`:
  - If `!allowPipelineCommit`, return a friendly message:

```js
return {
  success: false,
  tool_called: null,
  message: "I can help you design the workflow, but committing is handled by the UI.",
};
```
- For `/agent/wizard/ai` (copilot), we **never** pass `allowPipelineCommit: true`.
- For any future internal/CLI uses that want auto-PRs, we can opt into `allowPipelineCommit: true` explicitly.

`pipeline_generator` remains allowed; it only returns YAML and metadata.

### 4.5 Prompt Tuning

Update the `systemPrompt` in `wizardAgent.js` to:

- Emphasize:
  - Explain GitHub Actions workflows (what, when, branches).
  - Identify **short, prioritized** lists of improvements (max 3–5).
  - Generate correct GitHub Actions YAML / diffs.
- Clarify modes:
  - In **User** mode: use `github_adapter`, `repo_reader`, `pipeline_generator` only.
  - In **Pro** mode: you **may** call a RAG helper to answer deeper workflow questions.
- Explicitly **forbid** claiming to:
  - Auto-commit or push. Always say “the UI will handle committing”.

### 4.6 Telemetry

In `server/routes/agent.js` around `/wizard/ai`:

- Log (to stdout initially):

```js
console.log("[copilot]", {
  requestId: req.requestId,
  userId: req.user.id,
  mode,
  repoUrl,
  usedRag: !!result.usedRag,
  toolCalled: result.tool_called,
});
```
This is enough for initial debugging; a dedicated DB table can come later.

---

## 5. Frontend Design

### 5.1 Workflow Copilot Panel

In `ConfigurePage.tsx`:

- Rename headings:
  - `"AI YAML wizard"` → `"Workflow Copilot"`.
  - Adjust description to mention:
    - Reads your repo.
    - Explains workflows.
    - Suggests improvements + YAML.
- Add a **mode badge** (above chat):

```tsx
// pseudo-code
const { user } = useAuthStore();
const isPro = user?.plan === "pro" || user?.beta_pro_granted;

<span className="text-xs px-2 py-0.5 rounded-full border">
  {isPro ? "Pro" : "User"}
</span>
```
- Add **one-click chips** (above textarea), e.g.:

```tsx
["Analyze current workflows", "Suggest missing checks", "Propose full CI pipeline"]
  .map(label => (
    <button onClick={() => { setChatInput(label); handleSendChat(); }}>
      {label}
    </button>
  ));
```
### 5.2 Ephemeral State

- Keep `chatMessages`, `chatInput`, `chatLoading` as they are.
- No persistence beyond the page session.
- Optionally, later we can send the last 1–2 user turns to the backend, but v1 can remain single-prompt plus `pipelineSnapshot`.

### 5.3 Handling Normalized Response

In `ConfigurePage.handleSendChat`:

- `const res = await api.askYamlWizard(...);`
- Treat `res` as:

```ts
type CopilotResponse = {
  success: boolean;
  mode?: "user" | "pro";
  data?: {
    reply?: string;
    suggestions?: { id: string; title: string; description: string }[];
    generated_yaml?: string;
    workflow_profile?: any;
    yaml_diff?: string;
    tool_called?: string;
  };
};
```
- For chat message text:

```ts
const replyText =
  res?.data?.reply ||
  res?.data?.message ||
  "I couldn't map that request; try asking about workflows or CI.";
```
- If `data.generated_yaml`:

  - Call `hydrateFromWizard({ repo, generatedYaml, pipelineName })`.
  - Call `setPipelineInfo({ pipelineName, branch, provider, stages: pipelineSnapshot.stages, options })` (stages remain UI-authoritative).

- If `data.suggestions`:

  - Render them as a small list under the latest assistant message.

### 5.4 Guided Next Steps

Add tiny “next step” buttons based on last response:

- Track:

```ts
const [lastAction, setLastAction] = useState<
  "analysis" | "suggestions" | "yaml_generated" | null
>(null);
```
Set it based on presence of `workflow_profile`, `suggestions`, `generated_yaml`.

- For example:
  - After analysis: show “Generate CI YAML from these suggestions” (triggers a follow-up prompt).
  - After YAML generated: show “Open PR with this YAML” which:
    - Reuses your existing deploy / commit flow (`api.startDeploy` or MCP pipeline_commit via dashboard, *not* the agent).

---

## 6. Auth & Data

- Use existing `/api/me` to get:
  - `plan`, `beta_pro_granted`, etc.
- Enforce:
  - `/agent/wizard/ai`: `requireSession` + `requireCapability(Actions.USE_AGENT)` (already).
  - `/api/rag/*`: add `requireCapability(Actions.USE_AGENT)` so Pro-only.
- RAG namespaces stay `userId:repoSlug` via existing `buildNamespace`.

---

## 7. Rollout Phases (Implementation Order)

1. **Backend wiring**
   - `runWizardAgent` options (`mode`, `allowPipelineCommit`).
   - Agent route wrapper sets mode and passes user.
   - RAG router updated with Pro-only gating.
   - Prompt + output normalization (ensure `reply` field).
2. **Frontend integration**
   - Rename to Workflow Copilot, add badge and chips.
   - Update `handleSendChat` to consume normalized response.
   - Wire generated YAML into existing pipeline store.
3. **Refinement**
   - Telemetry and logging.
   - Prompt tuning and small UX tweaks.
   - Optional RAG indexing optimizations.

---

If you want, next step I can:  
- Draft the exact code changes (backend first, then frontend) and apply them in your repo.