import { jest } from '@jest/globals';
import express from 'express';
import { EventEmitter } from 'events';
import cookieParser from 'cookie-parser';
import { z } from 'zod';

// --- Mocks ---
const requireSession = jest.fn((req, _res, next) => {
  req.user = { user_id: 'user-123', github_username: 'octocat' };
  next();
});

const requireCapability = jest.fn(() => (req, _res, next) => next());

const mockTool = {
  name: 'demo',
  description: 'demo tool',
  input_schema: z.object({
    user_id: z.string(),
    username: z.string().nullable().optional(),
    github_username: z.string().nullable().optional(),
    value: z.string(),
  }),
  handler: jest.fn(async ({ value }) => ({ echoed: value })),
};

jest.unstable_mockModule('../lib/requireSession.js', () => ({
  requireSession,
}));

jest.unstable_mockModule('../lib/authorization.js', () => ({
  Actions: { USE_MCP_TOOL: 'USE_MCP_TOOL' },
  requireCapability,
}));

jest.unstable_mockModule('../tools/index.js', () => ({
  MCP_TOOLS: {
    demo: mockTool,
  },
}));

const { default: mcpV2Router } = await import('../routes/mcp.v2.js');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // Inject a predictable request_id for assertions
  app.use((req, _res, next) => {
    req.requestId = 'test-request-id';
    next();
  });

  app.use('/mcp/v2', mcpV2Router);
  return app;
};

// Minimal in-memory executor to bypass network sockets
const exec = (app, { method, path, body = {}, headers = {}, query = {} }) =>
  new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = path;
    req.headers = headers;
    req.body = body;
    req.query = query;

    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data) => {
      res.body = data;
      resolve({ status: res.statusCode, body: data });
    };
    res.setHeader = () => {};

    app.handle(req, res, (err) => {
      if (err) reject(err);
    });
  });

describe('MCP v2 facade contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /mcp/v2/status returns ok envelope with meta.request_id', async () => {
    const res = await exec(buildApp(), {
      method: 'GET',
      path: '/mcp/v2/status',
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.meta).toEqual(
      expect.objectContaining({
        request_id: 'test-request-id',
        timestamp: expect.any(String),
      })
    );
    expect(res.body.data).toEqual(
      expect.objectContaining({
        status: 'ok',
        version: 'v2.0.0',
      })
    );
    expect(res.body.data.tools_registered).toContain('demo');
  });

  it('GET /mcp/v2/tools returns tool list including schema', async () => {
    const res = await exec(buildApp(), {
      method: 'GET',
      path: '/mcp/v2/tools',
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'demo',
          name: 'demo',
          description: 'demo tool',
          input_schema: expect.any(Object),
        }),
      ])
    );
  });

  it('POST /mcp/v2/tools/demo executes tool and includes tool meta', async () => {
    const res = await exec(buildApp(), {
      method: 'POST',
      path: '/mcp/v2/tools/demo',
      body: { value: 'hello' },
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual({ echoed: 'hello' });

    expect(res.body.meta).toEqual(
      expect.objectContaining({
        request_id: 'test-request-id',
        tool: 'demo',
        duration_ms: expect.any(Number),
      })
    );

    expect(mockTool.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
        username: 'octocat',
        github_username: 'octocat',
        value: 'hello',
      })
    );
  });

  it('GET /mcp/v2/tools/:tool/:action is METHOD_NOT_ALLOWED (execution requires POST)', async () => {
    const res = await exec(buildApp(), {
      method: 'GET',
      path: '/mcp/v2/tools/demo/echo',
    });

    expect(res.status).toBe(405);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toEqual(
      expect.objectContaining({
        code: 'METHOD_NOT_ALLOWED',
      })
    );
    expect(res.body.meta.request_id).toBe('test-request-id');
  });

  it('POST /mcp/v2/tools/demo returns BAD_REQUEST on validation errors', async () => {
    const res = await exec(buildApp(), {
      method: 'POST',
      path: '/mcp/v2/tools/demo',
      body: {},
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toEqual(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Invalid input',
      })
    );
    expect(res.body.meta.request_id).toBe('test-request-id');
  });
});
