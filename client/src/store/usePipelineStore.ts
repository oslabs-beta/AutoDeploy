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
    awsSessionName?: string;
    awsRegion?: string;
    gcpServiceAccountEmail?: string;
  };
  provider: "aws" | "gcp" | "jenkins";

  // outputs from MCP
  result?: McpPipeline;
  repoFullName?: string;

  // local UI state
  roles: { name: string; arn: string }[];
  editing: boolean;
  editedYaml?: string;
  status: "idle" | "loading" | "success" | "error";
  error?: string;

  // Have we already loaded roles this session?
  rolesLoaded: boolean;

  // Derived getter to surface the currently effective YAML
  getEffectiveYaml: () => string | undefined;
};

type PipelineActions = {
  setTemplate(t: string): void;
  setProvider(p: PipelineState["provider"]): void;
  toggleStage(s: Stage): void;
  setOption<K extends keyof PipelineState["options"]>(
    k: K,
    v: PipelineState["options"][K]
  ): void;

  loadAwsRoles(): Promise<void>;
  regenerate(payload: { repo: string; branch: string }): Promise<void>;
  openPr(args: { repo: string; branch: string }): Promise<void>;

  setEditing(b: boolean): void;
  setEditedYaml(y: string): void;
  resetYaml(): void;
  resetAll(): void;

  hydrateFromWizard(payload: {
    repo: string;
    generatedYaml: string;
    pipelineName?: string;
  }): void;

  // Allow updating the stored YAML after manual edits (Dashboard)
  setResultYaml(yaml: string): void;
};

const TEMPLATE_DEFAULT_OPTIONS: Record<string, PipelineState["options"]> = {
  node_app: {
    nodeVersion: "20",
    installCmd: "npm ci",
    testCmd: "npm test",
    buildCmd: "npm run build",
    awsSessionName: "autodeploy",
    awsRegion: "us-east-1",
    gcpServiceAccountEmail: "",
  },
  python_app: {
    nodeVersion: "",
    installCmd: "pip install -r requirements.txt",
    testCmd: "pytest",
    buildCmd: "",
    awsSessionName: "autodeploy",
    awsRegion: "us-east-1",
    gcpServiceAccountEmail: "",
  },
  container_service: {
    nodeVersion: "",
    installCmd: "",
    testCmd: "",
    buildCmd: "",
    awsSessionName: "autodeploy",
    awsRegion: "us-east-1",
    gcpServiceAccountEmail: "",
  },
};

const initial: PipelineState = {
  template: "node_app",
  stages: ["build", "test", "deploy"],
  options: {
    nodeVersion: "20",
    installCmd: "npm ci",
    testCmd: "npm test",
    buildCmd: "npm run build",
    awsSessionName: "autodeploy",
    awsRegion: "us-east-1",
    gcpServiceAccountEmail: "",
  },
  provider: "aws",
  roles: [],
  editing: false,
  status: "idle",
  error: undefined,
  rolesLoaded: false, // guards MCP calls
  getEffectiveYaml: () => undefined,
};

