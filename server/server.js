/*
  i'd recommend organizing your imports at the top of files (here and in other files),
  perhaps by sections separated with spaces, i.e.:

  // library dependencies
  import express from 'express'
  import cors from 'cors'
  import helmet from 'helmet'
  import { z } from 'zod'
  ...

  // routes
  import mcpRoutes from './routes/mcp.js'
  import agentRoutes from './routes/agent.js'
  ...

  // helper functions / constants / other data / etc.
  import { healthCheck } from './db.js'
  import { query } from './db.js'
  ...

  all up to you how you want to do this. but i find it helps with readability and organization.
*/

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { healthCheck } from './db.js';
import mcpRoutes from './routes/mcp.js';
import agentRoutes from './routes/agent.js';
import githubAuthRouter from './routes/auth.github.js';
import deploymentsRouter from './routes/deployments.js';
import authRoutes from './routes/authRoutes.js';
import userRouter from './routes/usersRoutes.js';
import cookieParser from 'cookie-parser';
import authAws from './routes/auth.aws.js';
import authGoogle from './routes/auth.google.js';
import { z } from 'zod';
import { query } from './db.js';
import jenkinsRouter from './routes/jenkins.js';
import pipelineCommitRouter from './routes/pipelineCommit.js';
// app.use(authRoutes);

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(morgan('dev'));
app.use(cookieParser());

// --- Request Logging Middleware ---

// a convention you can choose to follow is prefixing unused parameters with an underscore
app.use((req, _res, next) => {
  const user = req.headers['x-user-id'] || 'anonymous';
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${
      req.originalUrl
    } | user=${user}`
  );
  // ^ nice logging; this is great.

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

// Mount users route at /users
// ^ imo, this kind of comment is a bit useless: it's obvious to other devs what it does :)
app.use('/', userRouter);

// i'd probably put the other routes here as well.

/** Users */
const UserBody = z.object({
  email: z.string().email(),
  github_username: z.string().min(1).optional(),
});

// Create or upsert user by email
app.post('/users', async (req, res) => {
  const parse = UserBody.safeParse(req.body); // love that you are doing this. great.
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

// you definitely want to minimize commented-out code like below
// if you don't need it, just remove it.

// app.get('/users', async (_req, res) => {
//   try {
//     const rows = await query(
//       `select * from users order by created_at desc limit 100;`
//     );
//     res.json({ users: rows });
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

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

// -- Agent entry point

/*
you should keep your router names consistent:
  - deploymentsRouter
  - agentRouter (not agentRoutes)
  - authAwsRouter (not authAws)
  - authGoogleRouter (not authGoogle)
  etc.
*/

// also, i'd probably move these routes closer to the top of the file, so they're easier to find.

app.use('/deployments', deploymentsRouter);
app.use('/agent', agentRoutes);
app.use('/mcp/v1', pipelineCommitRouter);
app.use('/mcp/v1', mcpRoutes);

app.use('/auth/github', githubAuthRouter);
app.use(authRoutes);
app.use('/auth/aws', authAws);

app.use('/auth/google', authGoogle);

app.use('/jenkins', jenkinsRouter);

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error('Global Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message,
  });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API on http://localhost:${port}`));
