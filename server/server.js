// library dependencies
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import 'dotenv/config';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

// routes
import authAws from './routes/auth.aws.js';
import authGoogle from './routes/auth.google.js';
import mcpRouter from './routes/mcp.js';
import agentRouter from './routes/agent.js';
import githubAuthRouter from './routes/auth.github.js';
import deploymentsRouter from './routes/deployments.js';
import authRouter from './routes/authRoutes.js';
import userRouter from './routes/usersRoutes.js';
import pipelineCommitRouter from './routes/pipelineCommit.js';
import pipelineSessionsRouter from './routes/pipelineSessions.js';
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
app.use('/', userRouter);
app.use('/deployments', deploymentsRouter);
app.use('/agent', agentRouter);
app.use('/mcp/v1', pipelineCommitRouter);
app.use('/mcp/v1', mcpRouter);
app.use('/auth/github', githubAuthRouter);
app.use(authRouter);
// not currently using
// app.use('/auth/aws', authAws);
app.use('/auth/google', authGoogle);
app.use('/jenkins', jenkinsRouter);
app.use('/pipeline-sessions', pipelineSessionsRouter);

/** Users */
const UserBody = z.object({
  email: z.string().email(),
  github_username: z.string().min(1).optional(),
});

// Create or upsert user by email
app.post('/users', async (req, res) => {
  const parse = UserBody.safeParse(req.body);
  if (!parse.success)
    return res.status(400).json({ error: parse.error.message });
  const { email, github_username } = parse.data;

  // upsert on email; requires a unique index on users.email
  try {
    const rows = await query(
      `
      insert into users (email, github_username)
      values ($1, $2)
      on conflict (email) do update set github_username = excluded.github_username
      returning *;
      `,
      [email, github_username ?? null]
    );
    res.status(201).json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/users', async (_req, res) => {
  try {
    const rows = await query(`
      select 
        u.id as user_id,
        u.email,
        u.github_username,
        c.provider,
        c.access_token,
        c.created_at
      from users u  
      left join connections c on u.id = c.user_id
      order by c.created_at desc
      limit 100;
    `);
    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
app.listen(port, () => console.log(`API on http://localhost:${port}`));
