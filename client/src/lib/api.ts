import { usePipelineStore } from '../store/usePipelineStore';

// In dev: talk to Vite dev server proxy at /api
// In prod: use the real backend URL from VITE_API_BASE (e.g. https://api.autodeploy.app)
const DEFAULT_API_BASE = import.meta.env.MODE === 'development' ? '/api' : '';

export const BASE = import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;

// SERVER_BASE is the same as BASE but without trailing /api,
// so we can call /mcp and /auth directly.
const SERVER_BASE = BASE.endsWith('/api') ? BASE.slice(0, -4) : BASE;

// Generic REST helper for /api/* endpoints
async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'include',
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || (payload as any)?.success === false) {
    const msg = (payload as any)?.error || res.statusText || 'MCP error';
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
  me: () => request<{ userId: string; email?: string }>('/api/me'),

  // ===== Pipeline history + rollback =====

  async getPipelineHistory(params: {
    repoFullName: string;
    branch?: string;
    path?: string;
    limit?: number;
  }): Promise<PipelineVersion[]> {
    const { repoFullName, branch, path, limit } = params;

    const qs = new URLSearchParams();
    qs.set('repoFullName', repoFullName);
    if (branch) qs.set('branch', branch);
    if (path) qs.set('path', path);
    if (limit) qs.set('limit', String(limit));

    const res = await fetch(
      `${SERVER_BASE}/mcp/v1/pipeline_history?${qs.toString()}`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );

    const payload = await res.json().catch(() => ({} as any));
    if (!res.ok || !payload.ok) {
      throw new Error(payload.error || res.statusText || 'History failed');
    }

    // Back-end shape: { ok: true, data: { versions: { rows: [...] } } }
    const pgResult = (payload.data?.versions ?? payload.versions ?? {}) as any;
    const rows = (pgResult.rows ?? []) as PipelineVersion[];
    return rows;
  },

  async rollbackPipeline(versionId: string): Promise<any> {
    const res = await fetch(`${SERVER_BASE}/mcp/v1/pipeline_rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ versionId }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.ok) {
      throw new Error(payload.error || res.statusText || 'Rollback failed');
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
        'oidc_adapter',
        { provider: 'aws' }
      );

      const roles = (data.roles ?? []).map((r) => r.arn);
      cachedAwsRoles = roles;
      return { roles };
    } catch (err) {
      console.error('[api.listAwsRoles] failed:', err);
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
    message?: string; // frontend name
    yaml?: string;
  }) => {
    const payload = {
      ...input,
      prompt: input.message ?? '', // 👈 REQUIRED BY BACKEND
    };

    delete (payload as any).message; // 👈 prevent backend confusion

    const res = await fetch(`${SERVER_BASE}/agent/wizard/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.success === false) {
      throw new Error(data?.error || res.statusText || 'Agent error');
    }

    return data.data;
  },

  // ===== MCP helpers for repos / branches / pipeline generation =====
  async listRepos(): Promise<{ repos: string[] }> {
    // If we already have repos cached, reuse them.
    if (cachedRepos && cachedRepos.length > 0) return { repos: cachedRepos };

    try {
      const outer = await mcp<{
        success?: boolean;
        data?: { repositories: { full_name: string; branches?: string[] }[] };
        repositories?: { full_name: string; branches?: string[] }[];
      }>("repo_reader", {});

      const body = (outer as any)?.data ?? outer; // unwrap tool payload
      const repoObjs: any[] = body?.repositories ?? [];

      // Prime the per-repo branch cache from this bulk response so that
      // selecting a repo does NOT need to call repo_reader again.
      for (const r of repoObjs) {
        if (r?.full_name && Array.isArray(r.branches)) {
          cachedBranches.set(r.full_name, r.branches);
        }
      }

      const repos = repoObjs.map((r: any) => r.full_name).filter(Boolean);
      cachedRepos = repos;
      return { repos };
    } catch (err) {
      console.error('[api.listRepos] failed:', err);
      // allow retry on next call if this failed
      cachedRepos = null;
      return { repos: [] };
    }
  },

  async listBranches(repo: string): Promise<{ branches: string[] }> {
    // Use cached branches if we *know* the value, even if it's an empty array.
    // Map.get returns undefined when missing, so this distinguishes "no cache"
    // from "cached but empty".
    const cached = cachedBranches.get(repo);
    if (cached !== undefined) return { branches: cached };

    try {
      const outer = await mcp<{
        success?: boolean;
        data?: { repositories: { full_name: string; branches?: string[] }[] };
        repositories?: { full_name: string; branches?: string[] }[];
      }>('repo_reader', { repoFullName: repo });

      const body = (outer as any)?.data ?? outer;
      const match = body?.repositories?.find((r: any) => r.full_name === repo);
      const branches = match?.branches ?? [];
      cachedBranches.set(repo, branches);
      return { branches };
    } catch (err) {
      console.error("[api.listBranches] failed:", err);
      const fallback = cachedBranches.get(repo) ?? [];
      return { branches: fallback };
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
      template = 'node_app',
      provider = 'aws',
      options,
    } = payload || {};

    // For GCP Cloud Run we use the dedicated adapter which returns a workflow YAML.
    // IMPORTANT: omit empty-string values so gcp_adapter can fall back to its
    // `${{ secrets.* }}` defaults.
    if (provider === 'gcp') {
      const o = options || {};
      const gcpInput: Record<string, any> = {
        repo,
        branch,
        ...(Array.isArray(o.stages) ? { stages: o.stages } : {}),

        ...(o.gcpProjectId ? { gcp_project_id: o.gcpProjectId } : {}),
        ...(o.gcpRegion ? { gcp_region: o.gcpRegion } : {}),
        ...(o.gcpWorkloadIdentityProvider
          ? { workload_identity_provider: o.gcpWorkloadIdentityProvider }
          : {}),
        ...(o.gcpServiceAccountEmail
          ? { service_account_email: o.gcpServiceAccountEmail }
          : {}),

        ...(o.gcpBackendService ? { backend_service: o.gcpBackendService } : {}),
        ...(o.gcpFrontendService
          ? { frontend_service: o.gcpFrontendService }
          : {}),

        ...(o.gcpBackendArRepo ? { backend_ar_repo: o.gcpBackendArRepo } : {}),
        ...(o.gcpFrontendArRepo
          ? { frontend_ar_repo: o.gcpFrontendArRepo }
          : {}),

        ...(o.gcpBackendImageName
          ? { backend_image_name: o.gcpBackendImageName }
          : {}),
        ...(o.gcpFrontendImageName
          ? { frontend_image_name: o.gcpFrontendImageName }
          : {}),

        ...(o.gcpBackendContext ? { backend_context: o.gcpBackendContext } : {}),
        ...(o.gcpBackendDockerfile
          ? { backend_dockerfile: o.gcpBackendDockerfile }
          : {}),

        ...(o.gcpFrontendContext
          ? { frontend_context: o.gcpFrontendContext }
          : {}),
        ...(o.gcpFrontendDockerfile
          ? { frontend_dockerfile: o.gcpFrontendDockerfile }
          : {}),

        ...(typeof o.gcpBackendPort === 'number'
          ? { backend_port: o.gcpBackendPort }
          : {}),
        ...(typeof o.gcpFrontendPort === 'number'
          ? { frontend_port: o.gcpFrontendPort }
          : {}),

        ...(typeof o.gcpGenerateDockerfiles === 'boolean'
          ? { generate_dockerfiles: o.gcpGenerateDockerfiles }
          : {}),
      };

      return await mcp('gcp_adapter', gcpInput);
    }

    const data = await mcp('pipeline_generator', {
      repo,
      branch,
      provider,
      template,
      options: options || {},
    });
    return data;
  },

  // ===== GitHub Actions workflows (MCP-backed) =====

  async listWorkflows(repo: string): Promise<{
    name: string;
    path: string;
    state: string;
  }[]> {
    try {
      const outer = await mcp<{
        workflows?: { name: string; path: string; state: string }[];
      }>("github_adapter", { action: "workflows", repo });

      const body = (outer as any)?.data ?? outer;
      return (body?.workflows ?? []) as {
        name: string;
        path: string;
        state: string;
      }[];
    } catch (err) {
      console.error("[api.listWorkflows] failed:", err);
      return [];
    }
  },

  async getWorkflowFile(repo: string, path: string): Promise<string | null> {
    try {
      const outer = await mcp<{
        file?: { content?: string };
      }>("github_adapter", { action: "file", repo, path });

      const body = (outer as any)?.data ?? outer;
      const content = body?.file?.content;
      return typeof content === "string" && content.trim().length > 0
        ? content
        : null;
    } catch (err) {
      console.error("[api.getWorkflowFile] failed:", err);
      return null;
    }
  },
  // Added by Lorenc
  /**
   * Call backend /mcp/v1/scaffold/commit (scaffoldCommitRouter)
   * to generate + commit Dockerfiles and .dockerignore files
   * into the selected GitHub repo.
   */
  async scaffoldRepoFiles(params: {
    repoFullName?: string;
    repoUrl?: string;
    branch?: string;
    backendPath?: string;
    frontendPath?: string;
  }): Promise<{
    ok: boolean;
    repo: string;
    branch: string;
    committed: { path: string; commitSha: string | null }[];
  }> {
    const { repoFullName, repoUrl, branch, backendPath, frontendPath } = params;

    const body: Record<string, any> = {
      repoFullName,
      repoUrl,
      branch: branch || "main",
      // Let the backend defaults apply if these are undefined
      ...(backendPath ? { backendPath } : {}),
      ...(frontendPath ? { frontendPath } : {}),
    };

    const res = await fetch(`${SERVER_BASE}/mcp/v1/scaffold/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || res.statusText || "Scaffold commit failed");
    }
    return data;
  },

  /**
   * Check if the selected repo already has Dockerfiles (backend/, frontend/, or root).
   * Used to disable the Dockerfile scaffolding button.
   */
  async repoHasDockerfiles(repoFullName: string): Promise<boolean> {
    const fetchContents = async (path?: string): Promise<
      { name: string; path: string; type: string }[]
    > => {
      const qs = new URLSearchParams();
      qs.set("action", "contents");
      qs.set("repo", repoFullName);
      if (path) qs.set("path", path);

      const res = await fetch(`${SERVER_BASE}/mcp/v1/github?${qs.toString()}`, {
        method: "GET",
        credentials: "include",
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.error || res.statusText || "GitHub contents failed");
      }

      const data = payload.data || payload;
      return (data?.contents ?? []) as { name: string; path: string; type: string }[];
    };

    const checkDir = async (path?: string): Promise<boolean> => {
      try {
        const contents = await fetchContents(path);
        const found = contents.some((c) => c?.name === "Dockerfile");
        if (found) {
          console.log("[api.repoHasDockerfiles] Found Dockerfile in", {
            repoFullName,
            path,
          });
        }
        return found;
      } catch (e) {
        console.error("[api.repoHasDockerfiles] failed", { repoFullName, path, e });
        return false;
      }
    };

    // Common layouts: backend/frontend, server/client, plus repo root
    const [backend, frontend, serverDir, clientDir, root] = await Promise.all([
      checkDir("backend"),
      checkDir("frontend"),
      checkDir("server"),
      checkDir("client"),
      checkDir(undefined),
    ]);

    return backend || frontend || serverDir || clientDir || root;
  },

  // ===== OIDC roles (AWS) with caching =====

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
    throw new Error('openPr is not implemented on the server (no MCP tool)');
  },

  // --- Config/secrets endpoints for Secrets/Preflight flow ---
  async getConnections(
    repo: string
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
    // 1) GitHub connection + repo write status from backend
    let githubAppInstalled = false;
    let githubRepoWriteOk = false;
    try {
      const url = `${SERVER_BASE}/api/connections?repoFullName=${encodeURIComponent(
        repo
      )}`;
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
      });
      const base = (await res.json().catch(() => ({}))) as {
        githubAppInstalled?: boolean;
        githubRepoWriteOk?: boolean;
      };
      if (res.ok) {
        githubAppInstalled = !!base.githubAppInstalled;
        githubRepoWriteOk = !!base.githubRepoWriteOk;
      } else {
        console.warn('[api.getConnections] /api/connections non-200:', base);
      }
    } catch (e) {
      console.warn('[api.getConnections] /api/connections failed:', e);
    }

    // 2) AWS OIDC status derived from roles via MCP
    let roleArn: string | undefined;
    let region: string | undefined;
    try {
      const { roles } = await this.listAwsRoles();
      roleArn = roles[0];
      region = 'us-east-1';
    } catch (e) {
      console.warn('[api.getConnections] Failed to load roles:', e);
    }

    return {
      githubAppInstalled,
      githubRepoWriteOk,
      awsOidc: {
        connected: !!roleArn,
        roleArn,
        accountId: '123456789012',
        region,
      },
    };
  },

  async getSecretPresence(
    repo: string,
    env: string
  ): Promise<{ key: string; present: boolean }[]> {
    const res = await fetch(`${SERVER_BASE}/api/secrets/github/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ repoFullName: repo, env }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as any)?.error || res.statusText);
    }
    const secrets = (data as any)?.secrets ?? [];
    return secrets as { key: string; present: boolean }[];
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
  }): Promise<{ ok: boolean; scope?: string; envFallback?: boolean; env?: string | null }> {
    const res = await fetch(`${SERVER_BASE}/api/secrets/github/upsert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ repoFullName: repo, env, key, value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data as any)?.error || res.statusText);
    }
    return (data as any) ?? { ok: true };
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

    const s = Object.fromEntries(secrets.map((x) => [x.key, x.present] as const));

    const results = [
      { label: 'GitHub App installed', ok: hasGithubApp },
      { label: 'Repo write access', ok: hasRepoWrite },
      { label: 'AWS OIDC configured', ok: hasAws, info: role },
      { label: 'Secret: GITHUB_TOKEN', ok: !!s.GITHUB_TOKEN },
      { label: 'Secret: AWS_ROLE_ARN', ok: !!s.AWS_ROLE_ARN, info: role },
      { label: 'AWS Region selected', ok: !!region, info: region },
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
    const selectedBranch =
      branch || (pipelineStore as any)?.selectedBranch || 'main';
    const yaml =
      fromCallerYaml || (pipelineStore as any)?.result?.generated_yaml || '';

    const environment = env || (pipelineStore as any)?.environment || 'dev';

    const providerFinal = provider || (pipelineStore as any)?.provider || 'aws';
    const pathFinal = path || `.github/workflows/${environment}-deploy.yml`;

    console.group('[Deploy Debug]');
    console.log('repoFullName:', repoFullName);
    console.log('selectedBranch:', selectedBranch);
    console.log('environment:', environment);
    console.log('provider:', providerFinal);
    console.log('path:', pathFinal);
    console.log('YAML length:', yaml ? yaml.length : 0);
    console.groupEnd();

    const payload = {
      repoFullName,
      branch: selectedBranch,
      env: environment,
      yaml,
      provider: providerFinal,
      path: pathFinal,
    };

    console.log('[Deploy] Final payload:', payload);
    if (!repoFullName) throw new Error('startDeploy: missing repoFullName');
    if (!selectedBranch) throw new Error('startDeploy: missing branch');
    if (!yaml || yaml.trim().length === 0)
      throw new Error('startDeploy: missing yaml');

    const res = await fetch(`${SERVER_BASE}/mcp/v1/pipeline_commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    console.group('[Deploy Response]');
    console.log('Status:', res.status);
    console.log('Data:', data);
    console.groupEnd();

    if (!res.ok) throw new Error(`Pipeline commit failed: ${res.statusText}`);
    return data;
  },

  streamJob(
    _jobId: string,
    onEvent: (e: { ts: string; level: 'info'; msg: string }) => void,
    onDone?: () => void
  ) {
    const steps = [
      'Connecting to GitHub...',
      'Committing workflow file...',
      'Verifying commit...',
      'Done ✅',
    ];
    let i = 0;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (onDone) onDone();
    };

    const timer = setInterval(() => {
      if (i >= steps.length) {
        clearInterval(timer);
        finish();
        return;
      }
      onEvent({
        ts: new Date().toISOString(),
        level: 'info',
        msg: steps[i++],
      });
      if (i >= steps.length) {
        clearInterval(timer);
        finish();
      }
    }, 600);

    return () => {
      clearInterval(timer);
      finish();
    };
  },
};

// Helper to start GitHub OAuth (server redirects back after callback)
export function startGitHubOAuth(redirectTo: string = window.location.origin) {
  const serverBase = BASE.replace(/\/api$/, '');
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
