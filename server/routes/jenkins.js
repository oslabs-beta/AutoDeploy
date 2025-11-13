import express from 'express';
import { askJenkins } from '../src/agents/jenkins-agent.js';

const router = express.Router();

router.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res
        .status(400)
        .json({ error: "Missing 'question' field in body" });
    }

    console.log(`[JENKINS ASK] ${question}`);
    const answer = await askJenkins(question);

    res.json({
      question,
      answer,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error in /jenkins/ask:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

export default router;
