import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { ApiError } from '../lib/httpEnvelope.js';

const ASKMYREPO_BASE = (process.env.ASKMYREPO_URL || 'http://localhost:3001').replace(/\/+$/, '');

async function parseJsonResponse(res, context) {
  const text = await res.text().catch(() => '');
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // fall through – non-JSON error body
  }

  if (!res.ok) {
    const message =
      data?.error || data?.message || `${context} failed: ${res.status} ${res.statusText}`;

    throw new ApiError({
      status: res.status || 500,
      code: 'ASKMYREPO_HTTP_ERROR',
      message,
      details: data || text || null,
    });
  }

  return data;
}

// --- rag_ingest_zip ---
// Note: this runs inside AutoDeploy's Node process. `file_path` MUST be readable
// from this server's filesystem. The tool will POST it to AskMyRepo as repoZip.
export const rag_ingest_zip = {
  name: 'rag_ingest_zip',
  description:
    'Upload a zipped repository from the AutoDeploy server filesystem and ingest it into AskMyRepo (/api/v2/ingest/zip). Returns a namespace and stats.',

  input_schema: z.object({
    file_path: z.string().describe(
      'Absolute or working-directory-relative path to a .zip file on the AutoDeploy server. The file will be streamed to AskMyRepo as multipart form-data field `repoZip`.'
    ),
  }),

  handler: async ({ file_path }) => {
    let buf;
    try {
      buf = await fs.readFile(file_path);
    } catch (err) {
      throw new ApiError({
        status: 400,
        code: 'ZIP_NOT_FOUND',
        message: `Could not read zip file at path: ${file_path}`,
        details: err?.message,
      });
    }

    const blob = new Blob([buf], { type: 'application/zip' });
    const form = new FormData();
    form.append('repoZip', blob, path.basename(file_path));

    const res = await fetch(`${ASKMYREPO_BASE}/api/v2/ingest/zip`, {
      method: 'POST',
      body: form,
    });

    const data = await parseJsonResponse(res, 'AskMyRepo zip ingest');

    // Expected shape: { message, namespace, jobId, fileCount, chunkCount, upserted }
    return data;
  },
};

// --- rag_ingest_github ---
export const rag_ingest_github = {
  name: 'rag_ingest_github',
  description:
    'Ingest a GitHub repository (and optionally its Issues) into AskMyRepo RAG backend via /api/v2/ingest/github. Returns namespace and ingestion stats.',

  input_schema: z.object({
    repoUrl: z.string().describe('GitHub repository URL, e.g. https://github.com/OWNER/REPO.'),
    namespace: z
      .string()
      .describe('Optional explicit Pinecone namespace. If omitted, AskMyRepo derives one from the repo name.')
      .optional(),
    includeIssues: z
      .boolean()
      .describe('Whether to ingest GitHub Issues (and a limited number of comments). Defaults to true.')
      .optional()
      .default(true),
    githubToken: z
      .string()
      .describe(
        'Optional GitHub PAT for authenticated API calls. If provided, it is sent as Authorization: Bearer <token> to AskMyRepo.'
      )
      .optional(),
  }),

  handler: async ({ repoUrl, namespace, includeIssues = true, githubToken }) => {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

    const body = {
      repoUrl,
      namespace: namespace || undefined,
      includeIssues,
    };

    const res = await fetch(`${ASKMYREPO_BASE}/api/v2/ingest/github`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await parseJsonResponse(res, 'AskMyRepo GitHub ingest');

    // Expected shape: { namespace, repo: { owner, repo }, includeIssues, fileCount, chunkCount, upserted, issueCount, issueChunkCount, issueUpserted }
    return data;
  },
};

// --- rag_query_namespace ---
export const rag_query_namespace = {
  name: 'rag_query_namespace',
  description:
    'Run a RAG query against a namespace (files + issues) via AskMyRepo /api/v2/query and return answer plus structured sources.',

  input_schema: z.object({
    namespace: z.string().describe('Namespace returned from rag_ingest_zip or rag_ingest_github.'),
    question: z.string().describe('User question to ask about the repository.'),
    topK: z
      .number()
      .int()
      .min(1)
      .max(20)
      .describe('Number of top matching chunks to retrieve from Pinecone (1–20). Defaults to 5.')
      .optional(),
  }),

  handler: async ({ namespace, question, topK }) => {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const body = {
      namespace,
      question,
      ...(topK ? { topK } : {}),
    };

    const res = await fetch(`${ASKMYREPO_BASE}/api/v2/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await parseJsonResponse(res, 'AskMyRepo RAG query');

    // Expected shape: { answer, sources: [...] }
    return data;
  },
};

// --- rag_get_logs ---
export const rag_get_logs = {
  name: 'rag_get_logs',
  description:
    'Fetch recent logged interactions for a namespace from AskMyRepo via /api/v2/logs. Returns rows from Supabase (query_history/logs).',

  input_schema: z.object({
    namespace: z.string().describe('Namespace whose interaction history should be fetched.'),
    limit: z
      .number()
      .int()
      .min(1)
      .describe('Optional maximum number of rows to fetch. If omitted, backend default is used.')
      .optional(),
  }),

  handler: async ({ namespace, limit }) => {
    const qs = new URLSearchParams({ namespace });
    if (limit) qs.set('limit', String(limit));

    const url = `${ASKMYREPO_BASE}/api/v2/logs?${qs.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const data = await parseJsonResponse(res, 'AskMyRepo logs');

    // Expected shape: array of Supabase rows.
    return data;
  },
};
