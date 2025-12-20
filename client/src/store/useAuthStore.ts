import { create } from "zustand";

type AuthUser = {
  user_id?: string;
  email?: string | null;
  github_username?: string | null;
} | null;

type AuthState = {
  user: AuthUser;
  loading: boolean;
  error: string | null;
};

type AuthActions = {
  refreshMe(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  startGitHubLogin(redirectTo?: string): void;
  clear(): void;
};

const DEFAULT_API_BASE = import.meta.env.MODE === "development" ? "/api" : "";
const BASE = import.meta.env.VITE_API_BASE || DEFAULT_API_BASE;
const SERVER_BASE = BASE.endsWith("/api") ? BASE.slice(0, -4) : BASE;

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  user: null,
  loading: false,
  error: null,

  async refreshMe() {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${BASE}/me`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return set({ user: null, error: null });
      set({ user: (data as any)?.user ?? data ?? null, error: null });
    } catch (err: any) {
      set({ user: null, error: err?.message || "Failed to load session" });
    } finally {
      set({ loading: false });
    }
  },

  async signIn(email: string, password: string) {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${SERVER_BASE}/auth/local/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || res.statusText);
      set({ user: (data as any)?.user ?? null, error: null });
    } catch (err: any) {
      set({ user: null, error: err?.message || "Login failed" });
    } finally {
      set({ loading: false });
    }
  },

  async signUp(email: string, password: string) {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${SERVER_BASE}/auth/local/signup`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || res.statusText);
      set({ user: (data as any)?.user ?? null, error: null });
    } catch (err: any) {
      set({ user: null, error: err?.message || "Signup failed" });
    } finally {
      set({ loading: false });
    }
  },

  async signOut() {
    set({ loading: true, error: null });
    try {
      await fetch(`${SERVER_BASE}/auth/local/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      set({ user: null, loading: false, error: null });
    }
  },

  startGitHubLogin(redirectTo?: string) {
    const target = redirectTo || window.location.origin;
    window.location.href = `${SERVER_BASE}/auth/github/start?redirect_to=${encodeURIComponent(
      target
    )}`;
  },

  clear() {
    set({ user: null, error: null, loading: false });
  },
}));
