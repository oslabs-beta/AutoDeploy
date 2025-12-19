import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { query } from "../db.js";

const router = Router();

function scryptHash(password, saltBase64) {
  const salt = saltBase64
    ? Buffer.from(saltBase64, "base64")
    : crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

function verifyPassword(password, saltBase64, hashBase64) {
  const { hash } = scryptHash(password, saltBase64);
  const a = Buffer.from(hash, "base64");
  const b = Buffer.from(hashBase64, "base64");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function setSessionCookie(res, payload) {
  if (!process.env.JWT_SECRET) {
    throw new Error("Server misconfigured: JWT_SECRET missing");
  }
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "10h" });
  res.cookie("mcp_session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60 * 60 * 1000,
  });
}

const CredentialsBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

router.post("/signup", async (req, res) => {
  const parsed = CredentialsBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  const { email, password } = parsed.data;

  // Avoid relying on a unique constraint on users.email (not guaranteed in every DB).
  const { rows: existingRows } = await query(
    `select id from users where email = $1 limit 1;`,
    [email]
  );
  if (existingRows.length) {
    return res.status(409).json({ error: "Account already exists" });
  }

  const { rows: userRows } = await query(
    `insert into users (email) values ($1) returning id, email, github_username;`,
    [email]
  );

  const user = userRows[0];
  if (!user?.id) {
    return res.status(500).json({ error: "Failed to create user" });
  }

  const { salt, hash } = scryptHash(password);

  // Store the local password verifier in the existing `connections` table to
  // avoid schema migrations (Supabase-friendly).
  await query(
    `
      insert into connections (user_id, provider, access_token, created_at)
      values ($1, 'local', $2, now())
      on conflict (user_id, provider)
      do update set access_token = excluded.access_token, created_at = now();
    `,
    [String(user.id), JSON.stringify({ kdf: "scrypt", salt, hash })]
  );

  setSessionCookie(res, { user_id: user.id, email: user.email, provider: "local" });
  return res.status(201).json({ ok: true, user: { user_id: user.id, email: user.email } });
});

router.post("/login", async (req, res) => {
  const parsed = CredentialsBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message });
  }

  const { email, password } = parsed.data;

  const { rows: userRows } = await query(
    `select id, email, github_username from users where email = $1 limit 1;`,
    [email]
  );
  const user = userRows[0];
  if (!user?.id) return res.status(401).json({ error: "Invalid email or password" });

  const { rows: connRows } = await query(
    `select access_token from connections where user_id = $1 and provider = 'local' limit 1;`,
    [String(user.id)]
  );
  const conn = connRows[0];
  let verifier = null;
  try {
    verifier = conn?.access_token ? JSON.parse(conn.access_token) : null;
  } catch {
    verifier = null;
  }

  const salt = verifier?.salt;
  const hash = verifier?.hash;
  if (!salt || !hash) return res.status(401).json({ error: "Invalid email or password" });

  const ok = verifyPassword(password, salt, hash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  setSessionCookie(res, { user_id: user.id, email: user.email, provider: "local" });
  return res.json({ ok: true, user: { user_id: user.id, email: user.email } });
});

router.post("/logout", (_req, res) => {
  res.clearCookie("mcp_session", { path: "/" });
  return res.json({ ok: true });
});

export default router;
