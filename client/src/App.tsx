// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import ConnectPage from "./pages/ConnectPage";
import ConfigurePage from "./pages/ConfigurePage";
import SecretsPage from "./pages/SecretsPage";
import DashboardPage from "./pages/DashboardPage";
import Jenkins from "./routes/Jenkins";
import { useRepoStore } from "./store/useRepoStore";
import { usePipelineStore } from "./store/usePipelineStore";

// (optional) ShadCN test
// import { Button } from "@/components/ui/button";

function NeedRepo({ children }: { children: JSX.Element }) {
  const { repo, branch } = useRepoStore();
  return !repo || !branch ? <Navigate to="/connect" replace /> : children;
}
function NeedPipeline({ children }: { children: JSX.Element }) {
  const { result } = usePipelineStore();
  const hasYaml =
    result?.generated_yaml || result?.yaml || result?.data?.generated_yaml;
  return !hasYaml ? <Navigate to="/configure" replace /> : children;
}

export default function App() {
  return (
    <div className="relative min-h-screen text-white overflow-hidden">
      {/* Base gradient (covers entire viewport) */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-br from-slate-900 via-slate-800 to-gray-900" />
      {/* Frosted glass overlay */}
      <div className="fixed inset-0 -z-10 bg-white/10 backdrop-blur-3xl" />

      {/* App content above blur */}
      <div className="relative z-10">
        <BrowserRouter>
          <header className="border-b border-white/15 px-4 py-3 bg-white/5 backdrop-blur">
            <nav className="flex gap-5 text-sm">
              <Link className="text-white/80 hover:text-white" to="/connect">1 Connect</Link>
              <Link className="text-white/80 hover:text-white" to="/configure">2 Configure</Link>
              <Link className="text-white/80 hover:text-white" to="/secrets">3 Secrets</Link>
              <Link className="text-white/80 hover:text-white" to="/dashboard">4 Dashboard</Link>
             <Link className="text-white/80 hover:text-white" to="/jenkins">5 Jenkins</Link>
           </nav>
          </header>

          <main className="p-4 max-w-[960px] mx-auto">
            <Routes>
              <Route path="/" element={<Navigate to="/connect" replace />} />
              <Route path="/connect" element={<ConnectPage />} />
              <Route
                path="/configure"
                element={
                  <NeedRepo>
                    <ConfigurePage />
                  </NeedRepo>
                }
              />
              <Route
                path="/secrets"
                element={
                  <NeedRepo>
                    <NeedPipeline>
                      <SecretsPage />
                    </NeedPipeline>
                  </NeedRepo>
                }
              />
              <Route
                path="/dashboard"
                element={
                  <NeedRepo>
                    <DashboardPage />
                  </NeedRepo>
                }
              />
              <Route path="/jenkins" element={<Jenkins />} />
            </Routes>
          </main>
        </BrowserRouter>
      </div>
    </div>
  );
}
