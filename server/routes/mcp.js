import express from "express";
import { MCP_TOOLS } from "../tools/index.js";
import { requireSession } from "../lib/requireSession.js";

const router = express.Router();

// Utility logger
const logRequest = (req, route) => {
  console.log(`[MCP] ${new Date().toISOString()} | user=${req.headers["x-user-id"] || "anonymous"} | route=${route}`);
};

// --- MCP Status Route ---
router.get("/status", (req, res) => {
  logRequest(req, "/mcp/v1/status");

  res.json({
    status: "ok",
    version: "v1.0.0",
    tools_registered: Object.keys(MCP_TOOLS),
    timestamp: new Date().toISOString(),
  });
});

// --- GitHub adapter subcommands (explicit) ---
router.all("/github/:action", requireSession, async (req, res) => {
  logRequest(req, `/mcp/v1/github/${req.params.action}`);
  const tool = MCP_TOOLS["github"];
  if (!tool) {
    return res.status(404).json({ success: false, error: "Tool 'github' not found." });
  }
  try {
    const input = { ...req.query, ...req.body, action: req.params.action, user_id: req.user.user_id };
    const validatedInput = tool.input_schema.parse(input);
    const data = await tool.handler(validatedInput);
    res.json({ success: true, data });
  } catch (error) {
    console.error(`Error in github_adapter (${req.params.action}):`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Optional fallback: /mcp/v1/github -> default action 'repos'
router.all("/github", requireSession, async (req, res) => {
  logRequest(req, `/mcp/v1/github`);
  const tool = MCP_TOOLS["github"];
  if (!tool) {
    return res.status(404).json({ success: false, error: "Tool 'github' not found." });
  }
  try {
    const input = { ...req.query, ...req.body, action: req.query.action || "repos", user_id: req.user.user_id };
    const validatedInput = tool.input_schema.parse(input);
    const data = await tool.handler(validatedInput);
    res.json({ success: true, data });
  } catch (error) {
    console.error(`Error in github_adapter (default):`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Dynamic route: handles any tool in registry
router.all("/:tool_name", requireSession, async (req, res) => {
  const { tool_name } = req.params;
  const tool = MCP_TOOLS[tool_name];
  logRequest(req, `/mcp/v1/${tool_name}`);

  if (!tool) {
    return res.status(404).json({ success: false, error: `Tool '${tool_name}' not found.` });
  }

  try {
    // Merge query + body to handle GET or POST
    const input = { ...req.query, ...req.body };
    // Inject authenticated user's ID before validation
    input.user_id = req.user.user_id;
    const validatedInput = tool.input_schema.parse(input);
    const data = await tool.handler(validatedInput);
    res.json({ success: true, data });
  } catch (error) {
    console.error(`Error in ${tool_name}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;