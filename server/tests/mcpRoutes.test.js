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
  input_schema: z.object({
    user_id: z.string(),
    username: z.string().optional(),
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

const { default: mcpRouter } = await import('../routes/mcp.js');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  // Inject a predictable request_id for assertions
  app.use((req, _res, next) => {
    req.requestId = 'test-request-id';
    next();
  });
  app.use('/mcp/v1', mcpRouter);
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

describe('MCP router envelopes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns success envelope for status with request_id', async () => {
    const res = await exec(buildApp(), {
      method: 'GET',
      path: '/mcp/v1/status',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        request_id: 'test-request-id',
      })
    );
    expect(res.body.data.tools_registered).toContain('demo');
  });

  it('handles dynamic tool success with injected user_id', async () => {
    const res = await exec(buildApp(), {
      method: 'POST',
      path: '/mcp/v1/demo',
      body: { value: 'hello' },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ echoed: 'hello' });
    expect(res.body.request_id).toBe('test-request-id');
    expect(mockTool.handler).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
        username: 'octocat',
        value: 'hello',
      })
    );
  });

  it('returns BAD_REQUEST envelope for Zod validation errors', async () => {
    const res = await exec(buildApp(), {
      method: 'POST',
      path: '/mcp/v1/demo',
      body: {},
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toEqual(
      expect.objectContaining({
        code: 'BAD_REQUEST',
        message: 'Invalid input',
      })
    );
    expect(res.body.request_id).toBe('test-request-id');
  });
});
