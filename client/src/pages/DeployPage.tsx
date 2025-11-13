import { useEffect } from "react";
import { useRepoStore } from "../store/useRepoStore";
// import { useDeployStore } from "@/stores/deploy";

export default function DeployPage() {
  const { repo, branch } = useRepoStore();
  // const { roles, loadRoles, selectedRole, setRole, openPr, loading, error } = useDeployStore();

  useEffect(() => {
    // loadRoles();
  }, []);

  function startCommit() {
    // Placeholder function to start commit process
    console.log("Commit to GitHub started");
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <h2 className="text-lg font-semibold">Commit Workflow to GitHub</h2>
      {!repo || !branch ? (
        <p className="text-sm text-orange-700">Pick a repo/branch on Connect first.</p>
      ) : (
        <>
          <p className="text-sm opacity-80">Committing workflow to <strong>GitHub</strong> for <strong>{repo}</strong> @ <strong>{branch}</strong></p>
          <button
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={startCommit}
          >
            Commit to GitHub
          </button>
        </>
      )}

      {/* role picker + commit to GitHub button go here, wired to your deploy store */}
    </div>
  );
}
