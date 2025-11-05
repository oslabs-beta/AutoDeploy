import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { usePipelineStore } from "../store/usePipelineStore";

export default function ConfigurePage() {
  const { repo, branch } = useRepoStore();
  const pipeline = usePipelineStore();

  // Load available AWS roles once
  useEffect(() => {
    pipeline.loadAwsRoles?.().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [busy, setBusy] = useState(false);

  async function onGenerate() {
    if (!repo || !branch) return;
    setBusy(true);
    await pipeline.regenerate({ repo, branch }).catch(console.error);
    setBusy(false);
  }

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
        <select value={pipeline.options.awsRoleArn ?? ""} onChange={(e)=>pipeline.setOption("awsRoleArn", e.target.value)} style={{ display: "block", padding: 8 }}>
          <option value="">-- select --</option>
          {pipeline.roles?.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onGenerate} disabled={busy}>{busy ? "Generating…" : "Generate Pipeline"}</button>
        <Link to="/secrets">
          <button disabled={!pipeline.result?.generated_yaml}>Continue → Secrets</button>
        </Link>
      </div>

      <div>
        <div>YAML Preview</div>
        <pre style={{ maxHeight: 400, overflow: "auto", background: "#f6f6f6", padding: 12 }}>
{pipeline.result?.generated_yaml ?? "Click Generate Pipeline to preview YAML…"}
        </pre>
      </div>
    </section>
  );
}
