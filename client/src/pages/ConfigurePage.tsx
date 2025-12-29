import { useEffect, useState } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { usePipelineStore } from "../store/usePipelineStore";
import { useWizardStore } from "../store/useWizardStore";
import { api } from "../lib/api";
import { useAuthStore } from "../store/useAuthStore";

type CopilotSuggestion = {
  id: string;
  title: string;
  description: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  suggestions?: CopilotSuggestion[];
  meta?: {
    toolCalled?: string;
    agentDecision?: string;
    mode?: "user" | "pro";
    usedRag?: boolean;
    noWorkflowContext?: boolean;
  };
};

export default function ConfigurePage() {
  const { repo, branch } = useRepoStore();

  const {
    template,
    stages,
    options,
    provider,
    roles,
    status,
    error,
    result,
    workflows,
    selectedWorkflowPath,
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
    loadWorkflows,
    selectWorkflow,
    setPipelineName,
  } = usePipelineStore();

  const {
    repoInfo,
    pipelineInfo,
    setRepoInfo,
    setPipelineInfo,
    setLastToolCalled,
  } = useWizardStore();

  const { user } = useAuthStore();
  const isPro = !!(user && (user.plan === "pro" || (user as any).beta_pro_granted));

  const yaml = getEffectiveYaml();
  const busy = status === "loading";

  // ---- AI Wizard Chat State ----
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm your Workflow Copilot. I can read your repo's workflows, explain what they do today, and suggest improvements or new GitHub Actions YAML for you to review.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Load AWS roles when repo/branch is picked and provider is aws
  useEffect(() => {
    if (!repo || !branch || provider !== "aws") return;
    loadAwsRoles().catch(console.error);
  }, [repo, branch, provider, loadAwsRoles]);

  // Load existing workflows for the selected repo (if any)
  useEffect(() => {
    if (!repo) return;
    loadWorkflows(repo).catch(console.error);
  }, [repo, loadWorkflows]);

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

  const handleProposePipeline = async () => {
    // For regular users (non-pro), "Propose CI pipeline" should directly
    // generate a pipeline using the current form settings, without
    // going through the free-form agent chat.
    if (!isPro) {
      await handleGenerate();
      return;
    }

    // Pro users keep the agent-driven behavior.
    setChatInput("Propose a complete GitHub Actions CI pipeline for this repo.");
    setTimeout(() => handleSendChat(), 0);
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

    // Start from the current UI state; the wizard is a planner, not an
    // authority. We only change stages when the user explicitly asks
    // (e.g. "no deploy", "just build").
    let nextStages: Array<"build" | "test" | "deploy"> = [...stages];

    if (lower.includes("just build") || lower.includes("only build")) {
      nextStages = ["build"];
    } else if (
      lower.includes("build and test") ||
      (lower.includes("build") && lower.includes("test") && !lower.includes("deploy"))
    ) {
      nextStages = ["build", "test"];
    } else if (
      lower.includes("no deploy") ||
      lower.includes("without deploy") ||
      lower.includes("remove deploy") ||
      lower.includes("remove the deploy") ||
      lower.includes("remove deployment") ||
      lower.includes("disable deploy") ||
      lower.includes("disable deployment") ||
      lower.includes("i dont want the deploy") ||
      lower.includes("i don't want the deploy")
    ) {
      nextStages = ["build", "test"];
    }

    const deployTurnedOff = stages.includes("deploy") && !nextStages.includes("deploy");
    const onlyStageChangeIntent =
      deployTurnedOff &&
      // Heuristic: user is clearly talking about deploy, and not asking
      // for a completely new pipeline description in the same turn.
      (lower.includes("no deploy") ||
        lower.includes("without deploy") ||
        lower.includes("remove deploy") ||
        lower.includes("remove the deploy") ||
        lower.includes("remove deployment") ||
        lower.includes("disable deploy") ||
        lower.includes("disable deployment") ||
        lower.includes("i dont want the deploy") ||
        lower.includes("i don't want the deploy"));

    // Apply stage changes to the pipeline store
    (["build", "test", "deploy"] as const).forEach((stage) => {
      const shouldEnable = nextStages.includes(stage);
      const isEnabled = stages.includes(stage);
      if (shouldEnable !== isEnabled) {
        toggleStage(stage);
      }
    });

    // If this turn is clearly about changing stages (e.g. "remove deploy")
    // and we already have a repo/branch, auto-regenerate the pipeline so
    // the YAML below stays in sync, then continue to send the prompt so
    // the assistant can acknowledge the change.
    if (onlyStageChangeIntent && repo && branch) {
      await regenerate({
        repo,
        branch,
        template,
        provider,
        stages: nextStages,
        options,
      });
    }

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
        repo,
        template,
        provider,
        branch,
        stages: nextStages,
        options,
        // If we already have a pipeline_name (e.g. from Existing workflows
        // or the New workflow file input), pass it through so the backend
        // wizard can mention/use the same filename.
        pipeline_name: (result as any)?.pipeline_name,
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

      const toolCalled = (res as any)?.tool_called as string | undefined;
      const agentDecision = (res as any)?.agent_decision as string | undefined;
      const backendMode = (res as any)?.mode as "user" | "pro" | undefined;
      const ragNamespace = (res as any)?.rag_namespace as string | undefined;
      const suggestions = (res as any)?.suggestions as CopilotSuggestion[] | undefined;
      const noWorkflowContext = !!(res as any)?.no_workflow_context;
      const usedRag = !!(
        toolCalled === "rag_query" ||
        agentDecision === "rag_workflow_analysis" ||
        ragNamespace
      );

      if (toolCalled) {
        setLastToolCalled(toolCalled);
      }

      if (repo) {
        setRepoInfo({
          fullName: repo,
        });
      }

      if (toolCalled === "pipeline_generator") {
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
        toolCalled === "repo_reader" &&
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
        suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 5) : undefined,
        meta: {
          toolCalled,
          agentDecision,
          mode: backendMode,
          usedRag,
          noWorkflowContext,
        },
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
      <div className="max-w-6xl mx-auto p-6 space-y-8">
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
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ===== Left: Config form ===== */}
          <section className="space-y-6 rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md shadow-glass p-6 text-white">
            {/* Existing workflows selector (read-only YAML import) */}
            <label className="grid gap-1">
              <span className="text-sm font-medium text-white">Existing workflows</span>
              <select
                disabled={!repo || workflows.length === 0}
                value={selectedWorkflowPath ?? ""}
                onChange={(e) => {
                  const path = e.target.value;
                  if (!path || !repo) return;
                  selectWorkflow(repo, path);
                }}
                className="rounded-md border border-white/25 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-500"
              >
                <option value="">
                  {workflows.length === 0
                    ? "No workflows found in .github/workflows"
                    : "Select an existing workflow (optional)"}
                </option>
                {workflows.map((wf) => {
                  const shortPath = wf.path.startsWith(".github/workflows/")
                    ? wf.path.replace(".github/workflows/", "")
                    : wf.path;
                  const state = wf.state === "active" ? "active" : wf.state;
                  return (
                    <option key={wf.path} value={wf.path}>
                      {shortPath} {state ? `(${state})` : ""}
                    </option>
                  );
                })}
              </select>
              <span className="text-xs text-slate-200">
                Loading a workflow here updates the YAML preview below but does
                not change the template or form fields.
              </span>
            </label>

            {/* New workflow file name (for repos without existing YAML) */}
            <label className="grid gap-1">
              <span className="text-sm font-medium text-white">New workflow file</span>
              <div className="flex items-center gap-2">
                {(() => {
                  const pipelineName = (result as any)?.pipeline_name as
                    | string
                    | undefined;
                  const base = (pipelineName || "ci.yml").replace(/\.ya?ml$/i, "");
                  return (
                    <input
                      type="text"
                      disabled={busy}
                      value={base}
                      onChange={(e) => {
                        const raw = e.target.value || "";
                        let norm = raw.toLowerCase();
                        norm = norm.replace(/\s+/g, "-");
                        // remove characters that are likely to cause issues
                        norm = norm.replace(/[^a-z0-9._-]/g, "");
                        if (norm.length > 50) norm = norm.slice(0, 50);
                        if (!norm) norm = "ci";
                        const finalName = `${norm}.yml`;
                        setPipelineName(finalName);
                      }}
                      className="flex-1 rounded-md border border-white/25 bg-white px-3 py-2 text-sm font-mono text-slate-900 placeholder-slate-500"
                      placeholder="ci"
                    />
                  );
                })()}
                <span className="text-xs font-mono text-slate-200">.yml</span>
              </div>
              <span className="text-xs text-slate-200">
                Will be committed as
                {" "}
                <span className="font-mono">
                  {`.github/workflows/${
                    ((result as any)?.pipeline_name as string | undefined) || 'ci.yml'
                  }`}
                </span>
                .
              </span>
            </label>

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
                <option value="aws_static_vite">AWS Static Frontend (Vite)</option>
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
                {(["build", "test", "deploy"] as const).map((stage) => (
                  <label
                    key={stage}
                    className="inline-flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={toggleStageChecked(stage)}
                      onChange={() => toggleStage(stage)}
                      className="h-4 w-4 rounded border-white/40 bg-white/10"
                    />
                    <span className="capitalize">{stage}</span>
                  </label>
                ))}
              </div>
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
                  value={roles.some((r) => r.arn === options.awsRoleArn)
                    ? options.awsRoleArn ?? ""
                    : ""}
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
                  Roles currently come from a mock OIDC adapter; for production,
                  you can also paste a custom ARN below.
                </span>
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-slate-200">
                  Or paste a custom IAM Role ARN
                </span>
                <input
                  disabled={busy}
                  value={options.awsRoleArn ?? ""}
                  onChange={(e) => setOption("awsRoleArn", e.target.value)}
                  className="rounded-md border border-white/25 px-3 py-2 text-xs font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                  placeholder="arn:aws:iam::123456789012:role/github-oidc-role"
                />
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

              {template === "aws_static_vite" && (
                <>
                  <label className="grid gap-1">
                    <span className="text-sm font-medium text-white">AWS Account ID</span>
                    <input
                      disabled={busy}
                      value={options.awsAccountId ?? ""}
                      onChange={(e) => setOption("awsAccountId", e.target.value)}
                      className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                      placeholder="123456789012"
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-sm font-medium text-white">S3 Bucket</span>
                    <input
                      disabled={busy}
                      value={options.s3Bucket ?? ""}
                      onChange={(e) => setOption("s3Bucket", e.target.value)}
                      className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                      placeholder="autodeploy-landing-prod"
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-sm font-medium text-white">CloudFront Distribution ID</span>
                    <input
                      disabled={busy}
                      value={options.cloudFrontDistributionId ?? ""}
                      onChange={(e) => setOption("cloudFrontDistributionId", e.target.value)}
                      className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                      placeholder="E123ABC456XYZ"
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-sm font-medium text-white">Output directory</span>
                    <input
                      disabled={busy}
                      value={options.outputDir ?? ""}
                      onChange={(e) => setOption("outputDir", e.target.value)}
                      className="rounded-md border border-white/25 px-3 py-2 text-sm font-mono text-white bg-white/10 placeholder-white/60 disabled:bg-white/5 disabled:text-slate-400"
                      placeholder="dist"
                    />
                  </label>
                </>
              )}
              </>
            )}

            {provider === "gcp" && (
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
                  placeholder="service-account@project.iam.gserviceaccount.com"
                />
                <span className="text-xs text-slate-200">
                  Provide the service account that should run deployments.
                </span>
              </label>
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

          {/* ===== Right: Workflow Copilot Chat ===== */}
          <section className="flex flex-col rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md shadow-glass p-6 text-white">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">Workflow Copilot</h2>
                <p className="text-xs text-slate-200">
                  Ask how your repo’s CI/CD works today, what’s missing, or have me propose a better GitHub Actions workflow.
                </p>
              </div>
              <span className="inline-flex items-center rounded-full border border-white/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-100 bg-black/20">
                {isPro ? "Pro" : "User"}
              </span>
            </div>

            {/* Chat messages */}
            <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-slate-200">
              <button
                type="button"
                className="rounded-full border border-white/25 bg-white/5 px-2 py-0.5 hover:bg-white/10"
                onClick={() => {
                  setChatInput("Analyze my current workflows and tell me what they do.");
                  // Fire immediately for snappier UX
                  setTimeout(() => handleSendChat(), 0);
                }}
              >
                Analyze workflows
              </button>
              <button
                type="button"
                className="rounded-full border border-white/25 bg-white/5 px-2 py-0.5 hover:bg-white/10"
                onClick={() => {
                  setChatInput("Suggest a short list of improvements to my CI (tests, build, deploy, caching).");
                  setTimeout(() => handleSendChat(), 0);
                }}
              >
                Suggest improvements
              </button>
              <button
                type="button"
                className="rounded-full border border-white/25 bg-white/5 px-2 py-0.5 hover:bg-white/10"
                onClick={handleProposePipeline}
              >
                Propose CI pipeline
              </button>
            </div>

            {/* Compact read-only output for regular users */}
            {!isPro && (
              <div className="mb-3 rounded-md border border-white/20 bg-white/5 px-3 py-2 text-[11px] text-slate-100 whitespace-pre-wrap max-h-56 overflow-y-auto">
                {chatLoading ? (
                  <span>Analyzing your workflows…</span>
                ) : (
                  (() => {
                    const lastAssistant = [...chatMessages]
                      .reverse()
                      .find((m) => m.role === "assistant");
                    return lastAssistant?.content ||
                      "Click Analyze workflows to see a summary of your existing GitHub Actions files.";
                  })()
                )}
              </div>
            )}

            {/* Chat transcript (Pro only). Regular users only see the
                canned quick actions above, which trigger specific
                analyze/suggest behaviours. */}
            {isPro && (
              <>
                <div className="flex-1 min-h-[260px] overflow-y-auto rounded-md border border-white/20 bg-white/5 px-3 py-2 space-y-2">
                  {chatMessages.map((m, idx) => (
                    <div
                      key={idx}
                      className={`flex ${
                        m.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div className="max-w-[80%] space-y-1">
                        <div
                          className={`rounded-lg px-3 py-2 text-xs whitespace-pre-wrap ${
                            m.role === "user"
                              ? "bg-white/20 text-white border border-white/30"
                              : "bg-white text-slate-900 border border-slate-200"
                          }`}
                        >
                          {m.content}
                        </div>
                        {m.role === "assistant" && m.meta?.usedRag && (
                          <div className="text-[10px] text-emerald-200">
                            Used repo-aware RAG context (Pro)
                          </div>
                        )}
                        {m.role === "assistant" &&
                          Array.isArray(m.suggestions) &&
                          m.suggestions.length > 0 && (
                            <div className="ml-1 text-[11px] text-slate-900 bg-white/90 rounded-md px-2 py-1">
                              <div className="mb-1 font-semibold">
                                {m.meta?.noWorkflowContext
                                  ? "Generic best-practice suggestions:"
                                  : "Suggested workflow improvements:"}
                              </div>
                              <ul className="list-disc pl-4">
                                {m.suggestions.map((s) => (
                                  <li key={s.id} className="mb-0.5 last:mb-0">
                                    <span className="font-semibold">{s.title}: </span>
                                    <span>{s.description}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <p className="text-[11px] text-slate-200">
                      Thinking about your pipeline…
                    </p>
                  )}
                </div>

                {/* Free-form chat input (Pro only) */}
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
              </>
            )}
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
