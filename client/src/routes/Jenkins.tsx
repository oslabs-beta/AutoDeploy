import { useState } from "react";
import { BASE } from "../lib/api";

const SERVER_BASE = BASE.replace(/\/api$/, "");

export default function Jenkins() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleAsk() {
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer("");
    try {
      const res = await fetch(`${SERVER_BASE}/jenkins/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ question: question.trim() }),
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
      <textarea
        rows={4}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask Jenkins about jobs or status"
        style={{ width: "100%", padding: 8, fontSize: 14 }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleAsk} disabled={loading || !question.trim()}>
          {loading ? "Sending..." : "Ask"}
        </button>
        <button
          type="button"
          onClick={() => {
            setQuestion("");
            setAnswer("");
            setError(null);
          }}
        >
          Clear
        </button>
      </div>
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
