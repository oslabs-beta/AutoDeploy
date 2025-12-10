import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useRepoStore } from "../store/useRepoStore";
import { useConfigStore } from "../store/useConfigStore";

export default function SecretsPage() {
  const { repo } = useRepoStore();
  const cfg = useConfigStore();
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (repo) cfg.load(repo).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]); //this line was causing the infinite loop
  //}, [repo, cfg.env]);

  const allGreen = useMemo(
    () => (cfg.preflightResults?.length ?? 0) > 0 && cfg.preflightResults!.every(r => r.ok),
    [cfg.preflightResults]
  );

  if (!repo) return <p>No repo selected.</p>;

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <h1>Secrets & Preflight</h1>

      <div>
        <strong>Connections:</strong>
        <div>GitHub App: {cfg.connections?.githubAppInstalled ? "✓" : "✗"}</div>
        <div>Repo write: {cfg.connections?.githubRepoWriteOk ? "✓" : "✗"}</div>
        <div>AWS OIDC: {cfg.connections?.awsOidc.connected ? `✓ (${cfg.connections.awsOidc.roleArn})` : "✗"}</div>
      </div>

      <label>
        Environment
        <select value={cfg.env} onChange={(e)=>cfg.setEnv(e.target.value as any)} style={{ display: "block", padding: 8 }}>
          <option value="dev">dev</option>
          <option value="staging">staging</option>
          <option value="prod">prod</option>
        </select>
      </label>

      <div>
        <strong>Required Secrets</strong>
        <div style={{ border: "1px solid #eee" }}>
          {cfg.secrets.length === 0 && <div style={{ padding: 8, color: "#666" }}>No secrets required.</div>}
          {cfg.secrets.map(s => (
            <div key={s.key} style={{ padding: 8, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between" }}>
              <span>{s.key}</span>
              <span>
                {s.present ? "Set ✓" : (
                  <button onClick={() => setAdding(s.key)}>Add</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {adding && (
        <SecretModal
          keyName={adding}
          onClose={() => setAdding(null)}
          onSave={async (val) => {
            await cfg.addOrUpdateSecret(repo!, adding, val);
            setAdding(null);
          }}
        />
      )}

      <div>
        <button onClick={()=>cfg.runPreflight(repo!)}>Run Preflight</button>{" "}
        <Link to="/dashboard"><button disabled={!allGreen}>Continue → Dashboard</button></Link>
      </div>

      <ul>
        {cfg.preflightResults?.map((r, i) => (
          <li key={i} style={{ color: r.ok ? "green" : "red" }}>
            {r.label}{r.info ? ` — ${r.info}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SecretModal({ keyName, onClose, onSave }: { keyName: string; onClose: ()=>void; onSave: (v: string)=>Promise<void>; }) {
  const [val, setVal] = useState("");
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)", display:"grid", placeItems:"center" }}>
      <div style={{ background:"#fff", padding:16, minWidth:360 }}>
        <h3>Add secret: {keyName}</h3>
        <input type="password" value={val} onChange={(e)=>setVal(e.target.value)} style={{ width:"100%", padding:8, marginTop:8 }} />
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:12 }}>
          <button onClick={onClose}>Cancel</button>
          <button onClick={async ()=>{ await onSave(val); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
