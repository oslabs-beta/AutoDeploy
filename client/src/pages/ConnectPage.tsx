import { useEffect } from "react";
import { Link } from "react-router-dom";
import { startGitHubOAuth } from "../lib/api";
import { useRepoStore } from "../store/useRepoStore";

export default function ConnectPage() {
  const {
    connected, repo, branch, repos, branches, loading, error,
    loadRepos, loadBranches, setRepo, setBranch,
  } = useRepoStore();

  useEffect(() => {
    if (!connected && repos.length === 0) {
      loadRepos();
    }
  }, [connected, repos.length, loadRepos]);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <button
          className="px-3 py-2 rounded bg-black text-white"
          onClick={() => (connected ? loadRepos() : startGitHubOAuth(window.location.origin))}
          disabled={loading}
        >
          {connected ? "Re-sync Repos" : "Connect to GitHub"}
        </button>
        {loading && <span className="text-sm opacity-70">Loading…</span>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {repos.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm block mb-1">Repository</label>
            <select
              className="border rounded px-2 py-1 w-full"
              value={repo ?? ""}
              onChange={(e) => {
                const r = e.target.value || null;
                setRepo(r);
                if (r) loadBranches(r);
              }}
            >
              <option value="" disabled>Select a repo</option>
              {repos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm block mb-1">Branch</label>
            <select
              className="border rounded px-2 py-1 w-full"
              value={branch ?? ""}
              onChange={(e) => setBranch(e.target.value || null)}
              disabled={!repo || branches.length === 0}
            >
              <option value="" disabled>Select a branch</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <Link to="/configure">
              <button
                className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                disabled={!repo || !branch}
              >
                Continue → Configure
              </button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
