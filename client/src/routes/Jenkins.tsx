import { useEffect, useState } from "react";
import { BASE } from "../lib/api";

const SERVER_BASE = BASE.replace(/\/api$/, "");
const MCP_URL_FALLBACK = "http://192.168.1.35/mcp-server/mcp";
const MCP_URL_GENERAL_HINT = "Enter the MCP server URL (e.g. https://<host>/mcp-server/mcp)";

export default function Jenkins() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mcpUrl, setMcpUrl] = useState(MCP_URL_FALLBACK);
  const [jenkinsToken, setJenkinsToken] = useState("");
  const [mcpUrlHint, setMcpUrlHint] = useState(MCP_URL_FALLBACK);
  const [tokenHint, setTokenHint] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadHints() {
      try {
        const res = await fetch(`${SERVER_BASE}/jenkins/config`, {
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error(res.statusText);
        }
        const data = await res.json().catch(() => ({}));
        if (!isMounted) return;
        const hintUrl = data?.mcpUrlHint || MCP_URL_FALLBACK;
        const hintToken = data?.tokenHint || "";
        setMcpUrlHint(hintUrl);
        setTokenHint(hintToken);
        setMcpUrl(hintUrl);
        setJenkinsToken(hintToken);
        setConfigError(null);
      } catch (err: any) {
        if (!isMounted) return;
        setConfigError(err?.message || "Unable to load Jenkins defaults");
      }
    }

    loadHints();
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleAsk() {
    if (!question.trim() || !mcpUrl.trim() || !jenkinsToken.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer("");
    try {
      const res = await fetch(`${SERVER_BASE}/jenkins/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          question: question.trim(),
          mcpUrl: mcpUrl.trim() || undefined,
          token: jenkinsToken.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.error || res.statusText);
      setAnswer(data?.answer ?? "");
    } catch (err: any) {
      setError(err?.message ?? "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 12 }}>
      <h1>Jenkins</h1>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontWeight: 500 }}>MCP URL</span>
        <input
          type="text"
          value={mcpUrl}
          onChange={(e) => setMcpUrl(e.target.value)}
          placeholder={MCP_URL_GENERAL_HINT}
          style={{ width: "100%", padding: 8, fontSize: 14 }}
        />
        <span style={{ fontSize: 12, color: "#555" }}>
          Hint: {MCP_URL_GENERAL_HINT}
        </span>
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontWeight: 500 }}>Jenkins Token</span>
        <input
          type="password"
          value={jenkinsToken}
          onChange={(e) => setJenkinsToken(e.target.value)}
          placeholder={tokenHint || "Enter Jenkins token"}
          style={{ width: "100%", padding: 8, fontSize: 14 }}
        />
        <span style={{ fontSize: 12, color: "#555" }}>
          Hint: {tokenHint ? tokenHint : "Set JENKINS_TOKEN to prefill"}
        </span>
      </label>
      <textarea
        rows={4}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask Jenkins about jobs or status"
        style={{ width: "100%", padding: 8, fontSize: 14 }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleAsk}
          disabled={
            loading || !question.trim() || !mcpUrl.trim() || !jenkinsToken.trim()
          }
        >
          {loading ? "Sending..." : "Ask"}
        </button>
        <button
          type="button"
          onClick={() => {
            setQuestion("");
            setAnswer("");
            setError(null);
            setMcpUrl(mcpUrlHint);
            setJenkinsToken(tokenHint);
          }}
        >
          Clear
        </button>
      </div>
      {configError && (
        <div style={{ color: "#a67c00", fontSize: 13 }}>
          Using fallback MCP defaults: {configError}
        </div>
      )}
      {error && <div style={{ color: "red", fontSize: 13 }}>{error}</div>}
      <textarea
        readOnly
        value={answer}
        placeholder="Jenkins response will appear here"
        rows={6}
        style={{ width: "100%", padding: 8, fontSize: 14, background: "#f6f6f6" }}
      />
    </section>
  );
}
