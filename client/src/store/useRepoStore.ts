import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { api } from "../lib/api";

type RepoState = {
  connected: boolean;
  repo: string | null;
  branch: string | null;
  repos: string[];
  branches: string[];
  loading: boolean;
  error?: string;
};

type RepoActions = {
  setConnected(v: boolean): void;
  setRepo(r: string | null): void;
  setBranch(b: string | null): void;
  loadRepos(): Promise<void>;
  loadBranches(repo: string): Promise<void>;
  reset(): void;
};

const initial: RepoState = {
  connected: false,
  repo: null,
  branch: null,
  repos: [],
  branches: [],
  loading: false,
};

export const useRepoStore = create<RepoState & RepoActions>()(
  persist(
    (set, get) => ({
      ...initial,

      setConnected: (v) => set({ connected: v }),

      // when repo changes, clear branch + branches
      setRepo: (r) => set({ repo: r, branch: null, branches: [] }),

      setBranch: (b) => set({ branch: b }),

      async loadRepos() {
        console.log("[Store] loadRepos() start");
        set({ loading: true, error: undefined });

        try {
          const result = await api.listRepos();
          console.log("[Store] loadRepos() result:", result);

          set({
            repos: result?.repos ?? [],
            connected: true,
            loading: false,
          });

          console.log("[Store] loadRepos() repos saved:", result?.repos);
        } catch (e: any) {
          console.error("[Store] loadRepos() error:", e);
          set({
            error: e?.message ?? String(e),
            connected: false,
            loading: false,
            repos: [],
          });
        }
      },

      async loadBranches(repo: string) {
        console.log("[Store] loadBranches() start for repo:", repo);
        set({ loading: true, error: undefined, repo, branch: null, branches: [] });

        try {
          const result = await api.listBranches(repo);
          console.log("[Store] loadBranches() result:", result);

          const list = result?.branches ?? [];
          const preferred =
            list.find(b => b === "main") ??
            list.find(b => b === "master") ??
            null;

          set({
            branches: list,
            branch: preferred,
            loading: false,
          });

          console.log("[Store] loadBranches() branches saved:", list);
        } catch (e: any) {
          console.error("[Store] loadBranches() error:", e);
          set({
            error: e?.message ?? String(e),
            loading: false,
            branches: [],
            branch: null,
          });
        }
      },

      reset: () => set(initial),
    }),
    {
      name: "repo-store",
      storage: createJSONStorage(() => localStorage),
      // Persist just enough to resume the wizard; you can also persist `branch` if you like
      partialize: (s) => ({ connected: s.connected, repo: s.repo, branch: s.branch }),
    }
  )
);
