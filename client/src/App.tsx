// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import ConnectPage from "./pages/ConnectPage";
import ConfigurePage from "./pages/ConfigurePage";
import SecretsPage from "./pages/SecretsPage";
import DashboardPage from "./pages/DashboardPage";
import { useRepoStore } from "./store/useRepoStore";
import { usePipelineStore } from "./store/usePipelineStore";

function NeedRepo({ children }: { children: JSX.Element }) {
  const { repo, branch } = useRepoStore();
  return !repo || !branch ? <Navigate to="/connect" replace /> : children;
}
function NeedPipeline({ children }: { children: JSX.Element }) {
  const { result } = usePipelineStore();
  const hasYaml =
    result?.generated_yaml ||
    result?.yaml ||
    result?.data?.generated_yaml;

  return !hasYaml ? <Navigate to="/configure" replace /> : children;
}

export default function App() {
  return (
    <BrowserRouter>
      <header style={{ borderBottom: "1px solid #eee", padding: "12px" }}>
        <nav style={{ display: "flex", gap: 12, fontSize: 14 }}>
          <Link to="/connect">1 Connect</Link>
          <Link to="/configure">2 Configure</Link>
          <Link to="/secrets">3 Secrets</Link>
          <Link to="/dashboard">4 Dashboard</Link>
        </nav>
      </header>
      <main style={{ padding: 16, maxWidth: 960, margin: "0 auto" }}>
        <Routes>
          <Route path="/" element={<Navigate to="/connect" replace />} />
          <Route path="/connect" element={<ConnectPage />} />
          <Route path="/configure" element={<NeedRepo><ConfigurePage /></NeedRepo>} />
          <Route path="/secrets" element={<NeedRepo><NeedPipeline><SecretsPage /></NeedPipeline></NeedRepo>} />
          <Route path="/dashboard" element={<NeedRepo><DashboardPage /></NeedRepo>} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
