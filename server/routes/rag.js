import express from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import extract from 'extract-zip';
import fg from 'fast-glob';

import { requireSession } from '../lib/requireSession.js';
import { Actions, requireCapability } from '../lib/authorization.js';
import { embedBatch } from '../lib/rag/embeddingService.js';
import { upsertVectors, queryVectors, buildNamespace } from '../lib/rag/pineconeClient.js';
import { answerWithContext } from '../lib/rag/openaiRag.js';
import { logInteraction, getHistoryByNamespace } from '../lib/rag/supabaseRag.js';
import { parseGitHubRepoUrl, cloneGithubRepoShallow } from '../lib/rag/githubService.js';

const router = express.Router();

// --- Multer setup for zip uploads ---
const upload = multer({ dest: os.tmpdir() }).single('repoZip');

// --- Simple text chunker (AskMyRepo-style) ---
const CHUNK = 1800;
const OVERLAP = 200;

function chunkText(s) {
  const out = [];
  for (let i = 0; i < s.length; i += CHUNK - OVERLAP) {
    out.push(s.slice(i, i + CHUNK));
  }
  return out;
}

const CODE_EXT = /\.(js|ts|tsx|jsx|json|md|yml|yaml|sql|sh|html|css|scss|xml)$/i;
const IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

// lockfiles and other noisy artifacts we generally do not want to treat as context
const SKIP_PATH_PATTERNS = [
  /(^|\/)package-lock\.json$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)pnpm-lock\.ya?ml$/i,
  /(^|\/)bun\.lockb$/i,
];

function shouldSkipFile(relPath) {
  return SKIP_PATH_PATTERNS.some((re) => re.test(relPath));
}

function getUserId(req) {
  return req.user?.user_id || req.user?.id || null;
}

async function ingestWorkspaceCodeToNamespace({ workspace, namespace, repoSlug, userId }) {
  // 1) Discover files
  const files = await fg(['**/*.*'], {
    cwd: workspace,
    onlyFiles: true,
    ignore: IGNORE,
  });

  const codeFiles = files.filter((p) => CODE_EXT.test(p) && !shouldSkipFile(p));

  // 2) Read + chunk
  const chunks = [];
  for (const rel of codeFiles) {
    const full = path.join(workspace, rel);
    let text = '';
    try {
      text = await fs.readFile(full, 'utf8');
    } catch {
      // ignore unreadable files
    }
    if (!text) continue;
    const parts = chunkText(text);
    parts.forEach((t, idx) => chunks.push({ path: rel, idx, text: t }));
  }

  // 3) Embed + upsert in small batches
  let upserted = 0;
  const BATCH = 64;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH);
    const vectors = await embedBatch(slice.map((c) => c.text));
    const payload = vectors.map((values, k) => ({
      id: `${namespace}:${i + k}`,
      values,
      metadata: {
        path: slice[k].path,
        idx: slice[k].idx,
        text: slice[k].text,
        repo: repoSlug,
        user_id: String(userId),
      },
    }));
    await upsertVectors(namespace, payload);
    upserted += payload.length;
  }

  return { fileCount: codeFiles.length, chunkCount: chunks.length, upserted };
}

// --- POST /api/rag/ingest/zip ---
// multipart/form-data
// - repoZip: .zip file (required)
// - repoSlug: owner/repo string (required)
router.post('/ingest/zip', requireSession, requireCapability(Actions.USE_AGENT), (req, res, next) => {
  upload(req, res, async (err) => {
    try {
      if (err) throw err;
      if (!req.file?.path) {
        return res
          .status(400)
          .json({ error: 'Send a .zip file in field "repoZip"' });
      }

      const rawRepoSlug = req.body?.repoSlug || req.body?.repo || '';
      const repoSlug = String(rawRepoSlug || '').trim();
      if (!repoSlug) {
        return res
          .status(400)
          .json({ error: 'Missing required form field "repoSlug" (owner/repo)' });
      }

      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: 'No active session' });
      }

      const namespace = buildNamespace({ userId, repoSlug });

      // 1) Extract into a temp workspace
      const workspace = path.join(os.tmpdir(), `repo_ws_${Date.now()}`);
      await fs.mkdir(workspace, { recursive: true });
      await extract(req.file.path, { dir: workspace });

      const { fileCount, chunkCount, upserted } = await ingestWorkspaceCodeToNamespace({
        workspace,
        namespace,
        repoSlug,
        userId,
      });

      // Cleanup uploaded zip (best-effort)
      try {
        await fs.unlink(req.file.path);
      } catch {
        // ignore
      }

      return res.status(200).json({
        message: 'Embedded & upserted',
        namespace,
        jobId: namespace,
        fileCount,
        chunkCount,
        upserted,
      });
    } catch (e) {
      return next(e);
    }
  });
});

