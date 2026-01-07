import { Router } from 'express';
import { z } from 'zod';
import { requireSession } from '../lib/requireSession.js';
import { Actions, requireCapability } from '../lib/authorization.js';
import {
  getActiveSystemBanner,
  upsertActiveSystemBanner,
  clearActiveSystemBanner,
} from '../lib/systemBanner.js';

const router = Router();

// Public-ish endpoint used by the landing SPA to fetch the current banner.
// This intentionally does not require auth; the banner usually contains
// incident / maintenance information that should be broadly visible.
router.get('/system-banner', async (_req, res, next) => {
  try {
    const banner = await getActiveSystemBanner();
    // Frontend helper (fetchSystemBanner) accepts either direct or wrapped
    // payloads. Returning the direct payload keeps this simple.
    return res.json(banner);
  } catch (err) {
    return next(err);
  }
});

const BannerBody = z.object({
  message: z.string().min(1),
  tone: z.enum(['info', 'success', 'warning', 'error']),
  sticky: z.boolean().optional(),
});

// Admin-only endpoint to set/replace the active system banner.
router.post(
  '/system-banner',
  requireSession,
  requireCapability(Actions.MANAGE_BANNERS),
  async (req, res, next) => {
    try {
      const parsed = BannerBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }

      const { message, tone, sticky } = parsed.data;
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'No active session' });
      }

      const banner = await upsertActiveSystemBanner(
        { message, tone, sticky },
        userId,
      );

      return res.status(200).json({ ok: true, banner });
    } catch (err) {
      return next(err);
    }
  },
);

// Admin-only endpoint to clear any active banner.
router.delete(
  '/system-banner',
  requireSession,
  requireCapability(Actions.MANAGE_BANNERS),
  async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'No active session' });
      }

      await clearActiveSystemBanner(userId);
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
