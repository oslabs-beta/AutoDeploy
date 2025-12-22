import { jest } from '@jest/globals';
import express from 'express';
import { EventEmitter } from 'events';
import cookieParser from 'cookie-parser';

const requireSession = jest.fn((req, _res, next) => {
  req.user = { user_id: 'user-123', github_username: 'octocat' };
  next();
});

const getGithubAccessTokenForUser = jest.fn(async () => 'gh-token');
const upsertWorkflowFile = jest.fn(async () => ({
  commit: { sha: 'abc123', html_url: 'https://example.com/commit' },
}));
const savePipelineVersion = jest.fn(async () => ({ id: 1 }));

// Mock query to handle selects/inserts used in routes
const query = jest.fn(async (sql) => {
  if (/from pipeline_versions\s+where id/i.test(sql)) {
    return {
      rowCount: 1,
      rows: [
        {
          id: 1,
          repo_full_name: 'owner/repo',
          branch: 'main',
          workflow_path: '.github/workflows/ci.yml',
          yaml: 'name: test',
        },
      ],
    };
  }
  if (/from pipeline_versions/i.test(sql)) {
    return { rowCount: 1, rows: [{ id: 1 }] };
  }
  return { rowCount: 1, rows: [] };
});

jest.unstable_mockModule('../lib/requireSession.js', () => ({
  requireSession,
}));
jest.unstable_mockModule('../lib/github-token.js', () => ({
  getGithubAccessTokenForUser,
}));
jest.unstable_mockModule('../tools/github_adapter.js', () => ({
  upsertWorkflowFile,
}));
jest.unstable_mockModule('../lib/pipelineVersions.js', () => ({
  savePipelineVersion,
}));
jest.unstable_mockModule('../db.js', () => ({
  query,
}));

const { default: pipelineRouter } = await import('../routes/pipelineCommit.js');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.requestId = 'test-request-id';
    next();
  });
  app.use('/mcp/v1', pipelineRouter);
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

describe('pipeline_commit/history/rollback envelopes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects missing yaml with BAD_REQUEST', async () => {
    const res = await exec(buildApp(), {
      method: 'POST',
      path: '/mcp/v1/pipeline_commit',
      body: { repoFullName: 'owner/repo' },
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.request_id).toBe('test-request-id');
  });

  it('commits workflow and returns ok envelope with request_id', async () => {
    const res = await exec(buildApp(), {
      method: 'POST',
      path: '/mcp/v1/pipeline_commit',
      body: { repoFullName: 'owner/repo', yaml: 'name: test' },
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/Workflow committed/i);
    expect(res.body.data).toBeDefined();
    expect(res.body.request_id).toBe('test-request-id');
    expect(upsertWorkflowFile).toHaveBeenCalled();
    expect(savePipelineVersion).toHaveBeenCalled();
  });

  it('returns history with ok envelope and versions', async () => {
    const res = await exec(buildApp(), {
      method: 'GET',
      path: '/mcp/v1/pipeline_history',
      query: { repoFullName: 'owner/repo' },
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.versions).toBeDefined();
    expect(res.body.request_id).toBe('test-request-id');
  });

  it('rejects rollback without versionId', async () => {
    const res = await exec(buildApp(), {
      method: 'POST',
      path: '/mcp/v1/pipeline_rollback',
      body: {},
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.request_id).toBe('test-request-id');
  });

  it('rolls back to version and returns ok envelope', async () => {
    const res = await exec(buildApp(), {
      method: 'POST',
      path: '/mcp/v1/pipeline_rollback',
      body: { versionId: 1 },
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveProperty('github');
    expect(res.body.data).toHaveProperty('deployment');
    expect(res.body.request_id).toBe('test-request-id');
    expect(upsertWorkflowFile).toHaveBeenCalled();
  });
});
