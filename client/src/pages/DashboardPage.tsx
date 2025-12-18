import { useEffect, useState } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { usePipelineStore } from "../store/usePipelineStore";
import { useConfigStore } from "../store/useConfigStore";
import { useDeployStore } from "../store/useDeployStore";
import { api, PipelineVersion } from "../lib/api";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/Badge";
import { ScrollArea } from "@/components/ui/scroll-area";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function DashboardPage() {
  const { repo, branch: selectedBranch } = useRepoStore();
  const { result, setResultYaml } = usePipelineStore();
  const cfg = useConfigStore();

  const running = useDeployStore((s) => s.running);
  const events = useDeployStore((s) => s.events);
  const startDeploy = useDeployStore((s) => s.startDeploy);
  const stop = useDeployStore((s) => s.stop);
  const clear = useDeployStore((s) => s.clear);

  useEffect(() => {
    return () => {
      clear?.();
    };
  }, [clear]);

  const repoFullName = result?.repo || repo || "";
  const branchName =
    (result as any)?.branch || selectedBranch || "main";
  const environment = cfg.env || "dev";
  const workflowFile =
    (result as any)?.pipeline_name || `${environment}-deploy.yml`;
  const workflowPath = workflowFile.startsWith(".github/workflows/")
    ? workflowFile
    : `.github/workflows/${workflowFile}`;

  const [versions, setVersions] = useState<PipelineVersion[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] =
    useState<PipelineVersion | null>(null);
  const [rollbackBusy, setRollbackBusy] = useState(false);

  const [editingYaml, setEditingYaml] = useState(false);
  const [draftYaml, setDraftYaml] = useState(result?.generated_yaml ?? "");
  const currentYaml = (result?.generated_yaml ?? draftYaml ?? "").trim();
  const canCommitYaml = currentYaml.length > 0;
  // 🔑 Single source of truth for the currently active YAML

// const canCommitYaml =
//   (editingYaml ? draftYaml : (result?.generated_yaml ?? draftYaml))?.trim();

  useEffect(() => {
    if (!editingYaml) {
      setDraftYaml(result?.generated_yaml ?? "");
    }
  }, [result?.generated_yaml, editingYaml]);

  // Load history whenever repo/branch changes
  useEffect(() => {
    if (!repoFullName) return;
    let cancelled = false;

    async function load() {
      setLoadingHistory(true);
      setHistoryError(null);
      try {
        const rows = await api.getPipelineHistory({
          repoFullName,
          branch: branchName,
          path: workflowPath,
          limit: 20,
        });
        if (!cancelled) {
          setVersions(rows);
          if (!selectedVersion && rows.length > 0) {
            setSelectedVersion(rows[0]);
          }
        }
      } catch (err: any) {
        console.error("[Dashboard] getPipelineHistory failed:", err);
        if (!cancelled) setHistoryError(err.message || "Failed to load history");
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName, branchName, workflowPath]);

async function handleRollback(version: PipelineVersion) {
  if (!version?.id) return;

  const confirmMsg = `Rollback ${repoFullName}@${branchName} to version created at ${formatDate(
    version.created_at
  )}?`;
  if (!window.confirm(confirmMsg)) return;

  setRollbackBusy(true);
  try {
    // 👇 THIS is where the rollback happens
    const data = await api.rollbackPipeline(version.id);

    // 👇 SHOW REAL OUTPUT (GitHub commit URL)
    alert(
      `Rollback committed ✅\n${
        data?.github?.commit?.html_url ?? "OK"
      }`
    );

    // 👇 Update Current Pipeline YAML in UI
    setResultYaml(version.yaml);
    setEditingYaml(false);

    // 👇 Refresh history list
    const rows = await api.getPipelineHistory({
      repoFullName,
      branch: branchName,
      path: workflowPath,
      limit: 20,
    });
    setVersions(rows);
    setSelectedVersion(rows[0] ?? null);

  } catch (err: any) {
    console.error("[Dashboard] rollbackPipeline failed:", err);
    alert(err.message || "Rollback failed");
  } finally {
    setRollbackBusy(false);
  }
}



async function handleCommitClick() {
  const repoFullNameLocal = result?.repo || repo;
  const yaml = currentYaml;

  const branchLocal = (result as any)?.branch || branchName || "main";
  const provider = "aws";
  const path = workflowPath;

  if (!repoFullNameLocal || !yaml) {
    alert("Missing repo or YAML — generate a pipeline first.");
    return;
  }

  const res = await startDeploy({
    repoFullName: repoFullNameLocal,
    branch: branchLocal,
    env: environment,
    yaml,
    provider,
    path,
  });

  // backend response you showed: res.data.commit.html_url
  const url = res?.data?.commit?.html_url;
  alert(url ? `Committed ✅\n${url}` : "Committed ✅");
}


  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline Dashboard</h1>
          {repoFullName ? (
            <p className="text-sm text-muted-foreground">
                  {repoFullName} @ <span className="font-mono">{branchName}</span>
            </p>
          ) : (
            <p className="text-sm text-orange-600">
              Select a repo and branch on the Connect / Configure pages first.
            </p>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT COLUMN */}
        <div className="space-y-6">
          {/* Current Pipeline */}
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Current Pipeline</CardTitle>
              <div className="text-xs text-muted-foreground">
                {result?.pipeline_name || "No pipeline name"} · Generated{" "}
                {result?.created_at
                  ? new Date(result.created_at).toLocaleString()
                  : "—"}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {editingYaml ? (
                <textarea
                  className="h-64 rounded-md border bg-slate-950 text-xs font-mono text-slate-100 p-3"
                  spellCheck={false}
                  value={draftYaml}
                  onChange={(e) => setDraftYaml(e.target.value)}
                />
              ) : (
                <ScrollArea className="h-64 rounded-md border bg-slate-950 text-xs font-mono text-slate-100">
                  <div className="p-3">
                    <pre className="whitespace-pre-wrap break-words">
                      {currentYaml || "No pipeline generated yet."}

                    </pre>
                  </div>
                </ScrollArea>
              )}
                
              <div className="flex items-center gap-2 flex-wrap">
                <Button
  size="sm"
  disabled={running || !repoFullName || !canCommitYaml}
  onClick={handleCommitClick}
>
  {running ? "Committing…" : "Commit to GitHub"}
</Button>

                {running && (
                  <Button size="sm" variant="outline" onClick={stop}>
                    Stop
                  </Button>
                )}
                {currentYaml && (
                  <>
                    <Button
                      size="sm"
                      variant={editingYaml ? "secondary" : "outline"}
                      onClick={() => setEditingYaml((v) => !v)}
                    >
                      {editingYaml ? "Cancel edit" : "Edit YAML"}
                    </Button>
                    {editingYaml && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => {
                          setResultYaml(draftYaml);
                          setEditingYaml(false);
                        }}
                      >
                        Save YAML
                      </Button>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Commit Logs */}
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Commit Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64 rounded-md border bg-slate-950 text-slate-100 text-xs font-mono">
                <div className="p-3 space-y-1">
                  {events.length === 0
                    ? "No logs yet."
                    : events.map((e, i) => (
                        <div key={i}>
                          [{new Date(e.ts).toLocaleTimeString()}]{" "}
                          {e.level.toUpperCase()}: {e.msg}
                        </div>
                      ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-6">
          {/* History list */}
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Pipeline History (YAML versions)
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col">
              {loadingHistory && (
                <p className="text-sm text-muted-foreground">Loading history…</p>
              )}
              {historyError && (
                <p className="text-sm text-red-600">{historyError}</p>
              )}
              {!loadingHistory && !historyError && versions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No previous pipeline versions found for this repo/branch.
                </p>
              )}

              <ScrollArea className="mt-2 h-64 pr-1">
                <div className="space-y-2">
                  {versions.map((v) => {
                    const isSelected = selectedVersion?.id === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVersion(v)}
                        className={[
                          "w-full text-left px-3 py-2 rounded-md border flex flex-col gap-1",
                          "transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium truncate">
                            {formatDate(v.created_at)}
                          </span>
                          <Badge
                            variant={
                              v.source === "pipeline_rollback"
                                ? "outline"
                                : "secondary"
                            }
                          >
                            {v.source}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono text-muted-foreground truncate">
                            {v.workflow_path}
                          </span>
                          <span className="text-[11px] font-mono text-muted-foreground">
                            {(v.yaml_hash || v.id).slice(0, 8)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Selected version preview */}
          <Card className="flex flex-col overflow-hidden">
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Selected Version</CardTitle>
                {selectedVersion && (
                  <p className="text-xs text-muted-foreground">
                    Created: {formatDate(selectedVersion.created_at)} ·{" "}
                    <span className="font-mono">
                      {(selectedVersion.yaml_hash || selectedVersion.id).slice(
                        0,
                        8
                      )}
                    </span>
                  </p>
                )}
              </div>
              {selectedVersion && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={rollbackBusy}
                  onClick={() => handleRollback(selectedVersion)}
                >
                  {rollbackBusy ? "Rolling back…" : "Rollback to this version"}
                </Button>
              )}
            </CardHeader>
            <CardContent className="flex flex-col">
              {!selectedVersion ? (
                <p className="text-sm text-muted-foreground mt-2">
                  Select a version above to preview the YAML and trigger a
                  rollback.
                </p>
              ) : (
                <ScrollArea className="h-64 border rounded-md bg-muted/30 text-xs font-mono leading-relaxed">
                  <div className="p-3">
                    <pre className="whitespace-pre-wrap break-words">
                      {selectedVersion.yaml}
                    </pre>
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
