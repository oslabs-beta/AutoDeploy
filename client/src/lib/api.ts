// In dev: talk to Vite dev server proxy at /api
// In prod: use the real backend URL from VITE_API_BASE (e.g. https://api.autodeploy.app)
const DEFAULT_API_BASE =
  import.meta.env.MODE === "development" ? "/api" : "";

export const BASE =
  import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;
import { usePipelineStore } from "../store/usePipelineStore";

// SERVER_BASE is the same as BASE but without trailing /api,
// so we can call /mcp and /auth directly.
const SERVER_BASE = BASE.endsWith("/api")
  ? BASE.slice(0, -4)
  : BASE;

// Generic REST helper for /api/* endpoints
async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
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
