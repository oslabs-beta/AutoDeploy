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
        set({ loading: true, error: undefined });
        try {
          const { repos } = await api.listRepos(); // requires session cookie from OAuth
          set({
            repos: repos ?? [],
            connected: true,      // ← we’re authenticated
            loading: false,
          });
        } catch (e: any) {
          // If unauthorized, backend should return 401 and this sets connected false.
          set({
            error: e?.message ?? String(e),
            connected: false,
            loading: false,
            repos: [],
          });
        }
      },

      async loadBranches(repo: string) {
        set({ loading: true, error: undefined, repo, branch: null, branches: [] });
        try {
          const { branches } = await api.listBranches(repo);
          // Optional: preselect a sensible default branch
          const list = branches ?? [];
          const preferred = list.find(b => b === "main") ?? list.find(b => b === "master") ?? null;
          set({
            branches: list,
            branch: preferred,
            loading: false,
          });
        } catch (e: any) {
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
