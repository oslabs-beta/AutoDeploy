import { useEffect } from "react";
import { useRepoStore } from "../store/useRepoStore";
// import { useDeployStore } from "@/stores/deploy";

export default function DeployPage() {
  const { repo, branch } = useRepoStore();
  // const { roles, loadRoles, selectedRole, setRole, openPr, loading, error } = useDeployStore();

  useEffect(() => {
    // loadRoles();
  }, []);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      {!repo || !branch ? (
        <p className="text-sm text-orange-700">Pick a repo/branch on Connect first.</p>
      ) : (
        <p className="text-sm opacity-80">Deploying <strong>{repo}</strong> @ <strong>{branch}</strong></p>
      )}

      {/* role picker + open PR button go here, wired to your deploy store */}
    </div>
  );
}
