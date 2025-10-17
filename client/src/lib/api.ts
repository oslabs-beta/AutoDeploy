const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3333/api";

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data as T;
}

export const api = {
  listRepos: () => request<{ repos: string[] }>("/mcp/repos"),
  listBranches: (repo: string) => request<{ branches: string[] }>(`/mcp/repos/${encodeURIComponent(repo)}/branches`),
  createPipeline: (payload: any) => request("/mcp/pipeline", { method: "POST", body: JSON.stringify(payload) }),
  listAwsRoles: () => request<{ roles: string[] }>("/mcp/oidc/roles"),
  openPr: (payload: any) => request("/mcp/pull-request", { method: "POST", body: JSON.stringify(payload) }),
  getConnections: (repo: string) => request(`/mcp/config/connections?repo=${encodeURIComponent(repo)}`),
  getSecretPresence: (repo: string, env: string) => request(`/mcp/config/secrets?repo=${encodeURIComponent(repo)}&env=${env}`),
  setSecret: (body: any) => request("/mcp/config/secret", { method: "POST", body: JSON.stringify(body) }),
  runPreflight: (body: any) => request("/mcp/config/preflight", { method: "POST", body: JSON.stringify(body) }),
  startDeploy: (body: any) => request("/mcp/deploy/start", { method: "POST", body: JSON.stringify(body) }),
  streamJob(jobId: string, onEvent: (e: any) => void) {
    const es = new EventSource(`${BASE}/mcp/jobs/${jobId}/events`, { withCredentials: true });
    es.onmessage = (evt) => onEvent(JSON.parse(evt.data));
    es.onerror = () => es.close();
    return () => es.close();
  },
};

