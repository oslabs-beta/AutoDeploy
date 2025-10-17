import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';

const router = Router();

/** Users */
const UserBody = z.object({
  email: z.string().email(),
  github_username: z.string().min(1).optional(),
});

// Create or upsert user by email
router.post('/users', async (req, res) => {
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

router.get('/users', async (_req, res) => {
  try {
    const rows = await query(
      `select * from users order by created_at desc limit 100;`
    );
    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
