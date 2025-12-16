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

  const {
    template,
    stages,
    options,
    roles,
    status,
    error,
    result,
    setTemplate,
    toggleStage,
    setOption,
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

  // Load AWS roles when repo/branch is picked
  useEffect(() => {
    if (!repo || !branch) return;
    loadAwsRoles().catch(console.error);
  }, [repo, branch, loadAwsRoles]);

  const handleGenerate = async () => {
    if (!repo || !branch) {
      alert("Pick a repo + branch on the Connect page first.");
      return;
    }
    console.log("[ConfigurePage] Generate clicked with inputs:", {
      repo,
      branch,
      template,
      stages,
      options,
    });
    await regenerate({ repo, branch });
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

    if (!repo || !branch) {
      alert("Pick a repo + branch on the Connect page first so I can give better suggestions.");
      return;
    }

    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await api.askYamlWizard({
        repoUrl: repo,       // backend expects "repoUrl"
        provider: "aws",     // or whatever provider you use
        branch: branch,      // backend expects "branch"
        message: trimmed,    // optional, for your agent logic
        yaml,                // optional, current YAML for context
      });

      // ---- Update wizard context memory ----
      if ((res as any)?.tool_called) {
        setLastToolCalled((res as any).tool_called);
      }

      // If repo info is available from selection or tool output, store it
      if (repo) {
        setRepoInfo({
          fullName: repo,
        });
      }

      // If a pipeline was generated, hydrate pipeline store + wizard context
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
          provider: "aws",
          stages,
        });
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
        const count =
          (res as any).tool_output.data.data.repositories.length;
        text = `I found ${count} repositories. You can select one from the list to continue.`;
      } else if (repoInfo?.fullName) {
        text = `I’m looking at ${repoInfo.fullName}. What would you like to change about the pipeline?`;
      } else {
        text =
          "I couldn’t map that request to an action yet. You can ask me to modify the pipeline, deploy settings, or AWS role.";
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
    <div className="min-h-screen bg-slate-100">
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">
            Configure CI/CD pipeline
          </h1>
          {repo && branch ? (
            <p className="text-sm text-slate-600">
              Targeting{" "}
              <span className="font-mono text-slate-900">{repo}</span> @{" "}
              <span className="font-mono text-slate-900">{branch}</span>
            </p>
          ) : (
            <p className="text-sm text-amber-700">
              Pick a GitHub repo + branch on the Connect page first.
            </p>
          )}
        </header>

        {/* Top grid: Config form (left) + AI wizard (right) */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ===== Left: Config form ===== */}
          <section className="space-y-6 rounded-xl border bg-white/90 p-4 shadow-sm">
            {/* Template */}
            <label className="grid gap-1">
              <span className="text-sm font-medium">Template</span>
              <select
                disabled={busy}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <option value="node_app">Node.js app</option>
                <option value="node_library">Node.js library</option>
                <option value="react_vite">React/Vite app</option>
              </select>
              <span className="text-xs text-slate-500">
                Pick the closest match to your repo; the MCP backend refines it.
              </span>
            </label>

            {/* Stages */}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Enabled stages</legend>
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
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="capitalize">{stage}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Node version + commands */}
            <div className="grid gap-4">
              <label className="grid gap-1">
                <span className="text-sm font-medium">Node version</span>
                <input
                  disabled={busy}
                  value={options.nodeVersion}
                  onChange={(e) => setOption("nodeVersion", e.target.value)}
                  className="rounded-md border px-3 py-2 text-sm font-mono
           text-slate-900 bg-white
           disabled:bg-slate-100 disabled:text-slate-400"
                  placeholder="20"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium">Install command</span>
                <input
                  disabled={busy}
                  value={options.installCmd}
                  onChange={(e) => setOption("installCmd", e.target.value)}
                  className="rounded-md border px-3 py-2 text-sm font-mono
           text-slate-900 bg-white
           disabled:bg-slate-100 disabled:text-slate-400"
                  placeholder="npm ci"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium">Test command</span>
                <input
                  disabled={busy}
                  value={options.testCmd}
                  onChange={(e) => setOption("testCmd", e.target.value)}
                  className="rounded-md border px-3 py-2 text-sm font-mono
           text-slate-900 bg-white
           disabled:bg-slate-100 disabled:text-slate-400"
                  placeholder="npm test"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium">Build command</span>
                <input
                  disabled={busy}
                  value={options.buildCmd}
                  onChange={(e) => setOption("buildCmd", e.target.value)}
                  className="rounded-md border px-3 py-2 text-sm font-mono
           text-slate-900 bg-white
           disabled:bg-slate-100 disabled:text-slate-400"
                  placeholder="npm run build"
                />
              </label>
            </div>

            {/* AWS Role */}
            <label className="grid gap-1">
              <span className="text-sm font-medium">AWS Role (OIDC)</span>
              <select
                disabled={busy || !roles.length}
                value={options.awsRoleArn ?? ""}
                onChange={(e) => setOption("awsRoleArn", e.target.value)}
                className="rounded-md border px-3 py-2 text-sm bg-black text-white"
              >
                <option value="">-- select --</option>
                {roles.map((r) => (
                  <option key={r.arn} value={r.arn}>
                    {r.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-500">
                Roles come from the backend OIDC adapter; we’ll wire this into
                the deploy job.
              </span>
            </label>

            {/* Generate / Open PR buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy || !repo || !branch}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Generating…" : "Generate pipeline"}
              </button>

              <button
                type="button"
                onClick={handleOpenPr}
                disabled={!result || !yaml}
                className="rounded-md border border-slate-900 px-4 py-2 text-sm font-medium text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Open PR with YAML
              </button>

              {status === "success" && (
                <span className="text-xs text-emerald-700">
                  YAML ready — review or edit below, then open a PR.
                </span>
              )}
            </div>

            {error && (
              <p className="text-sm text-red-600">
                Error: {error}
              </p>
            )}
          </section>

          {/* ===== Right: AI YAML Wizard Chat ===== */}
          <section className="flex flex-col rounded-xl border bg-white/90 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">AI YAML wizard</h2>
                <p className="text-xs text-slate-500">
                  Describe how you want your workflow to behave. I’ll suggest
                  envs, branches, caching, matrix builds, etc.
                </p>
              </div>
            </div>

            {/* Chat messages */}
            <div className="flex-1 min-h-[200px] max-h-[320px] overflow-y-auto rounded-md border bg-slate-50 px-3 py-2 space-y-2">
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
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-900 border border-slate-200"
                    } max-w-[80%]`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <p className="text-[11px] text-slate-500">
                  Thinking about your pipeline…
                </p>
              )}
            </div>

            {/* Chat input */}
            <div className="mt-3 space-y-2">
              <textarea
                className="w-full rounded-md border px-3 py-2 text-xs resize-none"
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
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {chatLoading ? "Asking…" : "Ask wizard"}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* ===== YAML Preview / Editor (full width) ===== */}
        <section className="space-y-3 rounded-xl border bg-slate-950 text-slate-100 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium">GitHub Actions YAML</h2>
              <p className="text-xs text-slate-400">
                Review the generated workflow. Switch to manual mode to tweak
                before opening a PR.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setEditing(!editing)}
              disabled={!result}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editing ? "Back to wizard view" : "Edit YAML manually"}
            </button>
          </div>

          {status === "loading" && (
            <p className="text-xs text-slate-400">Generating pipeline…</p>
          )}

          {!result && status !== "loading" && (
            <p className="text-xs text-slate-500">
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