// --- POST /api/rag/ingest/github ---
// JSON body: { repoUrl, includeIssues?, githubToken? }
// - repoUrl is required and must be a valid GitHub repo URL
router.post('/ingest/github', requireSession, requireCapability(Actions.USE_AGENT), async (req, res, next) => {
  try {
    const { repoUrl, includeIssues = false, githubToken } = req.body || {};

    if (!repoUrl) {
      return res.status(400).json({ error: 'Missing "repoUrl" in body' });
    }

    const parsed = parseGitHubRepoUrl(repoUrl);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid GitHub repoUrl' });
    }

    const repoSlug = `${parsed.owner}/${parsed.repo}`;
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'No active session' });
    }

    const namespace = buildNamespace({ userId, repoSlug });

    const workspace = path.join(
      os.tmpdir(),
      `rag_github_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      await fs.mkdir(workspace, { recursive: true });
      const repoDir = path.join(workspace, 'repo');
      await cloneGithubRepoShallow({ repoUrl, dest: repoDir });

      const { fileCount, chunkCount, upserted } = await ingestWorkspaceCodeToNamespace({
        workspace: repoDir,
        namespace,
        repoSlug,
        userId,
      });

      // NOTE: includeIssues is accepted but currently ignored.
      // If you want to ingest GitHub Issues as well, we can extend this
      // to call fetchRepoIssues(...) and upsert those chunks into the same
      // namespace with kind: 'issue' metadata.

      return res.status(200).json({
        namespace,
        repo: { owner: parsed.owner, repo: parsed.repo },
        includeIssues,
        fileCount,
        chunkCount,
        upserted,
        issueCount: 0,
        issueChunkCount: 0,
        issueUpserted: 0,
      });
    } finally {
      // best-effort cleanup
      try {
        await fs.rm(workspace, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  } catch (e) {
    return next(e);
  }
});

// --- POST /api/rag/query ---
// { namespace, question, topK? }
router.post('/query', requireSession, requireCapability(Actions.USE_AGENT), async (req, res, next) => {
  try {
    const { namespace, question, topK = 5 } = req.body || {};

    if (!namespace || !question) {
      return res
        .status(400)
        .json({ error: 'Missing "namespace" or "question" in body' });
    }

    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'No active session' });
    }

    // Enforce that the namespace belongs to this user
    if (!String(namespace).startsWith(`${userId}:`)) {
      return res.status(403).json({ error: 'Forbidden namespace for this user' });
    }

    // 1) Embed the question
    const [qVec] = await embedBatch([question]);

    // 2) Pinecone search
    const matches = await queryVectors(namespace, qVec, Number(topK) || 5);

    // 3) Build context string
    const context = matches
      .map((m) => {
        const meta = m.metadata || {};
        const header = `File: ${meta.path} (chunk ${meta.idx}) [score ${
          m.score?.toFixed?.(3) ?? m.score
        }]`;
        return `${header}\n${meta.text || ''}`;
      })
      .join('\n\n---\n\n');

    // 4) Ask the LLM using the retrieved context
    const answer = await answerWithContext(question, context);

    // 5) Log interaction to Supabase (namespace = jobId)
    await logInteraction({ namespace, jobId: namespace, question, answer });

    // 6) Return answer + sources
    const sources = matches.map((m) => ({
      path: m.metadata?.path,
      idx: m.metadata?.idx,
      score: m.score,
    }));

    return res.status(200).json({ answer, sources });
  } catch (e) {
    return next(e);
  }
});

// --- GET /api/rag/logs?namespace=...&limit=... ---
router.get('/logs', requireSession, requireCapability(Actions.USE_AGENT), async (req, res, next) => {
  try {
    const { namespace, limit } = req.query || {};

    if (!namespace) {
      return res
        .status(400)
        .json({ error: 'Missing "namespace" query param' });
    }

    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'No active session' });
    }

    if (!String(namespace).startsWith(`${userId}:`)) {
      return res.status(403).json({ error: 'Forbidden namespace for this user' });
    }

    const rows = await getHistoryByNamespace({
      namespace,
      limit: limit ? Number(limit) : 50,
    });

    return res.status(200).json(rows);
  } catch (e) {
    return next(e);
  }
});

export default router;
