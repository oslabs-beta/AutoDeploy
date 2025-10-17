import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { api } from "../lib/api";

//typescript friendly typing here for properties and functions we want our data to have
type RepoState = {
  connected: boolean;
  repo: string | null;
  branch: string | null;
  repos: string[] | null;
  branches: string[] | null;
};

type RepoActions = {
  setConnected(v: boolean): void;
  setRepo(r: string | null): void;
  setBranch(b: string | null): void;
  loadRepos(): Promise<void>;
  loadBranches(repo: string): Promise<void>;
  reset(): void;
};

//setting our initial state defaults

const initial: RepoState = {
  connected: false,
  repo: null,
  branch: null, 
  repos: [],
  branches: [],
};

//actually creates useRepoStore, a persistent global store with the properties of RepoState 
//and the functionalities of RepoActions

export const useRepoStore = create<RepoState & RepoActions>()(
  persist(
    (set, get) => ({
      ...initial,
      setConnected: (v) => set({ connected: v }),
      setRepo: (r) => set({ repo: r, branch: null, branches: [] }),
      setBranch: (b) => set({ branch: b }),
      async loadRepos() {
        const { repos } = await api.listRepos();
        set({ repos });
      },
      async loadBranches(repo) {
        const { branches } = await api.listBranches(repo);
        set({ branches });
      },
      reset: () => set(initial),
    }),
    {
      name: "repo-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ connected: s.connected, repo: s.repo, branch: s.branch }),
    }
  )
);