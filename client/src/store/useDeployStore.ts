import { create } from "zustand";
import { api } from "../lib/api";

type JobEvent = { ts: string; level: "info" | "warn" | "error"; msg: string };

type DeployState = {
  running: boolean;
  jobId?: string;
  events: JobEvent[];
  stopStream?: () => void;
};

type DeployActions = {
  startDeploy(args: { repo: string; env: "dev" | "staging" | "prod" }): Promise<void>;
  stop(): void;
  clear(): void;
};

export const useDeployStore = create<DeployState & DeployActions>()((set) => ({
  running: false,
  events: [],
  async startDeploy(payload: {
    repoFullName: string;
    branch?: string;
    env: string;
    yaml?: string;
    provider?: string;
    path?: string;
  }) {
    const { repoFullName, branch = "main", env, yaml, provider = "aws", path = `.github/workflows/${env}-deploy.yml` } = payload || {};
    set({ running: true, events: [] });
    try {
      console.group("[useDeployStore.startDeploy] Prepared payload");
      console.log({ repoFullName, branch, env, provider, path, yamlLength: yaml ? yaml.length : 0 });
      console.groupEnd();
      const { jobId } = await api.startDeploy({ repoFullName, branch, env, yaml, provider, path });
      const stop = api.streamJob(
        jobId,
        (e) => set((s) => ({ events: [...s.events, e] })),
        () => set({ running: false, stopStream: undefined }),
      );
      set({ jobId, stopStream: stop });
    } catch (err) {
      console.error("[useDeployStore.startDeploy] Error:", err);
      set({ running: false });
    }
  },
  stop() {
    set((s) => {
      s.stopStream?.();
      return { running: false, stopStream: undefined };
    });
  },
  clear() {
    set({ running: false, jobId: undefined, events: [], stopStream: undefined });
  },
}));
