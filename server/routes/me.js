import { Router } from "express";
import { requireSession } from "../lib/requireSession.js";

const router = Router();

// Basic session introspection for the frontend.
// Mounted at /api, so this becomes GET /api/me.
router.get("/me", requireSession, (req, res) => {
  const user = req.user || null;

  if (!user) {
    return res.json({ ok: false, user: null });
  }

  // Expose a stable, frontend-friendly shape. Avoid leaking sensitive columns
  // like password verifiers or raw access tokens.
  const safeUser = {
    id: user.id,
    email: user.email,
    github_username: user.github_username,
    role: user.role,
    plan: user.plan,
    beta_pro_granted: user.beta_pro_granted,
    created_at: user.created_at,
  };

  res.json({ ok: true, user: safeUser });
});

export default router;

