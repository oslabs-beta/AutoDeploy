import express from 'express';
import { google_adapter } from '../tools/google_adapter.js';
import { requireSession } from '../lib/requireSession.js';

const router = express.Router();

// Route to initiate Google OAuth
router.get('/', requireSession, async (req, res) => {
  await google_adapter.connect(req, res, req.user?.user_id);
});

// OAuth callback route
router.get('/callback', requireSession, async (req, res) => {
  await google_adapter.callback(req, res, req.user?.user_id);
});

export default router;
