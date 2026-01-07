import { Pinecone } from '@pinecone-database/pinecone';

let _index = null;

function getIndex() {
  if (_index) return _index;

  const apiKey = process.env.PINECONE_API_KEY;
  const indexName = process.env.PINECONE_INDEX;

  if (!apiKey) {
    const err = new Error('Missing PINECONE_API_KEY');
    err.status = 500;
    throw err;
  }

  if (!indexName) {
    const err = new Error('Missing PINECONE_INDEX');
    err.status = 500;
    throw err;
  }

  const pc = new Pinecone({ apiKey });
  _index = pc.index(indexName);
  return _index;
}

/**
 * Upsert a batch of vectors into a Pinecone namespace.
 *
 * @param {string} namespace - Logical namespace, e.g. `${userId}:${repoSlug}`
 * @param {Array<{ id: string, values: number[], metadata?: Record<string, any> }>} vectors
 */
export async function upsertVectors(namespace, vectors) {
  const index = getIndex();
  await index.namespace(namespace).upsert(vectors);
}

/**
 * Query a Pinecone namespace with a single embedding vector.
 *
 * @param {string} namespace
 * @param {number[]} vector
 * @param {number} topK
 * @returns {Promise<Array<any>>}
 */
export async function queryVectors(namespace, vector, topK) {
  const index = getIndex();
  const res = await index.namespace(namespace).query({
    vector,
    topK,
    includeMetadata: true,
  });
  return res.matches || [];
}

/**
 * Build a stable namespace from user + repo information.
 * This keeps AskMyRepo-style `namespace` semantics while scoping to a user.
 *
 * @param {object} params
 * @param {string|number} params.userId
 * @param {string} params.repoSlug - Typically `owner/repo`.
 */
export function buildNamespace({ userId, repoSlug }) {
  const u = String(userId || '').trim();
  const r = String(repoSlug || '').trim();
  if (!u || !r) {
    throw new Error('buildNamespace requires both userId and repoSlug');
  }
  return `${u}:${r}`;
}
