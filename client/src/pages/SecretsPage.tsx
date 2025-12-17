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
  }, [repo]);

  const allGreen = useMemo(
    () =>
      (cfg.preflightResults?.length ?? 0) > 0 &&
      cfg.preflightResults!.every((r) => r.ok),
    [cfg.preflightResults]
  );

  if (!repo) return <p className="text-white">No repo selected.</p>;

  return (
    <div className="min-h-screen text-slate-100">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <h1 className="text-3xl font-semibold text-white">Secrets &amp; Preflight</h1>

        <section className="space-y-4 rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md shadow-glass p-6">
          <div className="space-y-1 text-sm">
            <p className="font-medium text-white">Connections</p>
            <p className="text-slate-200">
              GitHub App: {cfg.connections?.githubAppInstalled ? "✓" : "–"}
            </p>
            <p className="text-slate-200">
              Repo write: {cfg.connections?.githubRepoWriteOk ? "✓" : "–"}
            </p>
            <p className="text-slate-200">
              AWS OIDC:{" "}
              {cfg.connections?.awsOidc.connected
                ? `✓ (${cfg.connections.awsOidc.roleArn})`
                : "–"}
            </p>
          </div>

          <label className="grid gap-1 text-sm">
            <span className="text-slate-200">Environment</span>
            <select
              value={cfg.env}
              onChange={(e) => cfg.setEnv(e.target.value as any)}
              className="rounded-md border border-white/25 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="dev">dev</option>
              <option value="staging">staging</option>
              <option value="prod">prod</option>
            </select>
          </label>

          <div className="space-y-2">
            <p className="text-sm font-medium text-white">Required Secrets</p>
            <div className="rounded-md border border-white/20 bg-white/5">
              {cfg.secrets.length === 0 && (
                <div className="p-3 text-sm text-slate-300">No secrets required.</div>
              )}
              {cfg.secrets.map((s) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between border-b border-white/10 px-3 py-2 last:border-b-0"
                >
                  <span className="text-sm text-white">{s.key}</span>
                  <span className="text-sm">
                    {s.present ? (
                      <span className="text-emerald-300">Set ✓</span>
                    ) : (
                      <button
                        className="rounded-md bg-white/20 hover:bg-white/30 px-3 py-1 text-xs text-white"
                        onClick={() => setAdding(s.key)}
                      >
                        Add
                      </button>
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

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => cfg.runPreflight(repo!)}
              className="rounded-md bg-white/20 hover:bg-white/30 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Run Preflight
            </button>
            <Link to="/dashboard">
              <button
                disabled={!allGreen}
                className="rounded-md border border-white/40 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Continue → Dashboard
              </button>
            </Link>
          </div>

          <ul className="space-y-1 text-sm">
            {cfg.preflightResults?.map((r, i) => (
              <li key={i} className={r.ok ? "text-emerald-300" : "text-red-300"}>
                {r.label}
                {r.info ? ` — ${r.info}` : ""}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function SecretModal({
  keyName,
  onClose,
  onSave,
}: {
  keyName: string;
  onClose: () => void;
  onSave: (v: string) => Promise<void>;
}) {
  const [val, setVal] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-white/20 bg-white p-5 shadow-lg">
        <h3 className="text-lg font-semibold text-slate-900">
          Add secret: {keyName}
        </h3>
        <input
          type="password"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="mt-3 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              await onSave(val);
            }}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
