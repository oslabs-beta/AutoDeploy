// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import ConnectPage from "./pages/ConnectPage";
import ConfigurePage from "./pages/ConfigurePage";
import SecretsPage from "./pages/SecretsPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import { useRepoStore } from "./store/useRepoStore";
import { usePipelineStore } from "./store/usePipelineStore";
import { useAuthStore } from "./store/useAuthStore";
import { useEffect } from "react";

function NeedRepo({ children }: { children: JSX.Element }) {
  const { repo, branch } = useRepoStore();
  return !repo || !branch ? <Navigate to="/connect" replace /> : children;
}
function NeedPipeline({ children }: { children: JSX.Element }) {
  const { result } = usePipelineStore();
  const hasYaml = result?.generated_yaml || result?.yaml || result?.data?.generated_yaml;
  return !hasYaml ? <Navigate to="/configure" replace /> : children;
}

// optional: simple active-link helper
function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={
        "transition-colors " +
        (active
          ? "text-white"
          : "text-slate-200/80 hover:text-white")
      }
    >
      {children}
    </Link>
  );
}

export default function App() {
  return (
    <div className="relative min-h-screen text-slate-100 overflow-hidden">
      {/* Base gradient */}
      <div className="fixed inset-0 -z-20 bg-gradient-to-br from-slate-900 via-slate-800 to-gray-900" />
      {/* Subtle dark veil for contrast */}
      <div className="fixed inset-0 -z-10 bg-black/20" />
      {/* Frosted glass shimmer – IMPORTANT: pointer-events-none so it never blocks clicks */}
      <div className="fixed inset-0 -z-10 bg-white/10 backdrop-blur-3xl pointer-events-none" />

      {/* App content above blur */}
      <div className="relative z-10">
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </div>
    </div>
  );
}

function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const showNav = pathname !== "/login";
  const { user, refreshMe, signOut } = useAuthStore();

  useEffect(() => {
    if (!showNav) return;
    refreshMe().catch(() => undefined);
  }, [showNav, refreshMe]);

  return (
    <>
      {showNav && (
        <header className="border-b border-white/15 px-4 py-3 bg-white/5 backdrop-blur">
          <nav className="flex items-center gap-5 text-sm">
            <NavLink to="/connect">1 Connect</NavLink>
            <NavLink to="/configure">2 Configure</NavLink>
            <NavLink to="/secrets">3 Secrets</NavLink>
            <NavLink to="/dashboard">4 Dashboard</NavLink>
            <div className="ml-auto flex items-center gap-3">
              {user?.email && (
                <span className="text-slate-200/80 text-xs truncate max-w-[240px]">
                  {user.email}
                </span>
              )}
              {user?.user_id && (
                <button
                  type="button"
                  onClick={async () => {
                    await signOut();
                    navigate("/login", { replace: true });
                  }}
                  className="text-slate-200/80 hover:text-white transition-colors"
                >
                  Log out
                </button>
              )}
            </div>
          </nav>
        </header>
      )}

      <main className="p-4 md:p-6 max-w-[960px] mx-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
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
        </Routes>
      </main>
    </>
  );
}
