import express from 'express';
import { runWizardAgent } from '../agent/wizardAgent.js';
import { pipeline_generator } from '../tools/pipeline_generator.js';
import { repo_reader } from '../tools/repo_reader.js';
import { oidc_adapter } from '../tools/oidc_adapter.js';

const router = express.Router();

// Trigger full pipeline wizard (MVP agent)
router.post('/wizard', async (req, res) => {
  try {
    const { repoUrl, provider, branch } = req.body;
    if (!repoUrl || !provider || !branch) {
      return res.status(400).json({ success: false, error: 'Missing required fields: repoUrl, provider, branch' });
    }
    const result = await runWizardAgent({ repoUrl, provider, branch });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Wizard Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trigger wizard agent with AI prompt
router.post('/wizard/ai', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Missing required field: prompt' });
    }
    const result = await runWizardAgent(prompt);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Wizard AI Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Generate pipeline only
router.post('/pipeline', async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ success: false, error: 'Missing required field: repoUrl' });
    }
    const yaml = await pipeline_generator.handler({
      repo: repoUrl,
      provider: 'aws',
      template: 'node_app'
    });
    res.json({ success: true, data: yaml });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Read repository metadata
router.post('/analyze', async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ success: false, error: 'Missing required field: repoUrl' });
    }
    const summary = await repo_reader.handler({ repo: repoUrl });
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Deploy to AWS (via OIDC)
router.post('/deploy', async (req, res) => {
  try {
    const { provider } = req.body;
    if (!provider) {
      return res.status(400).json({ success: false, error: 'Missing required field: provider' });
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