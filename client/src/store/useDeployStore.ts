import { create } from "zustand";
import { api } from "@/lib/api";

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
  async startDeploy({ repo, env }) {
    set({ running: true, events: [] });
    const { jobId } = await api.startDeploy({ repo, env });
    const stop = api.streamJob(jobId, (e) =>
      set((s) => ({ events: [...s.events, e] }))
    );
    set({ jobId, stopStream: stop });
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
