import OpenAI from 'openai';

const EMBED_MODEL = process.env.RAG_EMBED_MODEL || 'text-embedding-3-small';

let _client = null;

function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('Missing OPENAI_API_KEY');
    err.status = 500;
    throw err;
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

/**
 * Batch-embed an array of strings using OpenAI embeddings.
 * Returns an array of embedding vectors.
 */
export async function embedBatch(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const client = getClient();

  const res = await client.embeddings.create({
    model: EMBED_MODEL,
    input: texts,
  });

  return res.data.map((d) => d.embedding);
}

export { getClient as getOpenAIClient };
