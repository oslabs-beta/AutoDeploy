import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { z } from 'zod';
import { query, healthCheck } from './db.js';

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(morgan('dev'));

/** Health & DB ping */
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

  // upsert on email; requires a unique index on users.email (recommended)
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

/** Connections */
const ConnBody = z.object({
  user_id: z.string().uuid(),
  provider: z.string().min(1),
  access_token: z.string().min(1), // store encrypted in real use!
});

app.post('/connections', async (req, res) => {
  const parse = ConnBody.safeParse(req.body);
  if (!parse.success)
    return res.status(400).json({ error: parse.error.message });
  const { user_id, provider, access_token } = parse.data;

  try {
    const rows = await query(
      `
      insert into connections (user_id, provider, access_token)
      values ($1, $2, $3)
      returning *;
      `,
      [user_id, provider, access_token]
    );
    res.status(201).json({ connection: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/connections/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const rows = await query(
      `select * from connections where user_id = $1 order by created_at desc;`,
      [user_id]
    );
    res.json({ connections: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API on http://localhost:${port}`));
