import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { healthCheck, query } from './db.js';
import githubAuthRouter from './routes/auth.github.js';
import { z } from 'zod';
import mcpRoutes from './routes/mcp.js';

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(morgan('dev'));

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
    const rows = await query(
      `select * from users order by created_at desc limit 100;`
    );
    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Request Logging Middleware ---
app.use((req, res, next) => {
  const user = req.headers["x-user-id"] || "anonymous";
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} | user=${user}`);
  next();
});

// -- Agent entry point 
app.use('/mcp/v1', mcpRoutes);

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error("Global Error:", err);
  res.status(500).json({
    success: false,
    error: "Internal Server Error",
    message: err.message,
  });
});



// Mount GitHub OAuth routes at /auth/github
app.use('/auth/github', githubAuthRouter);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API on http://localhost:${port}`));
