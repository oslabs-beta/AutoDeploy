import { z } from 'zod';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import extract from 'extract-zip';
import fg from 'fast-glob';

import { ApiError } from '../lib/httpEnvelope.js';
import { embedBatch } from '../lib/rag/embeddingService.js';
import {
  upsertVectors,
  queryVectors,
  buildNamespace,
} from '../lib/rag/pineconeClient.js';
import { answerWithContext } from '../lib/rag/openaiRag.js';
import {
  logInteraction,
  getHistoryByNamespace,
} from '../lib/rag/supabaseRag.js';
import {
  parseGitHubRepoUrl,
  cloneGithubRepoShallow,
} from '../lib/rag/githubService.js';

// --- Shared helpers (mirrors routes/rag.js) ---
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

function ensureNamespaceOwnedByUser(namespace, userId) {
  const ns = String(namespace || '').trim();
  const uid = String(userId || '').trim();
  if (!ns || !uid) {
    throw new ApiError({
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Missing namespace or user_id',
    });
  }

  if (!ns.startsWith(`${uid}:`)) {
    throw new ApiError({
      status: 403,
      code: 'FORBIDDEN_NAMESPACE',
      message: 'Namespace does not belong to this user',
      details: { namespace: ns },
    });
  }
}

// --- rag_ingest_zip (local) ---
// Ingest a zip on the AutoDeploy server into Pinecone under a user+repo namespace.
export const rag_ingest_zip = {
  name: 'rag_ingest_zip',
  description:
    'Upload a zipped repository from the AutoDeploy server filesystem and ingest it into the local RAG backend. Returns a namespace and stats.',

  input_schema: z.object({
    user_id: z
      .string()
      .describe('Current AutoDeploy user id (injected by MCP v2).'),
    file_path: z
      .string()
      .describe('Absolute or working-directory-relative path to a .zip file on the AutoDeploy server.'),
    repoSlug: z
      .string()
      .describe('Optional owner/repo slug used for namespacing; defaults to the zip basename.')
      .optional(),
  }),

  handler: async ({ user_id, file_path, repoSlug }) => {
    // Basic sanity check on the zip
    try {
      const stat = await fs.stat(file_path);
      if (!stat.isFile()) {
        throw new Error('Not a file');
      }
    } catch (err) {
      throw new ApiError({
        status: 400,
        code: 'ZIP_NOT_FOUND',
        message: `Could not read zip file at path: ${file_path}`,
        details: err?.message,
      });
    }

    const inferredSlug =
      repoSlug ||
      path
        .basename(file_path)
        .replace(/\.zip$/i, '')
        .trim() || 'local-repo';

    const namespace = buildNamespace({ userId: user_id, repoSlug: inferredSlug });

    const workspace = path.join(
      os.tmpdir(),
      `rag_zip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      await fs.mkdir(workspace, { recursive: true });
      await extract(file_path, { dir: workspace });

      const { fileCount, chunkCount, upserted } = await ingestWorkspaceCodeToNamespace({
        workspace,
        namespace,
        repoSlug: inferredSlug,
        userId: user_id,
      });

      return {
        message: 'Embedded & upserted',
        namespace,
        jobId: namespace,
        fileCount,
        chunkCount,
        upserted,
      };
    } finally {
      try {
        await fs.rm(workspace, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  },
};

// --- rag_ingest_github (local) ---
export const rag_ingest_github = {
  name: 'rag_ingest_github',
  description:
    'Ingest a GitHub repository into the local RAG backend (Pinecone + Supabase) using the current AutoDeploy user as the namespace owner.',

  input_schema: z.object({
    user_id: z
      .string()
      .describe('Current AutoDeploy user id (injected by MCP v2).'),
    repoUrl: z
      .string()
      .describe('GitHub repository URL, e.g. https://github.com/OWNER/REPO.'),
    includeIssues: z
      .boolean()
      .describe('Whether to ingest GitHub Issues. Currently ignored; code-only ingestion.')
      .optional()
      .default(false),
    githubToken: z
      .string()
      .describe(
        'Optional GitHub PAT for authenticated GitHub API calls. Currently not used for git clone, which expects a public repo or pre-configured git auth.'
      )
      .optional(),
  }),

  handler: async ({ user_id, repoUrl, includeIssues = false }) => {
    const parsed = parseGitHubRepoUrl(repoUrl);
    if (!parsed) {
      throw new ApiError({
        status: 400,
        code: 'BAD_REPO_URL',
        message: 'Invalid GitHub repoUrl',
        details: { repoUrl },
      });
    }

    const repoSlug = `${parsed.owner}/${parsed.repo}`;
    const namespace = buildNamespace({ userId: user_id, repoSlug });

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
        userId: user_id,
      });

      // NOTE: includeIssues is accepted but currently ignored. We can extend this
      // to call fetchRepoIssues(...) and upsert those chunks as kind: 'issue'.
      return {
        namespace,
        repo: { owner: parsed.owner, repo: parsed.repo },
        includeIssues,
        fileCount,
        chunkCount,
        upserted,
        issueCount: 0,
        issueChunkCount: 0,
        issueUpserted: 0,
      };
    } finally {
      try {
        await fs.rm(workspace, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  },
};

// --- rag_query_namespace (local) ---
export const rag_query_namespace = {
  name: 'rag_query_namespace',
  description:
    'Run a RAG query against a namespace (files + optional issues) in the local Pinecone index and return answer plus structured sources.',

  input_schema: z.object({
    user_id: z
      .string()
      .describe('Current AutoDeploy user id (injected by MCP v2).'),
    namespace: z
      .string()
      .describe('Namespace returned from rag_ingest_zip or rag_ingest_github.'),
    question: z
      .string()
      .describe('User question to ask about the repository.'),
    topK: z
      .number()
      .int()
      .min(1)
      .max(20)
      .describe('Number of top matching chunks to retrieve from Pinecone (1–20). Defaults to 5.')
      .optional(),
  }),

  handler: async ({ user_id, namespace, question, topK }) => {
    ensureNamespaceOwnedByUser(namespace, user_id);

    const [qVec] = await embedBatch([question]);
    const matches = await queryVectors(namespace, qVec, Number(topK) || 5);

    const context = matches
      .map((m) => {
        const meta = m.metadata || {};
        const header = `File: ${meta.path} (chunk ${meta.idx}) [score ${
          m.score?.toFixed?.(3) ?? m.score
        }]`;
        return `${header}\n${meta.text || ''}`;
      })
      .join('\n\n---\n\n');

    const answer = await answerWithContext(question, context);

    await logInteraction({ namespace, jobId: namespace, question, answer });

    const sources = matches.map((m) => ({
      path: m.metadata?.path,
      idx: m.metadata?.idx,
      score: m.score,
    }));

    return { answer, sources };
  },
};

// --- rag_get_logs (local) ---
export const rag_get_logs = {
  name: 'rag_get_logs',
  description:
    'Fetch recent logged interactions for a namespace from the local Supabase-backed query history.',

  input_schema: z.object({
    user_id: z
      .string()
      .describe('Current AutoDeploy user id (injected by MCP v2).'),
    namespace: z
      .string()
      .describe('Namespace whose interaction history should be fetched.'),
    limit: z
      .number()
      .int()
      .min(1)
      .describe('Optional maximum number of rows to fetch. If omitted, backend default is used.')
      .optional(),
  }),

  handler: async ({ user_id, namespace, limit }) => {
    ensureNamespaceOwnedByUser(namespace, user_id);

    const rows = await getHistoryByNamespace({
      namespace,
      limit: limit ? Number(limit) : 50,
    });

    return rows;
  },
};
