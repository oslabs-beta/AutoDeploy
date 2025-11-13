import { create } from "zustand";
import { api } from "../lib/api";
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
  repoFullName?: string;

  // local UI state
  roles: { name: string; arn: string }[];                 
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
    try {
      const res = await api.listAwsRoles();

      // Normalize both fetch-style and axios-style responses
      const payload = res?.data ?? res; // if axios -> res.data, if fetch -> res
      // Roles can live at payload.data.roles or payload.roles depending on server/helper
      const roles =
        payload?.data?.roles ??
        payload?.roles ??
        payload?.data?.data?.roles ??
        [];

      console.log("[usePipelineStore] Raw roles payload:", payload);
      console.log("[usePipelineStore] Loaded roles (final):", roles);

      // Normalize to objects even if backend returned strings
      const normalizedRoles = roles.map((r: any) =>
        typeof r === "string" ? { name: r.split("/").pop(), arn: r } : r
      );

      set({ roles: normalizedRoles });

      const { options } = get();
      if (!options.awsRoleArn && normalizedRoles[0]) {
        set({ options: { ...options, awsRoleArn: normalizedRoles[0].arn } });
      }
    } catch (err) {
      console.error("[usePipelineStore] Failed to load AWS roles:", err);
      set({ roles: [] });
    }
  },

  async regenerate({ repo, branch }) {
    set({ status: "loading", error: undefined });
    try {
      const { template, stages, options } = get();
      const res = await api.createPipeline({
        repo,
        branch,
        service: "ci-cd-generator",
        template,
        options: { ...options, stages },
      });

      const generated_yaml =
        res?.data?.data?.generated_yaml ||
        res?.data?.generated_yaml ||
        res?.generated_yaml ||
        "";

      const repoFullName =
        res?.data?.data?.repo ||
        res?.data?.repo ||
        "";

      console.log("[usePipelineStore] Captured repoFullName:", repoFullName);

      set({
        result: { ...res, yaml: generated_yaml, generated_yaml },
        repoFullName,
        status: "success",
        editing: false,
        editedYaml: undefined,
      });

      console.log("[usePipelineStore] YAML generated:", generated_yaml.slice(0, 80));
    } catch (e: any) {
      console.error("[usePipelineStore] regenerate error:", e);
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
