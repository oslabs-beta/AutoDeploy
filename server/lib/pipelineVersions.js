// Helper for storing versioned copies of workflow YAML files
import crypto from 'crypto';
import { query } from '../db.js';

// Save a new pipeline YAML version with a SHA-256 hash for change tracking
export async function savePipelineVersion({
  userId,
  repoFullName,
  branch,
  workflowPath,
  yaml,
  source = 'pipeline_commit',
}) {
  if (!repoFullName || !branch || !workflowPath || !yaml) {
    throw new Error('Missing required fields for savePipelineVersion');
  }

  const hash = crypto.createHash('sha256').update(yaml, 'utf-8').digest('hex');
  console.log(`hash: ${hash}`);

  const rows = await query(
    `
        INSERT INTO pipeline_versions
            (user_id, repo_full_name, branch, workflow_path, yaml, yaml_hash, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
    [userId ?? null, repoFullName, branch, workflowPath, yaml, hash, source]
  );
  return rows[0];
}
