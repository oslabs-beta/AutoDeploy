import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireSession } from '../lib/requireSession.js';
import { Actions, requireCapability } from '../lib/authorization.js';

const router = Router();

/** Users */
const UserBody = z.object({
  email: z.string().email(),
  github_username: z.string().min(1).optional(),
});

// Create or upsert user by email (admin-only; prefer auth flows for end-users)
router.post('/users', requireSession, requireCapability(Actions.MANAGE_USERS), async (req, res) => {
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

router.get('/users', requireSession, requireCapability(Actions.MANAGE_USERS), async (_req, res) => {
  try {
    const rows = await query(
      `select * from users order by created_at desc limit 100;`
    );
    res.json({ users: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Promote/demote a user to/from SYSTEM_ADMIN. This is intentionally simple and
// admin-only; you can build a nicer UI on top later.
const PromoteBody = z.object({
  user_id: z.string().uuid(),
  make_admin: z.boolean().default(true),
});

router.post(
  '/users/promote',
  requireSession,
  requireCapability(Actions.MANAGE_USERS),
  async (req, res) => {
    const parsed = PromoteBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }

    const { user_id, make_admin } = parsed.data;
    const role = make_admin ? 'SYSTEM_ADMIN' : 'USER';

    try {
      const rows = await query(
        `
        update users
        set role = $2
        where id = $1
        returning id, email, github_username, role, plan, beta_pro_granted, created_at;
        `,
        [user_id, role]
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.json({ user: rows[0] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
);

export default router;
