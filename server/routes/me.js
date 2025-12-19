import { Router } from "express";
import { requireSession } from "../lib/requireSession.js";

const router = Router();

// Basic session introspection for the frontend.
// Mounted at /api, so this becomes GET /api/me.
router.get("/me", requireSession, (req, res) => {
  res.json({ ok: true, user: req.user || null });
});

export default router;

