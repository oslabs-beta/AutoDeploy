import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Derive the same server base as api.ts
const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000/api";
const SERVER_BASE = BASE.replace(/\/api$/, "");

type PipelineState = {
  repo: string;
  branch: string;
  yaml: string;           
  status: "idle" | "loading" | "success" | "error";
};

type PipelineActions = {
  setRepo: (repo: string) => void;
  setBranch: (branch: string) => void;
  setYaml: (yaml: string) => void;
  setStatus: (s: PipelineState["status"]) => void;
  reset: () => void;
  generateAndStorePipeline: (payload: {
    repo: string;
    branch: string;
    awsRole?: string;
  }) => Promise<void>;
};

const initial: PipelineState = {
  repo: "",
  branch: "",
  yaml: "",
  status: "idle",
};

export const usePipelineStore = create<PipelineState & PipelineActions>()(
  persist(
    (set, get) => ({
      ...initial,
      setRepo: (repo) => set({ repo }),
      setBranch: (branch) => set({ branch }),
      setYaml: (yaml) => set({ yaml }),
      setStatus: (status) => set({ status }),
      reset: () => set(initial),

      
      async generateAndStorePipeline({ repo, branch, awsRole }) {
        set({ status: "loading", repo, branch });
        try {
          const res = await fetch(`${SERVER_BASE}/mcp/v1/pipeline_commit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ repo, branch, awsRole }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || res.statusText);

         
          set({
            yaml: data.yaml ?? "",
            branch: data.branch ?? branch,
            status: "success",
          });
        } catch (e) {
          console.error("[generateAndStorePipeline]", e);
          set({ status: "error" });
          throw e; // let caller toast
        }
      },
    }),
    {
      name: "pipeline-store",
      storage: createJSONStorage(() => localStorage),
      // Persist only what you need on the final page
      partialize: (s) => ({ repo: s.repo, yaml: s.yaml }),
    }
  )
);
