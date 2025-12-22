import express from 'express';
import { MCP_TOOLS } from '../tools/index.js';
import { requireSession } from '../lib/requireSession.js';
import { Actions, requireCapability } from '../lib/authorization.js';

const router = express.Router();

// --- Response helpers ---
const sendSuccess = (req, res, data, status = 200) =>
  res.status(status).json({ success: true, data, request_id: req.requestId });

const sendError = (
  req,
  res,
  status = 500,
  code = 'INTERNAL',
  message = 'Internal error',
  details = undefined
) =>
  res
    .status(status)
    .json({ success: false, error: { code, message, details }, request_id: req.requestId });

const mapError = (err) => {
  if (err?.name === 'ZodError') {
    return {
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Invalid input',
      details: err.issues || err.errors || err.message,
    };
  }
  return {
    status: err?.status || 500,
    code: err?.code || 'INTERNAL',
    message: err?.message || 'Internal error',
    details: err?.details,
  };
};

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

  sendSuccess(req, res, {
    status: 'ok',
    version: 'v1.0.0',
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
    return sendError(
      req,
      res,
      404,
      'NOT_FOUND',
      "Tool 'github' not found."
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
    sendSuccess(req, res, data);
  } catch (error) {
    console.error(`Error in github_adapter (${req.params.action}):`, error);
    const { status, code, message, details } = mapError(error);
    sendError(req, res, status, code, message, details);
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
    return sendError(
      req,
      res,
      404,
      'NOT_FOUND',
      "Tool 'github' not found."
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
    sendSuccess(req, res, data);
  } catch (error) {
    console.error(`Error in github_adapter (default):`, error);
    const { status, code, message, details } = mapError(error);
    sendError(req, res, status, code, message, details);
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
    return sendError(
      req,
      res,
      404,
      'NOT_FOUND',
      `Tool '${tool_name}' not found.`
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
    sendSuccess(req, res, data);
  } catch (error) {
    console.error(`Error in ${tool_name}:`, error);
    const { status, code, message, details } = mapError(error);
    sendError(req, res, status, code, message, details);
  }
});

export default router;
