import { GlassButton } from '../components/ui/GlassButton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { useRepoStore } from '@/store/useRepoStore';

// Added by Lorenc
import { startGitHubOAuth } from '@/lib/api';

export default function ConnectPage() {
  const {
    repos,
    branches,
    repo,
    branch,
    setRepo,
    setBranch,
    loadRepos,
    loadBranches,
  } = useRepoStore();

  const handleGithubConnect = () => {
    // Vite proxy sends this to backend http://localhost:3001/auth/github
    // window.location.href = "http://localhost:3000/auth/github/start";

    // After GitHub completes, the server redirects back here.
    const redirectTo = window.location.origin + '/connect';
    startGitHubOAuth(redirectTo);
  };

  return (
    <div className="max-w-3xl mx-auto p-6 mt-10">
      <div className="rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md shadow-glass p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <h1 className="text-xl font-semibold text-white/90">
            Connect your repository
          </h1>

          <div className="flex gap-2">
            {/* 🔐 OAuth button */}
            <GlassButton
              className="bg-emerald-400/20 hover:bg-emerald-400/30 text-emerald-50"
              onClick={handleGithubConnect}
            >
              Connect GitHub
            </GlassButton>

            {/* 🔁 Re-sync repos */}
            <GlassButton
              variant="secondary"
              className="bg-white/20 hover:bg-white/30 text-white"
              onClick={() => {
                console.log('[Page] Re-sync clicked');
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
              value={repo ?? ''}
              onValueChange={(v) => {
                console.log('[Page] Repo selected:', v);
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
              value={branch ?? ''}
              onValueChange={setBranch}
              disabled={!repo}
            >
              <SelectTrigger className="bg-white/10 border-white/20 text-white disabled:opacity-50">
                <SelectValue
                  placeholder={repo ? 'Select a branch' : 'Pick a repo first'}
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
            onClick={() => location.assign('/configure')}
          >
            Continue → Configure
          </GlassButton>
        </div>
      </div>
    </div>
  );
}

// import { GlassButton } from "../components/ui/GlassButton";
// import { Button } from "@/components/ui/button";
// import { Label } from "@/components/ui/label";
// import {
//   Select, SelectTrigger, SelectValue, SelectContent, SelectItem
// } from "@/components/ui/select";
// import { useRepoStore } from "@/store/useRepoStore";

// export default function ConnectPage() {
//   const { repos, branches, repo, branch, setRepo, setBranch, loadRepos, loadBranches } = useRepoStore();

//   return (
//     <div className="max-w-3xl mx-auto p-6 mt-10">
//       <div className="rounded-2xl border border-white/20 bg-white/10 backdrop-blur-md shadow-glass p-6">
//         <div className="flex items-center justify-between mb-6">
//           <h1 className="text-xl font-semibold text-white/90">Connect your repository</h1>
//           <GlassButton
//             variant="secondary"
//             className="bg-white/20 hover:bg-white/30 text-white"
//             onClick={loadRepos}
//           >
//             Re-sync Repos
//           </GlassButton>
//         </div>

//         <div className="grid gap-4 md:grid-cols-2">
//           <div className="grid gap-2">
//             <Label className="text-white/80">Repository</Label>
//             <Select
//               value={repo ?? ""}
//               onValueChange={(v) => { setRepo(v); loadBranches(v); }}
//             >
//               <SelectTrigger className="bg-white/10 border-white/20 text-white">
//                 <SelectValue placeholder="Select a repo" />
//               </SelectTrigger>
//               <SelectContent className="bg-slate-900 text-white border-white/20">
//                 {repos?.map((r) => (
//                   <SelectItem key={r} value={r}>{r}</SelectItem>
//                 ))}
//               </SelectContent>
//             </Select>
//           </div>

//           <div className="grid gap-2">
//             <Label className="text-white/80">Branch</Label>
//             <Select
//               value={branch ?? ""}
//               onValueChange={setBranch}
//               disabled={!repo}
//             >
//               <SelectTrigger className="bg-white/10 border-white/20 text-white disabled:opacity-50">
//                 <SelectValue placeholder={repo ? "Select a branch" : "Pick a repo first"} />
//               </SelectTrigger>
//               <SelectContent className="bg-slate-900 text-white border-white/20">
//                 {branches?.map((b) => (
//                   <SelectItem key={b} value={b}>{b}</SelectItem>
//                 ))}
//               </SelectContent>
//             </Select>
//           </div>
//         </div>

//         <div className="mt-8">
//           <GlassButton
//             className="bg-white/20 hover:bg-white/30 text-white"
//             disabled={!repo || !branch}
//             onClick={() => location.assign("/configure")}
//           >
//             Continue → Configure
//           </GlassButton>
//         </div>
//       </div>
//     </div>
//   );
// }
