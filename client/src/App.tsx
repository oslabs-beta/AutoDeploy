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
import { Button } from "@/components/ui/Button";

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
  const { user, refreshMe, signOut, startGoogleLogin } = useAuthStore();

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
              <Button
                size="sm"
                variant="glass"
                className="px-2 py-1 h-auto"
                aria-label="Sign in with Google"
                onClick={() =>
                  startGoogleLogin(`${window.location.origin}/connect`)
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  className="h-4 w-4"
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.15 0 5.98 1.08 8.21 3.2l6.15-6.15C34.93 3.05 29.87 1 24 1 14.95 1 6.8 5.92 2.74 13.26l7.18 5.58C11.58 13.08 17.27 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.5 24c0-1.55-.14-3.04-.39-4.5H24v9h12.7c-.55 2.93-2.24 5.42-4.74 7.08l7.18 5.58C43.66 37.4 46.5 31.17 46.5 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.92 28.74c-.5-1.47-.79-3.03-.79-4.74s.29-3.27.79-4.74l-7.18-5.58C2.64 16.37 1.5 20.06 1.5 24s1.14 7.63 3.24 10.32l6.18-5.58z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 46.5c6.48 0 11.91-2.14 15.88-5.81l-7.18-5.58c-2 1.35-4.56 2.14-8.7 2.14-6.73 0-12.42-3.58-15.08-8.84l-7.18 5.58C6.8 42.08 14.95 46.5 24 46.5z"
                  />
                  <path fill="none" d="M1.5 1.5h45v45h-45z" />
                </svg>
              </Button>
              {user?.user_id && (
                <Button
                  size="sm"
                  variant="glass"
                  onClick={async () => {
                    await signOut();
                    navigate("/login", { replace: true });
                  }}
                  className="px-3 py-1 h-auto"
                >
                  Log out
                </Button>
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
