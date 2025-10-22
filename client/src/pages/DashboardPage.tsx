import { useEffect } from "react";
import { useRepoStore } from "../store/useRepoStore";
import { usePipelineStore } from "../store/usePipelineStore";
import { useConfigStore } from "../store/useConfigStore";
import { useDeployStore } from "../store/useDeployStore";

export default function DashboardPage() {
  const { repo } = useRepoStore();
  const { result } = usePipelineStore();
  const cfg = useConfigStore();

  // Select stable slices from the deploy store to avoid effect loops
  const running = useDeployStore((s) => s.running);
  const events = useDeployStore((s) => s.events);
  const startDeploy = useDeployStore((s) => s.startDeploy);
  const stop = useDeployStore((s) => s.stop);
  const clear = useDeployStore((s) => s.clear);

  // Clear logs on unmount only
  useEffect(() => {
    return () => {
      clear?.();
    };
  }, []);

  if (!repo) return <p>No repo selected.</p>;

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Pipeline Dashboard</h1>

      <div>
        <strong>Current Pipeline</strong>
        <div style={{ color: "#666", fontSize: 12 }}>
          {result?.pipeline_name} · Generated {result ? new Date(result.created_at).toLocaleString() : "—"}
        </div>
        <pre style={{ maxHeight: 280, overflow: "auto", background: "#f6f6f6", padding: 12 }}>
{result?.generated_yaml ?? "No pipeline generated yet."}
        </pre>
      </div>

      <div>
        <button
          disabled={running}
          onClick={() => startDeploy({ repo: repo!, env: cfg.env })}
        >
          {running ? "Deploying…" : "Deploy to AWS"}
        </button>
        {running && <button onClick={stop} style={{ marginLeft: 8 }}>Stop</button>}
      </div>

      <div>
        <strong>Logs</strong>
        <div style={{ height: 280, overflow: "auto", background: "#111", color: "#ddd", padding: 12, fontFamily: "monospace", fontSize: 12 }}>
          {events.length === 0 ? "No logs yet." :
            events.map((e, i) => (
              <div key={i}>[{new Date(e.ts).toLocaleTimeString()}] {e.level.toUpperCase()}: {e.msg}</div>
            ))
          }
        </div>
      </div>
    </section>
  );
}
