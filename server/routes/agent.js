/* just commenting on this file to say:
in your /routes folder, make sure to keep your router names consistent!
*/

import express from 'express';
//import { runWizardAgent } from '../agent/wizardAgent.js';
// OLD: runWizardAgent no longer exists
import { generateYAML, editYAML, runWizardAgent } from "../agent/wizardAgent.js";
import { pipeline_generator } from '../tools/pipeline_generator.old.js';
import { repo_reader } from '../tools/repo_reader.js';
import { oidc_adapter } from '../tools/oidc_adapter.js';
import { requireSession } from '../lib/requireSession.js';

const router = express.Router();

// Trigger full pipeline wizard (MVP agent)
router.post('/wizard', requireSession, async (req, res) => {
  try {
    const { repoUrl, provider, branch } = req.body;
    if (!repoUrl || !provider || !branch) {
      return res
        .status(400)
        .json({
          success: false,
          error: 'Missing required fields: repoUrl, provider, branch',
        });
    }
    const result = await runWizardAgent({
      repoUrl,
      provider,
      branch,
      cookie: req.headers.cookie
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Wizard Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger wizard agent with AI prompt
router.post('/wizard/ai', requireSession, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Missing required field: prompt' });
    }
    const result = await runWizardAgent({
      prompt,
      cookie: req.headers.cookie
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Wizard AI Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate pipeline only
router.post('/pipeline', requireSession, async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing required field: repoUrl' });
    }
    const yaml = await pipeline_generator.handler({
      repo: repoUrl,
      provider: 'aws',
      template: 'node_app',
    });
    res.json({ success: true, data: yaml });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Read repository metadata
router.post('/analyze', requireSession, async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing required field: repoUrl' });
    }
    const summary = await repo_reader.handler({ repo: repoUrl });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Deploy to AWS (via OIDC)
router.post('/deploy', requireSession, async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) {
      return res
        .status(400)
        .json({ success: false, error: 'Missing required field: provider' });
    }
    const deployLog = await oidc_adapter.handler({ provider });
    res.json({ success: true, data: deployLog });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Agent heartbeat
router.get('/status', (_req, res) => {
  res.json({ success: true, data: { ok: true, uptime: process.uptime() } });
});

export default router;
