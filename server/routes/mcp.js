import express from 'express';
import { MCP_TOOLS } from '../tools/index.js';
import { requireSession } from '../lib/requireSession.js';
import { Actions, requireCapability } from '../lib/authorization.js';
import { ApiError, sendErrorV1, sendSuccessV1 } from '../lib/httpEnvelope.js';

const router = express.Router();



// Utility logger
const logRequest = (req, route) => {
  console.log(
    `[MCP] ${new Date().toISOString()} | user=${
      req.headers['x-user-id'] || 'anonymous'
    } | route=${route}`
  );
};

// --- MCP Status Route ---
router.get('/status', (req, res) => {
  logRequest(req, '/mcp/v1/status');

  // v1 is kept for backwards compatibility. Prefer /mcp/v2 for new clients.
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', '</mcp/v2/status>; rel="successor-version"');

  sendSuccessV1(req, res, {
    status: 'ok',
    version: 'v1.0.0',
    deprecated: true,
    successor: { base: '/mcp/v2', status: '/mcp/v2/status', tools: '/mcp/v2/tools' },
    tools_registered: Object.keys(MCP_TOOLS),
    timestamp: new Date().toISOString(),
  });
});

// --- GitHub adapter subcommands (explicit) ---
router.all(
  '/github/:action',
  requireSession,
  requireCapability(Actions.USE_MCP_TOOL),
  async (req, res) => {
  logRequest(req, `/mcp/v1/github/${req.params.action}`);
  const tool = MCP_TOOLS['github'];
  if (!tool) {
    return sendErrorV1(
      req,
      res,
      new ApiError({ status: 404, code: 'NOT_FOUND', message: "Tool 'github' not found." })
    );
  }
  try {
    const input = {
      ...req.query,
      ...req.body,
      action: req.params.action,
      user_id: req.user.user_id,
      username: req.user.github_username
    };
    const validatedInput = tool.input_schema.parse(input);
    const data = await tool.handler(validatedInput);
    sendSuccessV1(req, res, data);
  } catch (error) {
    console.error(`Error in github_adapter (${req.params.action}):`, error);
    return sendErrorV1(req, res, error);
  }
});

// Optional fallback: /mcp/v1/github -> default action 'repos'
router.all(
  '/github',
  requireSession,
  requireCapability(Actions.USE_MCP_TOOL),
  async (req, res) => {
  logRequest(req, `/mcp/v1/github`);
  const tool = MCP_TOOLS['github'];
  if (!tool) {
    return sendErrorV1(
      req,
      res,
      new ApiError({ status: 404, code: 'NOT_FOUND', message: "Tool 'github' not found." })
    );
  }
  try {
    const input = {
      ...req.query,
      ...req.body,
      action: req.query.action || "repos",
      user_id: req.user.user_id,
      username: req.user.github_username
    };
    const validatedInput = tool.input_schema.parse(input);
    const data = await tool.handler(validatedInput);
    sendSuccessV1(req, res, data);
  } catch (error) {
    console.error(`Error in github_adapter (default):`, error);
    return sendErrorV1(req, res, error);
  }
});

// Dynamic route: handles any tool in registry
router.all(
  '/:tool_name',
  requireSession,
  requireCapability(Actions.USE_MCP_TOOL),
  async (req, res) => {
  const { tool_name } = req.params;
  const tool = MCP_TOOLS[tool_name];
  logRequest(req, `/mcp/v1/${tool_name}`);

  // Debug: log what the tool object looks like to catch mis-exports
  if (!tool || typeof tool.handler !== "function") {
    console.warn("[MCP] tool missing or has no handler:", {
      tool_name,
      tool_keys: tool ? Object.keys(tool) : null,
      tool_type: typeof tool,
    });
  }

  if (!tool) {
    return sendErrorV1(
      req,
      res,
      new ApiError({ status: 404, code: 'NOT_FOUND', message: `Tool '${tool_name}' not found.` })
    );
  }

  try {
    // Merge query + body to handle GET or POST, inject user_id and username
    const input = {
      ...req.query,
      ...req.body,
      user_id: req.user.user_id,
      username: req.user.github_username
    };
    const validatedInput = tool.input_schema.parse(input);
    const data = await tool.handler(validatedInput);
    sendSuccessV1(req, res, data);
  } catch (error) {
    console.error(`Error in ${tool_name}:`, error);
    return sendErrorV1(req, res, error);
  }
});

export default router;
