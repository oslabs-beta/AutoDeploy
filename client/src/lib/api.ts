import { usePipelineStore } from '../store/usePipelineStore';

// This block of code was commented out from Lorenc. Connecting the GCP backed URL with the frontend

// export const BASE =
//   import.meta.env.VITE_API_BASE ?? 'http://localhost:3000/api';

// // Derive the server base without any trailing "/api" for MCP calls
// const SERVER_BASE = BASE.replace(/\/api$/, '');

// async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
//   const res = await fetch(`${BASE}${path}`, {
//     headers: { 'Content-Type': 'application/json' },
//     credentials: 'include',
//     ...opts,
//   });
//   const data = await res.json().catch(() => ({}));
//   if (!res.ok) throw new Error((data as any)?.error || res.statusText);
//   return data as T;
// }

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  'http://localhost:3000';

function buildUrl(path: string) {
  const base = API_BASE_URL.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

const SERVER_BASE = API_BASE_URL.replace(/\/+$/, '');

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(buildUrl(path), {
    headers: { 'Content-Type': 'application/json' },
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
  const res = await fetch(`${SERVER_BASE}/mcp/v1/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload?.success === false) {
    const msg = payload?.error || res.statusText || 'MCP error';
    throw new Error(msg);
  }
  return payload.data as T;
}

export const api = {
  // ✅ method syntax (preferred)
  async listRepos(): Promise<{ repos: string[] }> {
    const outer = await mcp<{
      success: boolean;
      data: {
        provider: string;
        user: string;
        repositories: { full_name: string }[];
      };
    }>('repo_reader', {});

    const inner = outer?.data;
    const repos = inner?.repositories?.map((r) => r.full_name) ?? [];
    return { repos };
  },

  async listBranches(repo: string): Promise<{ branches: string[] }> {
    const outer = await mcp<{
      success: boolean;
      data: {
        provider: string;
        user: string;
        repositories: { full_name: string; branches?: string[] }[];
      };
    }>('repo_reader', {});

    const inner = outer?.data;
    const match = inner?.repositories?.find((r) => r.full_name === repo);
    return { branches: match?.branches ?? [] };
  },

  async createPipeline(payload: any) {
    const { repo, branch, template = 'node_app', options } = payload || {};
    const data = await mcp('pipeline_generator', {
      repo,
      branch,
      provider: 'aws',
      template,
      options: options || {},
    });
    return data;
  },

  async listAwsRoles(): Promise<{ roles: string[] }> {
    const data = await mcp<{ roles?: { name: string; arn: string }[] }>(
      'oidc_adapter',
      { provider: 'aws' }
    );
    return { roles: (data.roles ?? []).map((r) => r.arn) };
  },

  async openPr(_payload: any) {
    throw new Error('openPr is not implemented on the server (no MCP tool)');
  },

  // ... keep the rest of your existing methods like getConnections, getSecretPresence, etc.

  // --- Mocked config/secrets endpoints for Secrets/Preflight flow ---
  async getConnections(_repo: string): Promise<{
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
    } catch {}
    return {
      githubAppInstalled: true,
      githubRepoWriteOk: true,
      awsOidc: {
        connected: !!roleArn,
        roleArn,
        accountId: '123456789012',
        region: 'us-east-1',
      },
    };
  },

  async getSecretPresence(
    repo: string,
    env: string
  ): Promise<{ key: string; present: boolean }[]> {
    const required = ['GITHUB_TOKEN', 'AWS_ROLE_ARN'];
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
    const region = aws?.region || connections.awsOidc.region || 'us-east-1';
    const s = Object.fromEntries(
      secrets.map((x) => [x.key, x.present] as const)
    );

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
      pipelineStore?.result?.repo;
    const selectedBranch = branch || pipelineStore?.selectedBranch || 'main';
    const yaml = pipelineStore?.result?.generated_yaml;
    const environment = env || pipelineStore?.environment || 'dev';

    const providerFinal = provider || pipelineStore?.provider || 'aws';
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
    onEvent: (e: { ts: string; level: 'info'; msg: string }) => void
  ) {
    const steps = [
      'Connecting to GitHub...',
      'Committing workflow file...',
      'Verifying commit...',
      'Done ✅',
    ];
    let i = 0;
    const timer = setInterval(() => {
      if (i >= steps.length) return;
      onEvent({ ts: new Date().toISOString(), level: 'info', msg: steps[i++] });
      if (i >= steps.length) clearInterval(timer);
    }, 600);
    return () => clearInterval(timer);
  },
};

// This block of code was commented from Lorenc

// Helper to start GitHub OAuth (server redirects back after callback)
// export function startGitHubOAuth(redirectTo: string = window.location.origin) {
//   // Our server mounts OAuth at /auth/github/start and expects `redirect_to`
//   const serverBase = BASE.replace(/\/api$/, '');
//   const url = `${serverBase}/auth/github/start?redirect_to=${encodeURIComponent(
//     redirectTo
//   )}`;
//   window.location.href = url;
// }

export function startGitHubOAuth(redirectTo: string = window.location.origin) {
  const serverBase = SERVER_BASE;
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
