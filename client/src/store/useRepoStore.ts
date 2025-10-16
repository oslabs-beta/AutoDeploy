import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

type RepoState = {
  connected: boolean;
  repo: string;
  repos: string[];
  branches: string[];
};

type RepoActions = {
  setConnected: (v: boolean) => void;
  setRepo: (r: string) => void;
  setRepos: (list: string[]) => void;
  setBranches: (list: string[]) => void;
  reset: () => void;
};

const initial: RepoState = {
  connected: false,
  repo: "",
  repos: [],
  branches: [],
};

export const useRepoStore = create<RepoState & RepoActions>()(
  persist(
    (set) => ({
      ...initial,
      setConnected: (v) => set({ connected: v }),
      setRepo: (r) => set({ repo: r }),
      setRepos: (list) => set({ repos: list }),
      setBranches: (list) => set({ branches: list }),
      reset: () => set(initial),
    }),
    {
      name: "repo-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ connected: s.connected, repo: s.repo }), // keep small
    }
  )
);