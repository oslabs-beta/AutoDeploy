// library dependencies
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import 'dotenv/config';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

// routes
import meRouter from "./routes/me.js";
import authAws from './routes/auth.aws.js';
import authGoogle from './routes/auth.google.js';
import mcpRouter from './routes/mcp.js';
import agentRouter from './routes/agent.js';
import githubAuthRouter from './routes/auth.github.js';
import deploymentsRouter from './routes/deployments.js';
import authRouter from './routes/authRoutes.js';
import localAuthRouter from "./routes/auth.local.js";
import userRouter from './routes/usersRoutes.js';
import systemBannerRouter from './routes/systemBanner.js';
import pipelineCommitRouter from './routes/pipelineCommit.js';
import pipelineSessionsRouter from './routes/pipelineSessions.js';
import scaffoldCommitRouter from './routes/scaffoldCommit.js';
import workflowCommitRouter from './routes/workflowCommit.js';
// app.use(authRoutes);
import jenkinsRouter from './routes/jenkins.js';

// helper functions / constants / other data
import { healthCheck } from './db.js';
import { query } from './db.js';

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(morgan('dev'));
app.use(cookieParser());

// --- Request ID Middleware ---
// Generates a lightweight request ID for traceability and surfaces it to clients.
app.use((req, res, next) => {
  req.requestId =
    req.headers['x-request-id'] ||
    `req_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  res.setHeader('x-request-id', req.requestId);
  next();
});

// --- Request Logging Middleware ---
app.use((req, _res, next) => {
  const user = req.headers['x-user-id'] || 'anonymous';
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${
      req.originalUrl
    } | user=${user}`
  );
  next();
});

// Health & DB ping
app.get('/health', (_req, res) =>
  res.json({ ok: true, uptime: process.uptime() })
);

app.get('/db/ping', async (_req, res) => {
  try {
    const ok = await healthCheck();
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Routes
app.use("/api", meRouter);
app.use("/api", systemBannerRouter);
// Admin-ish user management routes (all of these are now authz-protected
// inside usersRoutes.js using MANAGE_USERS capability).

// --- Request ID Middleware ---
// Generates a lightweight request ID for traceability and surfaces it to clients.
app.use((req, res, next) => {
  req.requestId =
    req.headers['x-request-id'] ||
    `req_${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  res.setHeader('x-request-id', req.requestId);
  next();
});

app.use('/', userRouter);
app.use('/deployments', deploymentsRouter);
app.use('/agent', agentRouter);
app.use('/mcp/v1', pipelineCommitRouter);
app.use('/mcp/v1', mcpRouter);
app.use('/mcp/v1', scaffoldCommitRouter);
app.use('mcp/v1', workflowCommitRouter);
app.use("/auth/local", localAuthRouter);
app.use('/auth/github', githubAuthRouter);
app.use(authRouter);
// not currently using
// app.use('/auth/aws', authAws);
app.use('/auth/google', authGoogle);
app.use('/jenkins', jenkinsRouter);
app.use('/pipeline-sessions', pipelineSessionsRouter);

// Legacy inline /users endpoints have been superseded by routes/usersRoutes.js,
// which now includes authz and a small admin API for promoting users. Keeping
// everything user-related in that router keeps server.js lighter.

app.get('/connections', async (_req, res) => {
  try {
    const rows = await query(
      `select * from connections order by created_at desc limit 100;`
    );
    res.json({ connections: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Global Error Handler ---
app.use((err, _req, res, _next) => {
  console.error('Global Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message,
  });
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Listening on port: ${port}`));
