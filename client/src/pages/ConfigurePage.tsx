import { useEffect, useState } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { usePipelineStore } from "../store/usePipelineStore";
import { useWizardStore } from "../store/useWizardStore";
import { api } from "../lib/api";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function ConfigurePage() {
  const { repo, branch } = useRepoStore();

  const [showGcpAdvanced, setShowGcpAdvanced] = useState(false);

  const {
    template,
    stages,
    options,
    provider,
    roles,
    status,
    error,
    result,
    setTemplate,
    setProvider,
    toggleStage,
    setOption,
    setResultYaml,
    loadAwsRoles,
    regenerate,
    openPr,
    editing,
    setEditing,
    editedYaml,
    setEditedYaml,
    getEffectiveYaml,
    hydrateFromWizard,
  } = usePipelineStore();

  const {
    repoInfo,
    pipelineInfo,
    setRepoInfo,
    setPipelineInfo,
    setLastToolCalled,
  } = useWizardStore();

  const yaml = getEffectiveYaml();
  const busy = status === "loading";

  // ---- AI Wizard Chat State ----
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your CI/CD wizard. Tell me about your repo and how you'd like your GitHub Actions YAML to behave (build, test, deploy, environments, branches, etc.).",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Load AWS roles when repo/branch is picked and provider is aws
  useEffect(() => {
    if (!repo || !branch || provider !== "aws") return;
    loadAwsRoles().catch(console.error);
  }, [repo, branch, provider, loadAwsRoles]);

  const handleGenerate = async () => {
    if (!repo || !branch) {
      alert("Pick a repo + branch on the Connect page first.");
      return;
    }

    await regenerate({
      repo,
      branch,
      template,
      provider,
      stages,
      options,
    });
  };

  const handleOpenPr = async () => {
    if (!repo || !branch) {
      alert("Pick a repo + branch on the Connect page first.");
      return;
    }
    try {
      await openPr({ repo, branch });
      alert("PR opened (or queued) successfully!");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Failed to open PR");
    }
  };

  const toggleStageChecked = (stage: "build" | "test" | "deploy") =>
    stages.includes(stage);

  // ---- AI Wizard: send message ----
  const handleSendChat = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    // --- Sync AI intent with pipeline stages BEFORE sending to backend ---
    // The AI is a planner, not an authority. UI state must be updated first.
    const lower = trimmed.toLowerCase();

    // Reset to defaults first
    let nextStages: Array<"build" | "test" | "deploy"> = ["build", "test", "deploy"];

    if (lower.includes("just build") || lower.includes("only build")) {
      nextStages = ["build"];
    } else if (
      lower.includes("build and test") ||
      (lower.includes("build") && lower.includes("test") && !lower.includes("deploy"))
    ) {
      nextStages = ["build", "test"];
    } else if (
      lower.includes("no deploy") ||
      lower.includes("without deploy")
    ) {
      nextStages = ["build", "test"];
    }

    // Apply stage changes to the pipeline store
    (["build", "test", "deploy"] as const).forEach((stage) => {
      const shouldEnable = nextStages.includes(stage);
      const isEnabled = stages.includes(stage);
      if (shouldEnable !== isEnabled) {
        toggleStage(stage);
      }
    });

    if (!repo || !branch) {
      alert(
        "Pick a repo + branch on the Connect page first so I can give better suggestions."
      );
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    try {
      // Send the same provider/config context that the manual generator uses.
      // This prevents the wizard from producing generic placeholder provider steps.
      const pipelineSnapshot = {
        template,
        provider,
        branch,
        stages: nextStages,
        options,
      };

      const res = await api.askYamlWizard({
        repoUrl: repo,
        provider,
        branch: branch,
        message: trimmed,
        yaml,
        // Extra context for the backend/wizard toolchain (safe to ignore if unused)
        pipelineSnapshot,
      });

      if ((res as any)?.tool_called) {
        setLastToolCalled((res as any).tool_called);
      }

      if (repo) {
        setRepoInfo({
          fullName: repo,
        });
      }

      if ((res as any)?.tool_called === "pipeline_generator") {
        const generatedYaml =
          (res as any)?.generated_yaml ??
          (res as any)?.tool_output?.data?.generated_yaml;

        const pipelineName =
          (res as any)?.pipeline_metadata?.data?.pipeline_name ??
          (res as any)?.pipeline_metadata?.pipeline_name;

        if (generatedYaml) {
          hydrateFromWizard({
            repo,
            generatedYaml,
            pipelineName,
          });
        }

        setPipelineInfo({
          pipelineName,
          branch,
          provider,
          // 🔒 Never override stages from backend / metadata
          stages: pipelineSnapshot.stages,
          options,
        } as any);
      }

      let text: string;

      if ((res as any)?.reply) {
        text = (res as any).reply;
      } else if ((res as any)?.message) {
        text = (res as any).message;
      } else if (
        (res as any)?.tool_called === "repo_reader" &&
        Array.isArray((res as any)?.tool_output?.data?.data?.repositories)
      ) {
        const count = (res as any).tool_output.data.data.repositories.length;
        text = `I found ${count} repositories. You can select one from the list to continue.`;
      } else if (repoInfo?.fullName) {
        text = `I'm looking at ${repoInfo.fullName}. What would you like to change about the pipeline?`;
      } else {
        text =
          "I couldn't map that request to an action yet. You can ask me to modify the pipeline, deploy settings, or AWS role.";
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: text,
      };

      setChatMessages((prev) => [...prev, assistantMessage]);
    } catch (e: any) {
      console.error("[ConfigurePage] AI wizard error:", e);
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content:
          "Sorry, I ran into an issue talking to the AI backend.\n\n" +
          `Error: ${e?.message ?? "Unknown error"}`,
      };
      setChatMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (
    e
  ) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChat();
    }
  };

  return (
    <div className="min-h-screen text-slate-100">
      <div className="max-w-screen-2xl mx-auto p-6 space-y-8">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            Configure CI/CD pipeline
          </h1>
          {repo && branch ? (
            <p className="text-sm text-slate-200">
              Targeting{" "}
              <span className="font-mono text-white">{repo}</span> @{" "}
              <span className="font-mono text-white">{branch}</span>
            </p>
          ) : (
            <p className="text-sm text-amber-300">
              Pick a GitHub repo + branch on the Connect page first.
            </p>
          )}
        </header>

        {/* Top grid: Config form (left) + AI wizard (right) */}
        <div className="grid gap-6 lg:grid-cols-[1.8fr_1.8fr]">
          {/* ===== Left: Config form ===== */}
          <section className="space-y-6 rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md shadow-glass p-6 text-white">
            {/* Template */}
            <label className="grid gap-1">
              <span className="text-sm font-medium text-white">Template</span>
              <select
                disabled={busy}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="rounded-md border border-white/25 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-500"
              >
                <option value="node_app">Node.js app</option>
                <option value="python_app">Python App</option>
                <option value="container_service">Container</option>
              </select>
              <span className="text-xs text-slate-200">
                Pick the closest match to your repo; the MCP backend refines it.
              </span>
            </label>

            {/* Provider */}
            <label className="grid gap-1">
              <span className="text-sm font-medium">Provider</span>
              <select
                disabled={busy}
                value={provider}
                onChange={(e) => setProvider(e.target.value as "aws" | "gcp")}
                className="rounded-md border border-white/25 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-500"
              >
                <option value="aws">AWS</option>
                <option value="gcp">GCP</option>
              </select>
              <span className="text-xs text-slate-200">
                Choose where to run and deploy your pipeline.
              </span>
            </label>

            {/* Stages */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-white">Enabled stages</legend>
              <div className="flex flex-wrap gap-3">
                {(["build", "test", "deploy"] as const).map((stage) => {
                  const checked = toggleStageChecked(stage);
                  const testDisabledForGcp = provider === "gcp" && stage === "test";

                  return (
                    <label
                      key={stage}
                      className={
                        "inline-flex items-center gap-2 text-sm " +
                        (testDisabledForGcp ? "opacity-60" : "")
                      }
                    >
                      <input
                        type="checkbox"
                        disabled={busy || testDisabledForGcp}
                        checked={checked}
                        onChange={() => {
                          // Keep stage combinations valid.
                          // - Deploy requires Build
                          // - Disabling Build disables Deploy
                          if (stage === "deploy" && !checked) {
                            if (!stages.includes("build")) toggleStage("build");
                            toggleStage("deploy");
                            return;
                          }

                          if (stage === "build" && checked) {
                            if (stages.includes("deploy")) toggleStage("deploy");
                            toggleStage("build");
                            return;
                          }

                          toggleStage(stage);
                        }}
                        className="h-4 w-4 rounded border-white/40 bg-white/10"
                      />
                      <span className="capitalize">{stage}</span>
                    </label>
                  );
                })}
              </div>
              {provider === "gcp" && (
                <div className="text-xs text-slate-200">
                  Note: the GCP Cloud Run workflow currently supports Build +
                  Deploy stages. Test stage is handled by the generic pipeline
                  generator (AWS path) and will be added to GCP later.
                </div>
              )}
            </fieldset>

            {/* Runtime version + commands */}
            <div className="grid gap-4">
              <label className="grid gap-1">
                <span className="text-sm font-medium text-white">Node version</span>
                <input
                  disabled={busy}
                  value={options.nodeVersion}
                  onChange={(e) => setOption("nodeVersion", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="20"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium text-white">Install command</span>
                <input
                  disabled={busy}
                  value={options.installCmd}
                  onChange={(e) => setOption("installCmd", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="npm ci"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium text-white">Test command</span>
                <input
                  disabled={busy}
                  value={options.testCmd}
                  onChange={(e) => setOption("testCmd", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="npm test"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium text-white">Build command</span>
                <input
                  disabled={busy}
                  value={options.buildCmd}
                  onChange={(e) => setOption("buildCmd", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="npm run build"
                />
              </label>
            </div>

            {provider === "aws" && stages.includes("deploy") && (
              <>
              <label className="grid gap-1">
                <span className="text-sm font-medium">AWS Role (OIDC)</span>
                <select
                  disabled={busy || !roles.length}
                  value={options.awsRoleArn ?? ""}
                  onChange={(e) => setOption("awsRoleArn", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm bg-black text-white"
                >
                  <option value="">-- select --</option>
                  {roles.map((r) => (
                    <option key={r.arn} value={r.arn}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-slate-200">
                  Roles come from the backend OIDC adapter; we’ll wire this into
                  the deploy job.
                </span>
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-medium">AWS Role Session Name</span>
                <input
                  disabled={busy}
                  value={options.awsSessionName ?? ""}
                  onChange={(e) => setOption("awsSessionName", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="autodeploy"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium">AWS Region</span>
                <input
                  disabled={busy}
                  value={options.awsRegion ?? ""}
                  onChange={(e) => setOption("awsRegion", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="us-east-1"
                />
              </label>
              </>
            )}

            {provider === "gcp" && (
              <div className="grid gap-4">
                <div className="rounded-lg border border-white/15 bg-white/5 p-4">
                  <div className="mb-2">
                    <div className="text-sm font-medium text-white">
                      GCP Cloud Run settings (optional per-repo overrides)
                    </div>
                    <div className="text-xs text-slate-200">
                      These values are written into the generated workflow YAML.
                      If left blank, the workflow will read the corresponding
                      GitHub Actions secrets at runtime (recommended).
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <label className="grid gap-1">
                      <span className="text-sm font-medium">GCP Project ID</span>
                      <input
                        disabled={busy}
                        value={options.gcpProjectId ?? ""}
                        onChange={(e) => setOption("gcpProjectId", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="my-gcp-project"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-sm font-medium">GCP Region</span>
                      <input
                        disabled={busy}
                        value={options.gcpRegion ?? ""}
                        onChange={(e) => setOption("gcpRegion", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="us-central1"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-sm font-medium">
                        Workload Identity Provider (WIF)
                      </span>
                      <input
                        disabled={busy}
                        value={options.gcpWorkloadIdentityProvider ?? ""}
                        onChange={(e) =>
                          setOption("gcpWorkloadIdentityProvider", e.target.value)
                        }
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="projects/123/locations/global/workloadIdentityPools/.../providers/..."
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-sm font-medium">
                        GCP Service Account Email
                      </span>
                      <input
                        disabled={busy}
                        value={options.gcpServiceAccountEmail ?? ""}
                        onChange={(e) =>
                          setOption("gcpServiceAccountEmail", e.target.value)
                        }
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="deployer@project.iam.gserviceaccount.com"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-lg border border-white/15 bg-white/5 p-4">
                  <div className="mb-2">
                    <div className="text-sm font-medium text-white">Services</div>
                    <div className="text-xs text-slate-200">
                      Cloud Run service names to deploy.
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <label className="grid gap-1">
                      <span className="text-sm font-medium">Backend service</span>
                      <input
                        disabled={busy}
                        value={options.gcpBackendService ?? ""}
                        onChange={(e) => setOption("gcpBackendService", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="my-app-api"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-sm font-medium">Frontend service</span>
                      <input
                        disabled={busy}
                        value={options.gcpFrontendService ?? ""}
                        onChange={(e) => setOption("gcpFrontendService", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="my-app-web"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-lg border border-white/15 bg-white/5 p-4">
                  <div className="mb-2">
                    <div className="text-sm font-medium text-white">
                      Artifact Registry + Images
                    </div>
                    <div className="text-xs text-slate-200">
                      Repo names + image names (without registry host).
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <label className="grid gap-1">
                      <span className="text-sm font-medium">Backend AR repo</span>
                      <input
                        disabled={busy}
                        value={options.gcpBackendArRepo ?? ""}
                        onChange={(e) => setOption("gcpBackendArRepo", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="autodeploy"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-sm font-medium">Frontend AR repo</span>
                      <input
                        disabled={busy}
                        value={options.gcpFrontendArRepo ?? ""}
                        onChange={(e) => setOption("gcpFrontendArRepo", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="autodeploy"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-sm font-medium">Backend image name</span>
                      <input
                        disabled={busy}
                        value={options.gcpBackendImageName ?? ""}
                        onChange={(e) => setOption("gcpBackendImageName", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="my-app-api"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-sm font-medium">Frontend image name</span>
                      <input
                        disabled={busy}
                        value={options.gcpFrontendImageName ?? ""}
                        onChange={(e) => setOption("gcpFrontendImageName", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="my-app-web"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-lg border border-white/15 bg-white/5 p-4">
                  <div className="mb-2">
                    <div className="text-sm font-medium text-white">Repo layout</div>
                    <div className="text-xs text-slate-200">
                      Docker build contexts + Dockerfile paths.
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <label className="grid gap-1">
                      <span className="text-sm font-medium">Backend context</span>
                      <input
                        disabled={busy}
                        value={options.gcpBackendContext ?? ""}
                        onChange={(e) => setOption("gcpBackendContext", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="server"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-sm font-medium">Backend Dockerfile</span>
                      <input
                        disabled={busy}
                        value={options.gcpBackendDockerfile ?? ""}
                        onChange={(e) => setOption("gcpBackendDockerfile", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="server/Dockerfile"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-sm font-medium">Frontend context</span>
                      <input
                        disabled={busy}
                        value={options.gcpFrontendContext ?? ""}
                        onChange={(e) => setOption("gcpFrontendContext", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="client"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-sm font-medium">Frontend Dockerfile</span>
                      <input
                        disabled={busy}
                        value={options.gcpFrontendDockerfile ?? ""}
                        onChange={(e) => setOption("gcpFrontendDockerfile", e.target.value)}
                        className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                        placeholder="client/Dockerfile"
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="grid gap-1">
                        <span className="text-sm font-medium">Backend port</span>
                        <input
                          disabled={busy}
                          type="number"
                          inputMode="numeric"
                          value={options.gcpBackendPort ?? 8080}
                          onChange={(e) =>
                            setOption("gcpBackendPort", Number(e.target.value))
                          }
                          className="h-9 w-28 rounded-md border border-white/25 px-2 py-1.5 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </label>

                      <label className="grid gap-1">
                        <span className="text-sm font-medium">Frontend port</span>
                        <input
                          disabled={busy}
                          type="number"
                          inputMode="numeric"
                          value={options.gcpFrontendPort ?? 8080}
                          onChange={(e) =>
                            setOption("gcpFrontendPort", Number(e.target.value))
                          }
                          className="h-9 w-28 rounded-md border border-white/25 px-2 py-1.5 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </label>
                    </div>

                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setShowGcpAdvanced((v) => !v)}
                        className="text-xs text-slate-200 underline underline-offset-2 hover:text-white"
                      >
                        {showGcpAdvanced ? "Hide advanced" : "Show advanced"}
                      </button>

                      {showGcpAdvanced && (
                        <div className="mt-2 space-y-2 rounded-md border border-white/15 bg-white/5 p-3">
                          <div className="text-xs text-slate-200">
                            Advanced: this generates Dockerfiles at workflow runtime
                            (only if missing). Recommended: use the Dashboard
                            Dockerfile scaffold button to commit Dockerfiles into
                            the repo.
                          </div>

                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={!!options.gcpGenerateDockerfiles}
                              onChange={(e) =>
                                setOption(
                                  "gcpGenerateDockerfiles",
                                  e.target.checked
                                )
                              }
                              className="h-4 w-4 rounded border-white/40 bg-white/10"
                            />
                            <span>
                              Auto-generate Dockerfiles in workflow if missing
                            </span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Generate / Open PR buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy || !repo || !branch}
                className="rounded-md bg-white/20 hover:bg-white/30 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Generating…" : "Generate pipeline"}
              </button>
              {status === "success" && (
                <span className="text-xs text-emerald-200">
                  YAML ready — review or edit below, then open a PR.
                </span>
              )}
            </div>

            {error && (
              <p className="text-sm text-red-300">
                Error: {error}
              </p>
            )}
          </section>

          {/* ===== Right: AI YAML Wizard Chat ===== */}
          <section className="flex flex-col rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md shadow-glass p-6 text-white">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">AI YAML wizard</h2>
                <p className="text-xs text-slate-200">
                  Describe how you want your workflow to behave. I’ll suggest
                  envs, branches, caching, matrix builds, etc.
                </p>
              </div>
            </div>

            {/* Chat messages */}
            <div className="flex-1 min-h-[360px] max-h-[576px] overflow-y-auto rounded-md border border-white/20 bg-white/5 px-3 py-2 space-y-2">
              {chatMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex ${
                    m.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`rounded-lg px-3 py-2 text-xs whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-white/20 text-white border border-white/30"
                        : "bg-white text-slate-900 border border-slate-200"
                    } max-w-[80%]`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <p className="text-[11px] text-slate-200">
                  Thinking about your pipeline…
                </p>
              )}
            </div>

            {/* Chat input */}
            <div className="mt-3 space-y-2">
              <textarea
                className="w-full rounded-md border border-white/25 bg-white/10 text-white px-3 py-2 text-xs resize-none placeholder-white/60"
                rows={3}
                placeholder="E.g. I want this to run only on main and PRs, use Node 20, cache npm, and deploy to prod on tags starting with v*…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                disabled={chatLoading}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSendChat}
                  disabled={chatLoading || !chatInput.trim()}
                  className="rounded-md bg-white/20 hover:bg-white/30 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {chatLoading ? "Asking…" : "Ask wizard"}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* ===== YAML Preview / Editor (full width) ===== */}
        <section className="space-y-3 rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md text-slate-100 p-4 shadow-glass">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium">GitHub Actions YAML</h2>
              <p className="text-xs text-slate-200">
                Review the generated workflow. Switch to manual mode to tweak
                before opening a PR.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setEditing(!editing)}
              disabled={!result}
              className="rounded-md border border-white/40 px-3 py-1.5 text-xs font-medium text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editing ? "Back to wizard view" : "Edit YAML manually"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  const toSave = editedYaml ?? yaml;
                  if (toSave) {
                    setResultYaml(toSave);
                    setEditing(false);
                  }
                }}
                disabled={!editedYaml && !yaml}
                className="rounded-md bg-white/20 hover:bg-white/30 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save YAML
              </button>
            )}
          </div>

          {status === "loading" && (
            <p className="text-xs text-slate-200">Generating pipeline…</p>
          )}

          {!result && status !== "loading" && (
            <p className="text-xs text-slate-200">
              Generate a pipeline above to see the YAML preview.
            </p>
          )}

          {result && yaml && (
            <>
              {!editing ? (
                <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-slate-900 text-slate-100 text-xs p-3 font-mono whitespace-pre">
                  {yaml}
                </pre>
              ) : (
                <textarea
                  className="mt-2 w-full h-96 rounded-md border border-slate-700 bg-slate-950 text-slate-100 text-xs font-mono p-3 resize-y"
                  spellCheck={false}
                  value={editedYaml ?? yaml}
                  onChange={(e) => setEditedYaml(e.target.value)}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
