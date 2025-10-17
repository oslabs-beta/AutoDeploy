import { create } from "zustand";
import { api } from "../lib/api";

type EnvName = "dev" | "staging" | "prod";
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
  status: "idle" | "loading" | "saving" | "error";
  error?: string;
  preflightResults?: { label: string; ok: boolean; info?: string }[];
};

type ConfigActions = {
  setEnv(e: EnvName): void;
  load(repo: string): Promise<void>;
  addOrUpdateSecret(repo: string, key: string, value: string): Promise<void>;
  runPreflight(repo: string): Promise<void>;
  setAws(patch: Partial<ConfigState["aws"]>): void;
  reset(): void;
};

const initial: ConfigState = {
  env: "dev",
  secrets: [],
  aws: {},
  status: "idle",
};

export const useConfigStore = create<ConfigState & ConfigActions>()((set, get) => ({
  ...initial,
  setEnv: (env) => set({ env }),
  async load(repo) {
    set({ status: "loading", error: undefined });
    try {
      const [connections, presence] = await Promise.all([
        api.getConnections(repo),
        api.getSecretPresence(repo, get().env),
      ]);
      set({ connections, secrets: presence, status: "idle" });
      // pick AWS role if provided by connections
      if (connections.awsOidc?.roleArn) {
        set({ aws: { ...get().aws, roleArn: connections.awsOidc.roleArn } });
      }
    } catch (e: any) {
      set({ status: "error", error: e.message });
    }
  },
  async addOrUpdateSecret(repo, key, value) {
    set({ status: "saving" });
    await api.setSecret({ repo, env: get().env, key, value });
    const presence = await api.getSecretPresence(repo, get().env);
    set({ secrets: presence, status: "idle" });
  },
  async runPreflight(repo) {
    const data = await api.runPreflight({
      repo,
      env: get().env,
      aws: get().aws,
    });
    set({ preflightResults: data.results });
  },
  setAws: (patch) => set({ aws: { ...get().aws, ...patch } }),
  reset: () => set(initial),
}));
