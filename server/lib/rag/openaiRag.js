import { getOpenAIClient } from './embeddingService.js';

const RAG_MODEL = process.env.RAG_MODEL || 'gpt-4o-mini';
const RAG_TEMPERATURE = Number(process.env.RAG_TEMPERATURE ?? 0.2);

/**
 * Ask the RAG model a question given pre-retrieved context text.
 * Mirrors AskMyRepo's behavior but adapted for AutoDeploy.
 */
export async function answerWithContext(question, context, { style = 'concise' } = {}) {
  const system = [
    'You are a careful code assistant answering questions about a specific repository.',
    '',
    'Grounding & sources',
    '- Answer ONLY using the provided Context. Do not rely on outside knowledge.',
    '- If the Context is insufficient or ambiguous, say so briefly and stop.',
    '- Always include a short "Sources:" list of file paths with chunk indices (e.g., src/app.ts (chunk 1)).',
    '- Prefer citing source files over lockfiles or generated artifacts. Avoid citing:',
    '  - package-lock.json, yarn.lock, pnpm-lock.yaml',
    '  - build/, dist/, node_modules/, .git/, *.map',
    '  unless the user explicitly asks about dependencies or build output.',
    '',
    'Style & structure',
    '- Be concise and direct. Use plain English.',
    '- When showing code, use fenced code blocks with the correct language.',
    '- Do NOT reveal chain-of-thought. Provide conclusions and brief evidence only.',
    '- If multiple files disagree, call that out and pick the best-supported interpretation from the Context.',
    '',
    'Formatting',
    '- Final output MUST end with:',
    '  Sources:',
    '  - <path> (chunk N)',
    '  - <path> (chunk M)',
    '',
    style === 'verbose'
      ? 'Answer length: provide fuller explanations when helpful.'
      : 'Answer length: keep answers concise.',
  ].join('\n');

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `Question:\n${question}\n\nContext:\n${context}` },
  ];

  const client = getOpenAIClient();
  const resp = await client.chat.completions.create({
    model: RAG_MODEL,
    temperature: RAG_TEMPERATURE,
    messages,
  });

  return resp?.choices?.[0]?.message?.content || '';
}