export const usePipelineStore = create<PipelineState & PipelineActions>()(
  (set, get) => ({
    ...initial,

    setTemplate: (t) => {
      const current = get();
      const preservedProviderFields = {
        awsRoleArn: current.options.awsRoleArn,
        awsSessionName: current.options.awsSessionName,
        awsRegion: current.options.awsRegion,
        gcpServiceAccountEmail: current.options.gcpServiceAccountEmail,
      };

      const nextDefaults = TEMPLATE_DEFAULT_OPTIONS[t] ?? TEMPLATE_DEFAULT_OPTIONS["node_app"];

      set({
        template: t,
        options: {
          ...nextDefaults,
          ...preservedProviderFields,
        },
      });
    },
    setProvider: (p) => set({ provider: p }),
    // setProvider: (p) => set({ provider: p }),

    toggleStage: (s) => {
      const cur = get().stages;
      set({
        stages: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
      });
    },

    setOption: (k, v) =>
      set({
        options: {
          ...get().options,
          [k]: v,
        },
      }),

    // ============================
    //   AWS ROLES LOADER (GUARDED)
    // ============================
    async loadAwsRoles() {
      const { rolesLoaded } = get();

      // hard guard: if we already loaded roles successfully once,
      // never hit the backend again this session.
      if (rolesLoaded) {
        console.log(
          "[usePipelineStore] Skipping loadAwsRoles - roles already loaded"
        );
        return;
      }

      console.log("[usePipelineStore] Fetching AWS roles from MCP…");

      try {
        const res = await api.listAwsRoles();

        // `api.listAwsRoles` already normalizes most shapes; treat it as `{ roles: string[] }`
        const rawRoles = (res as any)?.roles ?? [];

        console.log(
          "[usePipelineStore] Raw roles from api.listAwsRoles:",
          rawRoles
        );

        const normalizedRoles = (rawRoles as any[]).map((r: any) =>
          typeof r === "string"
            ? { name: r.split("/").pop() ?? r, arn: r }
            : r
        );

        set({
          roles: normalizedRoles,
          rolesLoaded: true, //  this is what stops future calls
        });

        const { options } = get();
        if (!options.awsRoleArn && normalizedRoles[0]) {
          set({
            options: { ...options, awsRoleArn: normalizedRoles[0].arn },
          });
        }

        console.log(
          "[usePipelineStore] Loaded roles (normalized):",
          normalizedRoles
        );
      } catch (err) {
        console.error("[usePipelineStore] Failed to load AWS roles:", err);
        // allow retry later if needed
        set({ roles: [], rolesLoaded: false });
      }
    },

    // ============================
    //    PIPELINE GENERATION
    // ============================
    async regenerate({ repo, branch }) {
      set({ status: "loading", error: undefined });
      try {
        const { template, stages, options, provider } = get();
        const res = await api.createPipeline({
          repo,
          branch,
          service: "ci-cd-generator",
          template,
          provider,
          options: { ...options, stages },
        });

        const generated_yaml =
          (res as any)?.data?.data?.generated_yaml ||
          (res as any)?.data?.generated_yaml ||
          (res as any)?.generated_yaml ||
          "";

        const repoFullName =
          (res as any)?.data?.data?.repo || (res as any)?.data?.repo || "";

        console.log(
          "[usePipelineStore] Captured repoFullName:",
          repoFullName
        );

        set({
          result: { ...(res as any), yaml: generated_yaml, generated_yaml },
          repoFullName,
          status: "success",
          editing: false,
          editedYaml: undefined,
        });

        console.log(
          "[usePipelineStore] YAML generated:",
          generated_yaml.slice(0, 80)
        );
      } catch (e: any) {
        console.error("[usePipelineStore] regenerate error:", e);
        set({ status: "error", error: e.message });
      }
    },

    async openPr({ repo, branch }) {
      const r = get().result;
      const yaml = get().editedYaml ?? r?.generated_yaml;
      const file = (r as any)?.pipeline_name || "ci.yml";

      if (!yaml) throw new Error("No YAML to open PR with");

      await api.openPr({
        repo,
        branch,
        path: `.github/workflows/${file}`,
        yaml,
        title: "Add CI pipeline",
      });
    },

    hydrateFromWizard({ repo, generatedYaml, pipelineName }) {
      set({
        result: {
          ...(get().result ?? {}),
          generated_yaml: generatedYaml,
          yaml: generatedYaml,
          pipeline_name: pipelineName ?? "ci.yml",
        },
        repoFullName: repo,
        status: "success",
        editing: false,
        editedYaml: undefined,
      });

      console.log(
        "[usePipelineStore] Hydrated YAML from wizard:",
        generatedYaml.slice(0, 80)
      );
    },

    setResultYaml(yaml: string) {
      const r = get().result ?? {};
      set({
        result: {
          ...r,
          generated_yaml: yaml,
          yaml,
        },
      });
    },

    setEditing: (b) => set({ editing: b }),
    setEditedYaml: (y) => set({ editedYaml: y }),
    resetYaml: () => set({ editedYaml: undefined }),

    // Derived getter used by ConfigurePage
    getEffectiveYaml: () => {
      const { editedYaml, result } = get();
      return editedYaml ?? result?.generated_yaml ?? result?.yaml;
    },

    resetAll: () => set(initial),
  })
);
