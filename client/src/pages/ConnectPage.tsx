import { useEffect } from "react";
import { GlassButton } from "../components/ui/GlassButton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useRepoStore } from "@/store/useRepoStore";
import { useAuthStore } from "@/store/useAuthStore";

export default function ConnectPage() {
  const {
    repos,
    branches,
    repo,
    branch,
    loading,
    connected,
    setRepo,
    setBranch,
    loadRepos,
    loadBranches,
  } = useRepoStore();
  const { user, refreshMe } = useAuthStore();

  const handleGithubConnect = () => {
    window.location.href = "http://localhost:3000/auth/github/start";
  };

  // On first load, hydrate the user session.
  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  // After we know the user, automatically load repos and (if needed) branches
  // so that "Continue to Configure" is ready with minimal clicks.
  useEffect(() => {
    if (!user || loading) return;

    // Always ensure repos are loaded when the list is empty.
    // `api.listRepos` has its own in-memory cache, so repeat calls are cheap.
    if (!repos.length) {
      void loadRepos();
      return;
    }

    // If we already have a repo selected (from localStorage) but no branches
    // in memory yet, hydrate them so branch + Continue are ready.
    if (repo && !branches.length) {
      void loadBranches(repo);
    }
  }, [user, repos.length, repo, branches.length, loading, loadRepos, loadBranches]);

  return (
    <div className="max-w-3xl mx-auto p-6 mt-10">
      <div className="rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md shadow-glass p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold text-white/90">
              Connect your repository
            </h1>
            {user?.email && (
              <span className="text-xs text-white/70 mt-1">
                Signed in as {user.email}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <GlassButton
              className="bg-emerald-400/20 hover:bg-emerald-400/30 text-emerald-50"
              onClick={handleGithubConnect}
            >
              Connect GitHub
            </GlassButton>

            <GlassButton
              variant="secondary"
              className="bg-white/20 hover:bg-white/30 text-white"
              onClick={() => {
                loadRepos();
              }}
            >
              Re-sync Repos
            </GlassButton>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label className="text-white/80">Repository</Label>
            <Select
              value={repo ?? ""}
              onValueChange={(v) => {
                setRepo(v);
                loadBranches(v);
              }}
            >
              <SelectTrigger className="bg-white/10 border-white/20 text-white">
                <SelectValue placeholder="Select a repo" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 text-white border-white/20">
                {repos?.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label className="text-white/80">Branch</Label>
            <Select
              value={branch ?? ""}
              onValueChange={setBranch}
              disabled={!repo}
            >
              <SelectTrigger className="bg-white/10 border-white/20 text-white disabled:opacity-50">
                <SelectValue
                  placeholder={repo ? "Select a branch" : "Pick a repo first"}
                />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 text-white border-white/20">
                {branches?.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-8">
          <GlassButton
            className="bg-white/20 hover:bg-white/30 text-white"
            disabled={!repo || !branch}
            onClick={() => location.assign("/configure")}
          >
            Continue to Configure
          </GlassButton>
        </div>
      </div>
    </div>
  );
}
