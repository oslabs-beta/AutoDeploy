import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';

const router = Router();

// Schemas
const CreateBody = z.object({
  user_id: z.string().uuid().optional(),
  provider: z.string().min(1),
  repo_full_name: z.string().min(3),
  environment: z.string().min(1),
  branch: z.string().min(1).optional(),
  commit_sha: z.string().min(6).optional(),
  summary: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const StatusBody = z.object({
  status: z.enum(['queued', 'running', 'success', 'failed', 'canceled']),
  summary: z.string().optional(),
  finished: z.boolean().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// Create a deployment (queued)
router.post('/', async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.message });

  const {
    user_id,
    provider,
    repo_full_name,
    environment,
    branch,
    commit_sha,
    summary,
    metadata,
  } = parsed.data;

  try {
    const rows = await query(
      `
      insert into public.deployment_logs
        (user_id, provider, repo_full_name, environment, branch, commit_sha,
         status, started_at, summary, metadata)
      values ($1, $2, $3, $4, $5, $6,
              'queued', now(), $7, coalesce($8::jsonb, '{}'::jsonb))
      returning *;
      `,
      [
        user_id ?? null,
        provider ?? null,
        repo_full_name ?? null,
        environment ?? null,
        branch ?? null,
        commit_sha ?? null,
        summary ?? null,
        metadata ?? null,
      ]
    );
    return res.status(201).json({ deployment: rows[0] });
  } catch (e) {
    console.error('[POST /deployments] error:', e);
    return res.status(500).json({ error: e.message });
  }
});

// Update status (and optionally finish) + merge metadata
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const parsed = StatusBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.message });

  const { status, summary, finished, metadata } = parsed.data;

  // Build dynamic SET list safely
  const sets = [
    `status = $1`,
    `summary = coalesce($2, summary)`,
    // merge metadata: existing || new (right-hand wins)
    `metadata = coalesce(metadata, '{}'::jsonb) || coalesce($3::jsonb, '{}'::jsonb)`,
  ];
  const vals = [
    status,
    summary ?? null,
    metadata ? JSON.stringify(metadata) : null,
  ];

  if (finished) sets.push(`finished_at = now()`);

  try {
    const rows = await query(
      `update public.deployment_logs set ${sets.join(
        ', '
      )} where id = $4 returning *;`,
      [...vals, id]
    );
    if (!rows.length)
      return res.status(404).json({ error: 'Deployment not found' });
    return res.json({ deployment: rows[0] });
  } catch (e) {
    console.error('[PATCH /deployments/:id/status] error:', e);
    return res.status(500).json({ error: e.message });
  }
});

// Get deployments (filterable)
router.get('/', async (req, res) => {
  const { repo_full_name, environment, status, limit = '50' } = req.query;

  const clauses = [];
  const vals = [];
  let i = 0;

  if (repo_full_name) {
    clauses.push(`repo_full_name = $${++i}`);
    vals.push(String(repo_full_name));
  }
  if (environment) {
    clauses.push(`environment = $${++i}`);
    vals.push(String(environment));
  }
  if (status) {
    clauses.push(`status = $${++i}::deploy_status`);
    vals.push(String(status));
  }

  const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
  const lim = Math.min(parseInt(String(limit), 10) || 50, 200);

  try {
    const rows = await query(
      `
      select *
      from public.deployment_logs
      ${where}
      order by started_at desc
      limit ${lim};
      `,
      vals
    );
    return res.json({ deployments: rows });
  } catch (e) {
    console.error('[GET /deployments] error:', e);
    return res.status(500).json({ error: e.message });
  }
});

// Get one deployment
router.get('/:id', async (req, res) => {
  try {
    const rows = await query(
      `select * from public.deployment_logs where id = $1;`,
      [req.params.id]
    );
    if (!rows.length)
      return res.status(404).json({ error: 'Deployment not found' });
    return res.json({ deployment: rows[0] });
  } catch (e) {
    console.error('[GET /deployments/:id] error:', e);
    return res.status(500).json({ error: e.message });
  }
});

