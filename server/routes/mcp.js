import express from "express";
import { MCP_TOOLS } from "../tools/index.js";

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

// Dynamic route: handles any tool in registry
router.all("/:tool_name", async (req, res) => {
  const { tool_name } = req.params;
  const tool = MCP_TOOLS[tool_name];
  logRequest(req, `/mcp/v1/${tool_name}`);

  if (!tool) {
    return res.status(404).json({ success: false, error: `Tool '${tool_name}' not found.` });
  }

  try {
    // Merge query + body to handle GET or POST
    const input = { ...req.query, ...req.body };
    const validatedInput = tool.input_schema.parse(input);
    const data = await tool.handler(validatedInput);
    res.json({ success: true, data });
  } catch (error) {
    console.error(`Error in ${tool_name}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;