import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type RunHistoryItem = {
  id?: string;
  status?: "queued" | "in_progress" | "success" | "failure";
  createdAt?: string;
  commit?: string;
  message?: string;
};

type PipelineState = {
  yaml: string;
  history: RunHistoryItem[];
  status: "" | "Generating…" | "Ready" | "Error";
  lastError?: string;
};

type PipelineActions = {
  setYaml: (y: string) => void;
  setHistory: (h: RunHistoryItem[]) => void;
  prependHistory: (h: RunHistoryItem) => void;
  setStatus: (s: PipelineState["status"]) => void;
  setError: (msg: string) => void;
  reset: () => void;
};

const initial: PipelineState = {
  yaml: "",
  history: [],
  status: "",
  lastError: undefined,
};

export const usePipelineStore = create<PipelineState & PipelineActions>()(
  persist(
    (set) => ({
      ...initial,
      setYaml: (y) => set({ yaml: y }),
      setHistory: (h) => set({ history: h }),
      prependHistory: (h) =>
        set((s) => ({ history: [h, ...s.history] })),
      setStatus: (s) => set({ status: s }),
      setError: (msg) => set({ lastError: msg, status: "Error" }),
      reset: () => set(initial),
    }),
    {
      name: "pipeline-store",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
