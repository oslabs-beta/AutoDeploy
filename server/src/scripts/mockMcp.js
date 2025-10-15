import express from "express";

const app = express();
app.use(express.json());

// Simple auth check middleware
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("❌ Missing or invalid Authorization header");
    return res.status(403).json({ error: "Forbidden: Missing or invalid API key" });
  }

  const token = authHeader.split(" ")[1];

  // Simulate key check (you can later load this from .env)
  if (token.trim() !== "dev-key-123") {
    console.log("❌ Invalid token received:", token);
    return res.status(403).json({ error: "Forbidden: Invalid API key" });
  }

  console.log("Authorized token recieved");
  next();
});

// Mock pipeline endpoint
app.post("/api/pipeline", (req, res) => {
  const { repo, branch, service } = req.body || {};

  console.log(`✅ Authorized request for ${service} on branch ${branch}`);

  res.json({
    status: "ok",
    received: { repo, branch, service },
    plan: {
      checks: ["lint", "test"],
      ci: "github-actions",
      deploy: "aws-oidc",
      notes: "Mock MCP success (authorized)"
    }
  });
});

const PORT = 7070;
app.listen(PORT, () => console.log(`🧪 Mock MCP running with auth on port ${PORT}`));