/** ---------- Retry an existing deployment by id ---------- **/
router.post('/:id/retry', async (req, res) => {
  try {
    const [orig] = await query(
      `select * from public.deployment_logs where id = $1;`,
      [req.params.id]
    );
    if (!orig)
      return res.status(404).json({ error: 'Original deployment not found' });

    // Create a new 'queued' deployment with action='retry' and same commit/env/repo
    const rows = await query(
      `
      insert into public.deployment_logs
        (user_id, provider, repo_full_name, environment, branch, commit_sha,
         action, status, started_at, summary, metadata, parent_id)
      values ($1,$2,$3,$4,$5,$6,
              'retry','queued', now(), $7, $8::jsonb, $9)
      returning *;
      `,
      [
        orig.user_id,
        orig.provider,
        orig.repo_full_name,
        orig.environment,
        orig.branch,
        orig.commit_sha, // retry same SHA
        `Retry of ${orig.id}`,
        JSON.stringify({ ...orig.metadata, retry_of: orig.id }),
        orig.id,
      ]
    );

    return res.status(201).json({ deployment: rows[0] });
  } catch (e) {
    console.error('[POST /deployments/:id/retry] error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/** ---------- Rollback to a commit (explicit) ---------- **/
const RollbackBody = z.object({
  repo_full_name: z.string().min(3),
  environment: z.string().min(1),
  commit_sha: z.string().min(6), // the target known-good SHA
  summary: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

router.post('/rollback', async (req, res) => {
  const RollbackBody = z.object({
    repo_full_name: z.string().min(3),
    environment: z.string().min(1),
    branch: z.string().min(1).default('main'), // ✅ branch added here
    commit_sha: z.string().min(6),
    summary: z.string().optional(),
    metadata: z.record(z.unknown()).default({}),
  });

  const parsed = RollbackBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.message });

  const { repo_full_name, environment, branch, commit_sha, summary, metadata } =
    parsed.data;

  try {
    const rows = await query(
      `
      insert into public.deployment_logs
        (provider, repo_full_name, environment, branch, commit_sha, action, status, started_at, summary, metadata)
      values ('github_actions', $1, $2, $3, $4, 'rollback', 'queued', now(), $5, $6::jsonb)
      returning *;
      `,
      [
        repo_full_name,
        environment,
        branch, // ✅ we’re now including branch in the insert
        commit_sha,
        summary ?? `Rollback to ${commit_sha}`,
        JSON.stringify(metadata ?? {}),
      ]
    );

    return res.status(201).json({ deployment: rows[0] });
  } catch (e) {
    console.error('[POST /deployments/rollback] error:', e);
    return res.status(500).json({
      error: e.message,
      detail: e.detail,
      code: e.code,
    });
  }
});

/** ---------- Rollback to last success (auto) ---------- **/
const AutoRollbackBody = z.object({
  repo_full_name: z.string().min(3),
  environment: z.string().min(1),
  summary: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});

router.post('/rollback/last-success', async (req, res) => {
  const parsed = AutoRollbackBody.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.message });

  const { repo_full_name, environment, summary, metadata } = parsed.data;

  try {
    const last = await query(
      `
      select commit_sha
      from public.deployment_logs
      where repo_full_name = $1
        and environment    = $2
        and status         = 'success'
        and commit_sha is not null
      order by started_at desc
      limit 1;
      `,
      [repo_full_name, environment]
    );
    if (!last.length) {
      return res
        .status(400)
        .json({ error: 'No previous successful commit found' });
    }
    const commit_sha = last[0].commit_sha;

    const rows = await query(
      `
      insert into public.deployment_logs
        (provider, repo_full_name, environment, commit_sha, action, status, started_at, summary, metadata)
      values ('github_actions', $1, $2, $3, 'rollback', 'queued', now(), $4, $5::jsonb)
      returning *;
      `,
      [
        repo_full_name,
        environment,
        commit_sha,
        summary ?? `Rollback to last success ${commit_sha}`,
        JSON.stringify(metadata),
      ]
    );

    return res.status(201).json({ deployment: rows[0] });
  } catch (e) {
    console.error('[POST /deployments/rollback/last-success] error:', e);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
