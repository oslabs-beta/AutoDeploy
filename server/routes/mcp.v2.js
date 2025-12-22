import express from 'express';
import { MCP_TOOLS } from '../tools/index.js';
import { requireSession } from '../lib/requireSession.js';
import { Actions, requireCapability } from '../lib/authorization.js';
import { ApiError, sendError, sendOk } from '../lib/httpEnvelope.js';

const router = express.Router();

const VERSION = 'v2.0.0';

function logRequest(req, route) {
  const userId = req.user?.user_id || req.user?.id || 'anonymous';
  console.log(`[MCPv2] ${new Date().toISOString()} | user=${userId} | route=${route}`);
}

// --- Zod schema -> JSON-ish schema (lite) ---
// This is intentionally best-effort so we don't need a new dependency.
function zodToSchemaLite(schema) {
  const unwrap = (s) => {
    let current = s;
    let optional = false;
    let def = undefined;

    // Unwrap default/optional/nullish wrappers.
    // Note: relies on Zod internals, but only for introspection.
    // eslint-disable-next-line no-constant-condition
    while (current && current._def) {
      const t = current._def.typeName;
      if (t === 'ZodDefault') {
        try {
          def = current._def.defaultValue();
        } catch {
          def = undefined;
        }
        current = current._def.innerType;
        continue;
      }
      if (t === 'ZodOptional') {
        optional = true;
        current = current._def.innerType;
        continue;
      }
      if (t === 'ZodNullable') {
        optional = true;
        current = current._def.innerType;
        continue;
      }
      break;
    }

    return { schema: current, optional, default: def };
  };

  const convert = (s) => {
    const { schema: base, optional, default: def } = unwrap(s);
    const t = base?._def?.typeName;

    const withMeta = (node) => {
      const out = { ...node };
      if (optional) out.optional = true;
      if (def !== undefined) out.default = def;
      return out;
    };

    switch (t) {
      case 'ZodString':
        return withMeta({ type: 'string' });
      case 'ZodNumber':
        return withMeta({ type: 'number' });
      case 'ZodBoolean':
        return withMeta({ type: 'boolean' });
      case 'ZodEnum':
        return withMeta({ type: 'string', enum: base._def.values });
      case 'ZodNativeEnum':
        return withMeta({ type: 'string', enum: Object.values(base._def.values) });
      case 'ZodArray':
        return withMeta({ type: 'array', items: convert(base._def.type) });
      case 'ZodRecord':
        return withMeta({ type: 'object', additionalProperties: true });
      case 'ZodObject': {
        const shape = base._def.shape();
        const properties = {};
        const required = [];

        for (const [k, v] of Object.entries(shape)) {
          const node = convert(v);
          properties[k] = node;
          if (!node.optional) required.push(k);
        }

        return withMeta({
          type: 'object',
          properties,
          required,
          additionalProperties: true,
        });
      }
      case 'ZodUnion':
        return withMeta({ type: 'union', anyOf: base._def.options.map(convert) });
      case 'ZodAny':
      case 'ZodUnknown':
        return withMeta({ type: 'any' });
      default:
        return withMeta({ type: 'unknown', zod_type: t || 'unknown' });
    }
  };

  return convert(schema);
}

function listTools() {
  return Object.entries(MCP_TOOLS).map(([key, tool]) => {
    return {
      key,
      name: tool?.name || key,
      description: tool?.description || null,
      input_schema: tool?.input_schema ? zodToSchemaLite(tool.input_schema) : null,
    };
  });
}

// --- Public discovery endpoints ---
router.get('/status', (req, res) => {
  logRequest(req, '/mcp/v2/status');
  return sendOk(req, res, {
    status: 'ok',
    version: VERSION,
    tools_registered: Object.keys(MCP_TOOLS),
  });
});

router.get('/tools', (req, res) => {
  logRequest(req, '/mcp/v2/tools');
  return sendOk(req, res, { tools: listTools() });
});

router.get('/tools/:tool_name', (req, res) => {
  const { tool_name } = req.params;
  logRequest(req, `/mcp/v2/tools/${tool_name}`);

  const tool = MCP_TOOLS[tool_name];
  if (!tool) {
    return sendError(req, res, new ApiError({
      status: 404,
      code: 'NOT_FOUND',
      message: `Tool '${tool_name}' not found`,
    }));
  }

  return sendOk(req, res, {
    key: tool_name,
    name: tool?.name || tool_name,
    description: tool?.description || null,
    input_schema: tool?.input_schema ? zodToSchemaLite(tool.input_schema) : null,
  });
});

// --- Tool execution endpoints ---
function methodNotAllowed(req, res) {
  return sendError(
    req,
    res,
    new ApiError({
      status: 405,
      code: 'METHOD_NOT_ALLOWED',
      message: `Use POST to execute tools`,
      details: { method: req.method },
    })
  );
}

async function handleToolCall(req, res, { tool_name, action } = {}) {
  logRequest(req, `/mcp/v2/${tool_name}${action ? `/${action}` : ''}`);

  const tool = MCP_TOOLS[tool_name];
  if (!tool) {
    return sendError(
      req,
      res,
      new ApiError({
        status: 404,
        code: 'NOT_FOUND',
        message: `Tool '${tool_name}' not found`,
      })
    );
  }

  const userId = req.user?.user_id || req.user?.id || null;
  if (!userId) {
    return sendError(
      req,
      res,
      new ApiError({ status: 401, code: 'UNAUTHORIZED', message: 'No active session' })
    );
  }

  try {
    // v2 contract: POST body is the canonical input.
    // We still merge query params for backwards compatibility with GET-ish clients.
    const rawInput = {
      ...(req.query || {}),
      ...(req.body || {}),
      ...(action ? { action } : {}),

      // identity injection
      user_id: String(userId),
      username: req.user?.github_username || null,
      github_username: req.user?.github_username || null,
    };

    const validated = tool.input_schema ? tool.input_schema.parse(rawInput) : rawInput;

    const startedAt = Date.now();
    const result = await tool.handler(validated);
    const duration_ms = Date.now() - startedAt;

    // v2 rule: tools may return any JSON; we wrap it.
    return sendOk(req, res, result, { meta: { tool: tool_name, duration_ms } });
  } catch (err) {
    return sendError(req, res, err, { meta: { tool: tool_name } });
  }
}

// Execute tool (preferred)
router.post(
  '/tools/:tool_name',
  requireSession,
  requireCapability(Actions.USE_MCP_TOOL),
  async (req, res) => {
    return handleToolCall(req, res, { tool_name: req.params.tool_name });
  }
);

// Execute tool with action in path (convenience for adapters like github)
router.post(
  '/tools/:tool_name/:action',
  requireSession,
  requireCapability(Actions.USE_MCP_TOOL),
  async (req, res) => {
    return handleToolCall(req, res, {
      tool_name: req.params.tool_name,
      action: req.params.action,
    });
  }
);

// Forbid executing tools via GET/PUT/etc under /tools
router.all('/tools/:tool_name', methodNotAllowed);
router.all('/tools/:tool_name/:action', methodNotAllowed);

export default router;
