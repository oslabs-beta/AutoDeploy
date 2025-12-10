import { useEffect, useState } from 'react';
// Added by Lorenc
import { BASE, startGitHubOAuth } from '../lib/api';

/**
 * Shows a "Connect GitHub" button if the user is not logged in.
 * After OAuth, the server sets the `mcp_session` cookie and this
 * component will show a "✓ GitHub connected" badge.
 */
export default function ConnectGithub() {
  const [session, setSession] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Ask the backend if we have a session.
    // fetch("/mcp/v1/status", { credentials: "include" })
    fetch(`${BASE}/mcp/v1/status`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => setSession(Boolean(j?.session)))
      .catch(() => setSession(false));
  }, []);

  const startOAuth = () => {
    setLoading(true);
    // After GitHub completes, the server redirects back here.
    // const redirectTo = encodeURIComponent(window.location.origin + "/connect");
    // window.location.href = `/auth/github/start?redirect_to=${redirectTo}`;
    const redirectTo = window.location.origin + '/connect';
    startGitHubOAuth(redirectTo);
  };

  if (session === null) return null; // or a small skeleton/spinner

  return session ? (
    <span className="inline-flex items-center text-green-600 text-sm">
      <span className="w-2 h-2 rounded-full bg-green-600 mr-2" />✓ GitHub
      connected
    </span>
  ) : (
    <button
      onClick={startOAuth}
      disabled={loading}
      className="px-4 py-2 rounded-2xl bg-black text-white hover:opacity-90"
    >
      {loading ? 'Redirecting…' : 'Connect GitHub'}
    </button>
  );
}
