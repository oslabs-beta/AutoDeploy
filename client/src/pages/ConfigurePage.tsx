import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { usePipelineStore } from "../store/usePipelineStore";

export default function ConfigurePage() {
  const { repo, branch } = useRepoStore();
  const pipeline = usePipelineStore();
  const navigate = useNavigate();

  // Log on mount with repo, branch, and navigate check
  useEffect(() => {
    console.log("[ConfigurePage] Mounted. Repo:", repo, "Branch:", branch);
    if (!navigate) console.warn("[ConfigurePage] ⚠️ navigate() not initialized!");
  }, [repo, branch, navigate]);

  // Load available AWS roles once, safely
  useEffect(() => {
    let loaded = false;

    async function init() {
      if (loaded) return;
      loaded = true;
      try {
        console.log("[ConfigurePage] Loading AWS roles once...");
        await pipeline.loadAwsRoles?.();

        // Re-read roles from store after load completes
        const updatedRoles = usePipelineStore.getState().roles;
        console.log("[ConfigurePage] Roles (after load):", updatedRoles);
      } catch (err) {
        console.error("Failed to load AWS roles:", err);
      }
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [busy, setBusy] = useState(false);

  async function onGenerate() {
    if (!repo || !branch) return;
    setBusy(true);
    await pipeline.regenerate({ repo, branch }).catch(console.error);
    setBusy(false);
  }

  console.log("[ConfigurePage] pipeline.result:", pipeline.result);
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Configure Pipeline</h1>
      <div style={{ color: "#666" }}>{repo}@{branch}</div>

      <label>
        Template
        <select value={pipeline.template} onChange={(e)=>pipeline.setTemplate(e.target.value)} style={{ display: "block", padding: 8 }}>
          <option value="node_app">Node.js</option>
        </select>
      </label>

      <div>
        <div>Stages</div>
        {(["build","test","deploy"] as const).map(s => (
          <label key={s} style={{ marginRight: 12 }}>
            <input type="checkbox" checked={pipeline.stages.includes(s)} onChange={()=>pipeline.toggleStage(s)} /> {s}
          </label>
        ))}
      </div>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
        <label>Node version
          <input value={pipeline.options.nodeVersion} onChange={(e)=>pipeline.setOption("nodeVersion", e.target.value)} />
        </label>
        <label>Install command
          <input value={pipeline.options.installCmd} onChange={(e)=>pipeline.setOption("installCmd", e.target.value)} />
        </label>
        <label>Test command
          <input value={pipeline.options.testCmd} onChange={(e)=>pipeline.setOption("testCmd", e.target.value)} />
        </label>
        <label>Build command
          <input value={pipeline.options.buildCmd} onChange={(e)=>pipeline.setOption("buildCmd", e.target.value)} />
        </label>
      </div>

      <label>
        AWS Role (OIDC)
        <select disabled={busy} value={pipeline.options.awsRoleArn ?? ""} onChange={(e)=>pipeline.setOption("awsRoleArn", e.target.value)} style={{ display: "block", padding: 8 }}>
          <option value="">-- select --</option>
          {pipeline.roles?.map((r) => (
            <option key={r.arn} value={r.arn}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onGenerate} disabled={busy}>{busy ? "Generating…" : "Generate Pipeline"}</button>
        <button
          onClick={() => {
            console.log("[ConfigurePage] Navigate button clicked.");
            console.log("[ConfigurePage] Pipeline result before navigating:", pipeline.result);
            try {
              navigate("/secrets", { state: { pipeline: pipeline.result } });
              console.log("[ConfigurePage] ✅ Navigation triggered successfully.");
            } catch (err) {
              console.error("[ConfigurePage] ❌ Navigation failed:", err);
            }
          }}
          disabled={
            !(
              pipeline.result?.yaml ||
              pipeline.result?.generated_yaml ||
              pipeline.result?.data?.generated_yaml
            )
          }
        >
          Continue → Secrets
        </button>
      </div>

      <div>
        <div>YAML Preview</div>
        <pre style={{ maxHeight: 400, overflow: "auto", background: "#f6f6f6", padding: 12 }}>
{pipeline.result?.yaml ?? pipeline.result?.generated_yaml ?? "Click Generate Pipeline to preview YAML…"}
        </pre>
      </div>
    </section>
  );
}
