import express from 'express';
import { google_adapter } from '../tools/google_adapter.js';

const router = express.Router();

// Route to initiate Google OAuth
router.get('/', async (req, res) => {
  await google_adapter.connect(req, res);
});

// OAuth callback route
router.get('/callback', async (req, res) => {
  await google_adapter.callback(req, res);
});

export default router;
