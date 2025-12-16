import { create } from "zustand";

type RepoInfo = {
  fullName: string;
  defaultBranch?: string;
  language?: string | null;
  visibility?: "public" | "private";
};

type PipelineInfo = {
  pipelineName?: string;
  branch?: string;
  provider?: string;
  stages?: string[];
};

type WizardContextState = {
  // context
  lastToolCalled?: string;
  repoInfo?: RepoInfo;
  pipelineInfo?: PipelineInfo;

  // setters
  setLastToolCalled: (tool?: string) => void;
  setRepoInfo: (info?: RepoInfo) => void;
  setPipelineInfo: (info?: PipelineInfo) => void;

  // reset (optional but useful)
  resetWizardContext: () => void;
};

export const useWizardStore = create<WizardContextState>((set) => ({
  lastToolCalled: undefined,
  repoInfo: undefined,
  pipelineInfo: undefined,

  setLastToolCalled: (tool) =>
    set(() => ({
      lastToolCalled: tool,
    })),

  setRepoInfo: (info) =>
    set(() => ({
      repoInfo: info,
    })),

  setPipelineInfo: (info) =>
    set(() => ({
      pipelineInfo: info,
    })),

  resetWizardContext: () =>
    set(() => ({
      lastToolCalled: undefined,
      repoInfo: undefined,
      pipelineInfo: undefined,
    })),
}));
