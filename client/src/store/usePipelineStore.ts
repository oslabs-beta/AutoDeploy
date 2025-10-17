import { create } from "zustand";
import { api } from "@/lib/api";
import type { McpPipeline } from "@/types/mcp";

type Stage = "build" | "test" | "deploy";

type PipelineState = {
  // inputs to MCP
  template: string;
  stages: Stage[];
  options: {
    nodeVersion: string;
    installCmd: string;
    testCmd: string;
    buildCmd: string;
    awsRoleArn?: string;
  };

  // outputs from MCP
  result?: McpPipeline;

  // local UI state
  roles: string[];                 
  editing: boolean;
  editedYaml?: string;
  status: "idle" | "loading" | "success" | "error";
  error?: string;
};

type PipelineActions = {
  setTemplate(t: string): void;
  toggleStage(s: Stage): void;
  setOption<K extends keyof PipelineState["options"]>(k: K, v: PipelineState["options"][K]): void;

  loadAwsRoles(): Promise<void>;
  regenerate(payload: { repo: string; branch: string }): Promise<void>;
  openPr(args: { repo: string; branch: string }): Promise<void>;

  setEditing(b: boolean): void;
  setEditedYaml(y: string): void;
  resetYaml(): void;
  resetAll(): void;
};

const initial: PipelineState = {
  template: "node_app",
  stages: ["build", "test", "deploy"],
  options: {
    nodeVersion: "20",
    installCmd: "npm ci",
    testCmd: "npm test",
    buildCmd: "npm run build",
  },
  roles: [],
  editing: false,
  status: "idle",
};

export const usePipelineStore = create<PipelineState & PipelineActions>()((set, get) => ({
  ...initial,

  setTemplate: (t) => set({ template: t }),
  toggleStage: (s) => {
    const cur = get().stages;
    set({ stages: cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s] });
  },
  setOption: (k, v) => set({ options: { ...get().options, [k]: v } }),

  async loadAwsRoles() {
    const { roles } = await api.listAwsRoles();
    set({ roles });
    const { options } = get();
    if (!options.awsRoleArn && roles[0]) set({ options: { ...options, awsRoleArn: roles[0] } });
  },

  async regenerate({ repo, branch }) {
    set({ status: "loading", error: undefined });
    try {
      const { template, stages, options } = get();
      const data = await api.createPipeline({
        repo, branch, service: "ci-cd-generator", template,
        options: { ...options, stages },
      });
      set({ result: data, status: "success", editing: false, editedYaml: undefined });
    } catch (e: any) {
      set({ status: "error", error: e.message });
    }
  },

  async openPr({ repo, branch }) {
    const r = get().result;
    const yaml = get().editedYaml ?? r?.generated_yaml;
    const file = r?.pipeline_name || "ci.yml";
    if (!yaml) throw new Error("No YAML to open PR with");
    await api.openPr({
      repo,
      branch,
      path: `.github/workflows/${file}`,
      yaml,
      title: "Add CI pipeline",
    });
  },

  setEditing: (b) => set({ editing: b }),
  setEditedYaml: (y) => set({ editedYaml: y }),
  resetYaml: () => set({ editedYaml: undefined }),
  resetAll: () => set(initial),
}));
