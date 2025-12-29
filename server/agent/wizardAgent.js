import OpenAI from 'openai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const MCP_BASE_URL =
  (process.env.MCP_BASE_URL || 'http://localhost:3000/mcp/v1').replace(
    /\/$/,
    ''
  );

// Internal base URL for calling our own RAG HTTP API.
// Defaults to talking to this server on PORT (or 3000).
const RAG_BASE_URL = (
  process.env.RAG_BASE_URL ||
  `http://127.0.0.1:${process.env.PORT || 3000}`
).replace(/\/$/, '');

// Added by Lorenc
// Lazily create the OpenAI client so the server can boot even if OPENAI_API_KEY is missing.
// We only require the key when the wizard agent actually needs to call OpenAI.
let _openaiClient = null;
function getOpenAIClient() {
  if (_openaiClient) return _openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is missing. Set it as an environment variable (e.g., in Cloud Run) to use the wizard agent.'
    );
  }

  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}
// -----------------------

// --- Intent extraction using LLM (structured, no regex routing) ---
async function extractGitHubIntent(llmClient, userText) {
  const intentPrompt = `
You are an intent classifier for a GitHub automation agent.

Return ONLY valid JSON. Do not explain anything.

Valid intents:
- list_repos
- repo_info
- list_root
- list_path
- check_file
- check_dir
- read_file
- list_workflows
- list_branches
- list_commits

Return JSON with exactly these fields:
{
  "intent": string,
  "repo": string | null,
  "path": string | null
}

User request:
"${userText}"
`;

  const res = await llmClient.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: intentPrompt }],
  });

  try {
    return JSON.parse(res.choices[0].message.content);
  } catch (e) {
    console.warn("⚠️ Failed to parse intent JSON, falling back to repo_info");
    return { intent: "repo_info", repo: null, path: null };
  }
}

// Helper: call MCP routes dynamically, with error handling
async function callMCPTool(tool, input, cookie) {
  try {
    const response = await fetch(`${MCP_BASE_URL}/${tool}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie:
          cookie ||
          (process.env.MCP_SESSION_TOKEN
            ? `mcp_session=${process.env.MCP_SESSION_TOKEN}`
            : ''),
      },
      body: JSON.stringify(input),
    });
    return await response.json();
  } catch (err) {
    console.warn('⚠️ MCP call failed:', err.message || err);
    return {
      success: false,
      error: 'MCP server unreachable',
      details: err?.message,
    };
  }
}

// Simple pro-only RAG helpers -------------------------------------------------

function normalizeGithubRepoUrl(repoUrlOrSlug) {
  if (!repoUrlOrSlug) return null;
  if (repoUrlOrSlug.startsWith('http://') || repoUrlOrSlug.startsWith('https://')) {
    return repoUrlOrSlug;
  }
  // Treat as owner/repo slug
  const slug = repoUrlOrSlug.replace(/^https?:\/\/github.com\//i, '').replace(/\.git$/i, '');
  return `https://github.com/${slug}`;
}

// Lightweight YAML summarization used in user mode when analyzing workflows
async function summarizeWorkflowYamlForUser({ repoSlug, workflowName, workflowPath, yaml }) {
  if (!yaml || typeof yaml !== 'string' || !yaml.trim()) return '';

  let client;
  try {
    client = getOpenAIClient();
  } catch (e) {
    console.warn(
      '⚠️ Skipping workflow YAML summaries (OpenAI not configured):',
      e?.message || e
    );
    return '';
  }

  try {
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a CI/CD assistant. Given a GitHub Actions workflow YAML, briefly explain when it runs (triggers) and what its main jobs/steps do. Then suggest 1-3 concrete, practical improvements. Keep the answer under 200 words.',
        },
        {
          role: 'user',
          content:
            `Repository: ${repoSlug}\n` +
            `Workflow: ${workflowName}\n` +
            `Path: ${workflowPath}\n\n` +
            'YAML:\n' +
            yaml,
        },
      ],
    });

    const text = resp?.choices?.[0]?.message?.content || '';
    return text.trim();
  } catch (e) {
    console.warn(
      '⚠️ Failed to summarize workflow YAML for user mode:',
      e?.message || e
    );
    return '';
  }
}

async function ragIngestGithub({ repoUrl, cookie }) {
  const githubUrl = normalizeGithubRepoUrl(repoUrl);
  console.log('[RAG][ingest] Starting GitHub workflows ingest', {
    repoUrl,
    normalized: githubUrl,
    RAG_BASE_URL,
  });

  // For workflow analysis we only need YAML workflows, not the
  // entire repository. Use the /ingest/github-workflows endpoint
  // which indexes just .yml/.yaml files.
  const res = await fetch(`${RAG_BASE_URL}/api/rag/ingest/github-workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
    },
    body: JSON.stringify({ repoUrl: githubUrl, includeIssues: false }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[RAG][ingest] GitHub workflows ingest failed', {
      status: res.status,
      error: data?.error,
      body: data,
    });
    throw new Error(data?.error || `RAG ingest failed with status ${res.status}`);
  }

  console.log('[RAG][ingest] GitHub workflows ingest succeeded', {
    namespace: data?.namespace,
    repo: data?.repo,
    fileCount: data?.fileCount,
    chunkCount: data?.chunkCount,
    upserted: data?.upserted,
  });

  return data; // includes { namespace, repo, fileCount, ... }
}

async function ragQueryNamespace({ namespace, question, topK = 5, cookie }) {
  console.log('[RAG][query] Starting namespace query', {
    namespace,
    topK,
    questionPreview: (question || '').slice(0, 200),
  });

  const res = await fetch(`${RAG_BASE_URL}/api/rag/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie || '',
    },
    body: JSON.stringify({ namespace, question, topK }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[RAG][query] Namespace query failed', {
      status: res.status,
      error: data?.error,
      body: data,
    });
    throw new Error(data?.error || `RAG query failed with status ${res.status}`);
  }

  console.log('[RAG][query] Namespace query succeeded', {
    namespace,
    answerPreview: (data?.answer || '').slice(0, 200),
    sourceCount: Array.isArray(data?.sources) ? data.sources.length : 0,
    sources: Array.isArray(data?.sources)
      ? data.sources.map((s) => ({ path: s.path, idx: s.idx, score: s.score }))
      : [],
  });

  return data; // { answer, sources }
}

async function extractWorkflowSuggestionsFromAnswer(question, ragAnswer) {
  try {
    const client = getOpenAIClient();
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You summarize CI/CD workflow advice. Extract up to 3 concrete workflow improvement suggestions as JSON.',
        },
        {
          role: 'user',
          content:
            `User question:\n${question}\n\nAnswer about the repo:\n${ragAnswer}\n\n` +
            'Return ONLY valid JSON: an array of {"id": string, "title": string, "description": string}.',
        },
      ],
    });

    let raw = resp?.choices?.[0]?.message?.content || '[]';
    raw = raw.trim();
    // Handle common pattern where the model wraps JSON in ```json ... ``` fences
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((s, idx) => ({
        id: s.id || `s${idx + 1}`,
        title: s.title || 'Suggestion',
        description: s.description || '',
      }));
    }
  } catch (e) {
    console.warn('⚠️ Failed to extract workflow suggestions from RAG answer:', e?.message || e);
  }
  return [];
}

async function askRagForWorkflows({ user, repoUrl, question, cookie }) {
  if (!RAG_BASE_URL) {
    throw new Error('RAG_BASE_URL is not configured');
  }
  const ingest = await ragIngestGithub({ repoUrl, cookie });
  const namespace = ingest.namespace;
  const query = await ragQueryNamespace({ namespace, question, topK: 5, cookie });
  const answer = query?.answer || '';
  const sources = query?.sources || [];
  const suggestions = await extractWorkflowSuggestionsFromAnswer(question, answer);
  return { namespace, answer, sources, suggestions };
}

// Wizard Agent Core
export async function runWizardAgent(userPrompt, options = {}) {
  const { mode = 'user', user = null, allowPipelineCommit = false } = options;
  // Normalize userPrompt into a consistent text form + extract cookie
  const userPromptText =
    typeof userPrompt === 'string'
      ? userPrompt
      : userPrompt?.content ||
        userPrompt?.message ||
        userPrompt?.prompt ||
        userPrompt?.body?.content ||
        userPrompt?.body?.message ||
        userPrompt?.body?.prompt ||
        '';

  // 🛑 Intent guard: handle meta / capability questions WITHOUT tools
  if (/what can you do|what do you do|help|capabilities|how does this work/i.test(userPromptText)) {
    return {
      success: true,
      agent_decision: "capabilities",
      tool_called: null,
      message: `
I’m your CI/CD wizard. Here’s what I can help you with:

• Analyze your GitHub repositories
• Generate GitHub Actions CI/CD pipelines
• Suggest best practices (branches, caching, matrix builds)
• Configure Node, Python, or container-based workflows
• Help commit workflows and open pull requests
• Explain CI/CD concepts step by step

Tell me what you’d like to do next.
`
    };
  }

  // Guard: prevent empty or meaningless prompts from reaching the LLM
  if (!userPromptText || userPromptText.trim().length < 3) {
    return {
      success: false,
      agent_decision:
        "Your message was too short or empty. Please provide more detail, such as 'list my repos' or 'tell me about user/repo'.",
      tool_called: null,
      message: 'Please provide a more descriptive request.',
    };
  }

  const cookie = userPrompt?.cookie || '';
  const pipelineSnapshot =
    userPrompt?.pipelineSnapshot ||
    userPrompt?.body?.pipelineSnapshot ||
    null;

  // Detect workflow-analysis questions
  const lower = userPromptText.toLowerCase();
  const looksLikeWorkflowAnalysis =
    /workflow|ci\/cd|pipeline|github actions/.test(lower) &&
    /(analy|explain|understand|what.*do|how.*work|missing)/.test(lower);

  const repoUrlFromInput =
    userPrompt?.repoUrl ||
    userPrompt?.body?.repoUrl ||
    pipelineSnapshot?.repo ||
    null;

// User mode: try lightweight workflow analysis via github_adapter (no RAG)
  if (mode === 'user' && repoUrlFromInput && looksLikeWorkflowAnalysis) {
    try {
      let slug = null;
      if (/^https?:\/\//i.test(repoUrlFromInput)) {
        try {
          const u = new URL(repoUrlFromInput);
          const parts = u.pathname
            .replace(/^\//, '')
            .replace(/\.git$/i, '')
            .split('/');
          if (parts[0] && parts[1]) slug = `${parts[0]}/${parts[1]}`;
        } catch {
          // ignore
        }
      } else if (repoUrlFromInput.includes('/')) {
        slug = repoUrlFromInput;
      }

      if (slug) {
        const outer = await callMCPTool(
          'github_adapter',
          { action: 'workflows', repo: slug },
          cookie
        );

        const body =
          outer && typeof outer === 'object' && 'data' in outer
            ? outer.data
            : outer;
        const workflows = body?.workflows;

        if (Array.isArray(workflows)) {
          if (workflows.length === 0) {
            const reply =
              `I didn’t find any GitHub Actions workflows for ${slug}. You can ask me to propose a new CI pipeline for this repo.`;
            return {
              success: true,
              agent_decision: 'user_workflow_analysis',
              tool_called: 'github_adapter',
              reply,
              message: reply,
              workflows: [],
            };
          }

          const lines = [
            `I found ${workflows.length} GitHub Actions workflows for ${slug}:`,
            '',
            ...workflows.map(
              (wf, idx) =>
                `${idx + 1}. ${wf.name} (${wf.state}) — ${wf.path}`
            ),
          ];

          // Enrich each workflow with a brief summary + suggestions by
          // fetching the YAML via github_adapter (file action) and calling
          // the LLM. This only runs in user mode and degrades gracefully
          // if OpenAI is not configured or if any individual call fails.
          const detailSections = [];
          for (const wf of workflows) {
            try {
              const fileOuter = await callMCPTool(
                'github_adapter',
                { action: 'file', repo: slug, path: wf.path },
                cookie
              );
              const fileBody =
                fileOuter && typeof fileOuter === 'object' && 'data' in fileOuter
                  ? fileOuter.data
                  : fileOuter;

              const yaml = fileBody?.file?.content || null;
              const summary = await summarizeWorkflowYamlForUser({
                repoSlug: slug,
                workflowName: wf.name,
                workflowPath: wf.path,
                yaml,
              });

              if (summary) {
                detailSections.push(
                  [
                    '',
                    '---',
                    `${wf.name} (${wf.state}) — ${wf.path}`,
                    summary,
                  ].join('\n')
                );
              }
            } catch (innerErr) {
              console.warn(
                '⚠️ Failed to fetch or summarize workflow YAML in user mode:',
                innerErr?.message || innerErr
              );
            }
          }

          const reply = [...lines, ...detailSections].join('\n');

          return {
            success: true,
            agent_decision: 'user_workflow_analysis',
            tool_called: 'github_adapter',
            reply,
            message: reply,
            workflows,
          };
        }
      }
    } catch (e) {
      console.warn(
        '⚠️ User-mode workflow analysis via github_adapter failed, falling back:',
        e?.message || e
      );
      // fall through to default behavior
    }
  }

  // Pro-mode: try RAG-based workflow analysis for deep workflow questions
  if (mode === 'pro' && repoUrlFromInput && looksLikeWorkflowAnalysis) {
    try {
      const ragQuestion =
        userPromptText +
        '\n\nFocus your answer specifically on CI/CD workflows (GitHub Actions, tests, builds, and deployments) for this repository.';

      console.log('[RAG][workflow-analysis] Pro user workflow analysis request', {
        userId: user?.user_id || user?.id,
        repoUrl: repoUrlFromInput,
        questionPreview: ragQuestion.slice(0, 200),
      });

      const ragResult = await askRagForWorkflows({
        user,
        repoUrl: repoUrlFromInput,
        question: ragQuestion,
        cookie,
      });

      console.log('[RAG][workflow-analysis] Query result meta', {
        namespace: ragResult?.namespace,
        suggestionCount: Array.isArray(ragResult?.suggestions)
          ? ragResult.suggestions.length
          : 0,
        sourceCount: Array.isArray(ragResult?.sources)
          ? ragResult.sources.length
          : 0,
      });

      const rawAnswer = ragResult.answer || '';
      const noWorkflowContext = /does not include any specific information about the CI\/CD workflows|cannot analyze your current workflows/i.test(
        rawAnswer
      );

      console.log('[RAG][workflow-analysis] Answer diagnostics', {
        noWorkflowContext,
        answerPreview: rawAnswer.slice(0, 400),
        sources: Array.isArray(ragResult?.sources)
          ? ragResult.sources.map((s) => ({ path: s.path, idx: s.idx, score: s.score }))
          : [],
      });

      const reply = noWorkflowContext
        ? 'I couldn’t find any existing CI/CD workflows in the code I ingested for this repo. Based on general best practices, here are workflow improvements you might consider adding.'
        : rawAnswer;

      return {
        success: true,
        agent_decision: 'rag_workflow_analysis',
        tool_called: 'rag_query',
        reply,
        message: reply,
        suggestions: ragResult.suggestions,
        sources: ragResult.sources,
        rag_namespace: ragResult.namespace,
        no_workflow_context: noWorkflowContext,
      };
    } catch (e) {
      console.warn(
        '⚠️ RAG workflow analysis failed, falling back to default agent path:',
        e?.message || e,
        {
          repoUrl: repoUrlFromInput,
          mode,
        }
      );
      // fall through to normal agent behavior
    }
  }

  const systemPrompt = `
  You are the MCP Wizard Agent.
  You have full access to the following connected tools and APIs:
  - repo_reader: reads local and remote repositories, useful for listing or describing repositories
  - pipeline_generator: generates CI/CD YAMLs
  - oidc_adapter: lists AWS roles or Jenkins jobs
  - github_adapter: fetches real-time GitHub repository data through an authenticated API connection
  - gcp_adapter: fetches Google Cloud information
  Do not say that you lack access to GitHub or external data — you can retrieve this information directly through the available tools.
  Only call tools when the user explicitly asks for data retrieval or actions. Do NOT call tools for explanations, help, or capability questions.

  If the user asks:
  - “What repositories do I have on GitHub?” → use \`github_adapter\` with \`{ action: "repos" }\`
  - “Tell me about [username/repo]” → use \`github_adapter\` with \`{ action: "info", repo: "[username/repo]" }\`
  - “Tell me about [username/repo] using repo_reader” → use \`repo_reader\` with \`{ username: "...", repo: "[username/repo]" }\`
  - “List branches for [username/repo]” → use \`github_adapter\` with \`{ action: "branches", repo: "[username/repo]" }\`
  - “Show recent commits for [username/repo]” → use \`github_adapter\` with \`{ action: "commits", repo: "[username/repo]" }\`
  - “List workflows for [username/repo]” → use \`github_adapter\` with \`{ action: "workflows", repo: "[username/repo]" }\`
  - “List repos”, “List repositories”, or “repositories” → use \`repo_reader\` with optional \`{ username: "...", user_id: "..." }\`
  Valid CI/CD template types are ONLY:
  - node_app
  - python_app
  - container_service

  When selecting or generating a pipeline template, you MUST return one of these exact values.
  Never invent new template names. If unsure, default to "node_app".
  `;
  // Added by Lorenc
  let client;
  try {
    client = getOpenAIClient();
  } catch (e) {
    // Important: do not crash the whole server/container if OpenAI isn't configured.
    return {
      success: false,
      agent_decision: 'OpenAI not configured',
      tool_called: null,
      message: e?.message || 'OPENAI_API_KEY is missing.',
    };
  }
  //--------------

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content:
          typeof userPrompt === 'string'
            ? userPrompt
            : userPrompt?.content ||
              userPrompt?.message ||
              userPrompt?.prompt ||
              '',
      },
    ],
  });

  const decision = completion.choices[0].message.content;
  console.log('\n🤖 Agent decided:', decision);

  let agentMeta = {
    agent_decision: decision,
    tool_called: null,
  };

  // Tool mapping using regex patterns
  const toolMap = {
    repo_reader: /\b(list repos|list repositories|repo_reader)\b/i,
    pipeline_generator: /\bpipeline\b/i,
    pipeline_commit:
      /\b(yes commit|commit (the )?(pipeline|workflow|file)|apply (the )?(pipeline|workflow)|save (the )?(pipeline|workflow)|push (the )?(pipeline|workflow))\b/i,
    oidc_adapter: /\b(role|jenkins)\b/i,
    github_adapter:
      /\b(github|repo info|repositories?|repos?\b|repo\b|[\w-]+\/[\w-]+)\b/i,
  };

  // Short-circuit if agent_decision is "capabilities"
  if (agentMeta.agent_decision === "capabilities") {
    return {
      success: true,
      agent_decision: agentMeta.agent_decision,
      tool_called: null
    };
  }

  for (const [toolName, pattern] of Object.entries(toolMap)) {
    if (pattern.test(userPromptText)) {
      console.log('🔧 Triggering MCP tool:', toolName);

      // --- Extract context dynamically from userPrompt or decision ---
      // Prefer explicit labels like: "repo owner/name", "template node_app", "provider aws"
      const labeledRepo =
        userPromptText.match(
          /\brepo\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i
        ) || decision.match(/\brepo\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i);
      const genericRepo = (userPromptText + ' ' + decision).match(
        /\b(?!ci\/cd\b)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/
      );

      // Fallback: use repoUrl from input (slug or GitHub URL) if no repo extracted from text
      let repoFromPayloadSlug = null;
      const rawRepoFromPayload =
        userPrompt?.repoUrl ||
        userPrompt?.body?.repoUrl ||
        null;
      if (rawRepoFromPayload) {
        if (/^https?:\/\//i.test(rawRepoFromPayload)) {
          try {
            const u = new URL(rawRepoFromPayload);
            const parts = u.pathname
              .replace(/^\//, '')
              .replace(/\.git$/i, '')
              .split('/');
            if (parts[0] && parts[1]) {
              repoFromPayloadSlug = `${parts[0]}/${parts[1]}`;
            }
          } catch {
            // ignore URL parse failures
          }
        } else if (rawRepoFromPayload.includes('/')) {
          repoFromPayloadSlug = rawRepoFromPayload;
        }
      }

      const repo =
        labeledRepo?.[1] ||
        genericRepo?.[1] ||
        pipelineSnapshot?.repo ||
        repoFromPayloadSlug ||
        null;

      const labeledProvider =
        userPromptText.match(/\bprovider\s+(aws|jenkins|gcp|azure)\b/i) ||
        decision.match(/\bprovider\s+(aws|jenkins|gcp|azure)\b/i);
      const genericProvider =
        userPromptText.match(/\b(aws|jenkins|github actions|gcp|azure)\b/i) ||
        decision.match(/\b(aws|jenkins|github actions|gcp|azure)\b/i);
      const provider = (labeledProvider?.[1] || genericProvider?.[1] || null)
        ?.toLowerCase()
        .replace(/\s+/g, ' ');

      const labeledTemplate =
        userPromptText.match(/\btemplate\s+([a-z_][a-z0-9_]+)\b/i) ||
        decision.match(/\btemplate\s+([a-z_][a-z0-9_]+)\b/i);
      const genericTemplate =
        userPromptText.match(
          /\b(node_app|python_app|container_service|node|python|react|express|django|flask|java|go)\b/i
        ) ||
        decision.match(
          /\b(node_app|python_app|container_service|node|python|react|express|django|flask|java|go)\b/i
        );
      const template = (
        labeledTemplate?.[1] ||
        genericTemplate?.[1] ||
        null
      )?.toLowerCase();

      if (toolName === "repo_reader") {
        // Prevent accidental file reads with repo_reader
        if (/\b(read|get|open)\b.*\b(file|contents)\b/i.test(userPromptText)) {
          return {
            success: false,
            error: "File reading is handled by the GitHub adapter. Please specify a GitHub repository and file path."
          };
        }
        // Extract optional username, user_id, and repo info
        const usernameMatch = userPromptText.match(
          /\busername[:=]?\s*([\w-]+)\b/i
        );
        const userIdMatch = userPromptText.match(
          /\buser[_ ]?id[:=]?\s*([\w-]+)\b/i
        );
        const repoMatch = userPromptText.match(/\b([\w-]+\/[\w-]+)\b/);

        const payload = {};
        if (usernameMatch) payload.username = usernameMatch[1];
        if (userIdMatch) payload.user_id = userIdMatch[1];
        if (repoMatch) {
          const [username, repo] = repoMatch[1].split('/');
          payload.username = username;
          payload.repo = `${username}/${repo}`;
        }

        agentMeta.tool_called = 'repo_reader';
        const output = await callMCPTool('repo_reader', payload, cookie);
        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          tool_output: output,
        };
      }

      if (toolName === 'pipeline_generator') {
        // Only allow pipeline generation if we have a repo context
        if (!repo) {
          console.warn('⚠️ Missing repo context for pipeline generation.');
          return {
            success: false,
            error:
              "I couldn’t determine which repository you meant. Please specify it, e.g., 'generate pipeline for user/repo'.",
          };
        }

        // Build payload strictly from UI/intent, NOT from any AI-generated YAML
        const payload = { repo };
        // 🔒 Template is authoritative from UI snapshot
        if (pipelineSnapshot?.template) {
          console.log(`🔒 Template locked from pipeline snapshot: ${pipelineSnapshot.template}`);
          payload.template = pipelineSnapshot.template;
        }
        if (pipelineSnapshot?.branch) {
          payload.branch = pipelineSnapshot.branch;
        }
        // Provider locked from pipelineSnapshot if present
        if (pipelineSnapshot?.provider) {
          payload.provider = pipelineSnapshot.provider;
          console.log(`🔒 Provider locked from pipeline snapshot: ${payload.provider}`);
        } else if (provider) {
          payload.provider = provider;
        }
        // Template explicit or inferred, but UI snapshot is authoritative
        if (!payload.template && template) payload.template = template;
        // Fetch GitHub repo details to help infer template/provider if needed
        let repoInfo = null;
        try {
          const info = await callMCPTool(
            'github_adapter',
            { action: 'info', repo },
            cookie
          );
          if (info?.data?.success) {
            repoInfo = info.data;
            console.log(`📦 Retrieved repo info from GitHub:`, repoInfo);
          }
        } catch (err) {
          console.warn(
            '⚠️ Failed to fetch GitHub info before pipeline generation:',
            err.message
          );
        }
        // Merge language or visibility into payload if available
        if (repoInfo?.language && !payload.language)
          payload.language = repoInfo.language.toLowerCase();
        if (repoInfo?.visibility && !payload.visibility)
          payload.visibility = repoInfo.visibility;
        // Infer template ONLY if not provided by UI or user
        if (!payload.template) {
          if (
            repoInfo?.language?.toLowerCase().includes('javascript') ||
            repoInfo?.language?.toLowerCase().includes('typescript') ||
            /js|ts|node|javascript/i.test(repo)
          ) {
            payload.template = 'node_app';
          } else if (
            repoInfo?.language?.toLowerCase().includes('python') ||
            /py|flask|django/i.test(repo)
          ) {
            payload.template = 'python_app';
          } else {
            payload.template = 'container_service';
          }
          console.log(`🪄 Inferred template: ${payload.template}`);
        }
        // --- Auto-correct short template names ---
        if (payload.template === 'node') payload.template = 'node_app';
        if (payload.template === 'python') payload.template = 'python_app';
        if (payload.template === 'container')
          payload.template = 'container_service';
        // --- Validate template against allowed values ---
        const allowedTemplates = [
          'node_app',
          'python_app',
          'container_service',
        ];
        if (!allowedTemplates.includes(payload.template)) {
          console.warn(
            '⚠ Invalid template inferred:',
            payload.template,
            '— auto-correcting to node_app.'
          );
          payload.template = 'node_app';
        }
        // --- Add options and stages from pipelineSnapshot only ---
        if (pipelineSnapshot?.options) {
          payload.options = pipelineSnapshot.options;
        }
        // 🔐 Authoritative enforcement: AI may suggest, UI decides
        if (pipelineSnapshot?.stages) {
          payload.stages = pipelineSnapshot.stages;
        }
        // Defensive: ensure AI cannot override stages, only UI/UX
        // (already enforced above)
        console.log('🧩 Final payload to pipeline_generator:', payload);
        agentMeta.tool_called = 'pipeline_generator';
        const output = await callMCPTool('pipeline_generator', payload, cookie);
        // Extract YAML for confirmation step (NO AI YAML merging, only backend-generated)
        const generatedYaml =
          output?.data?.data?.generated_yaml ||
          output?.data?.generated_yaml ||
          null;

        // Surface pipeline_name if the tool provided one so the UI and
        // the user see the exact file that will be committed.
        const pipelineNameFromTool =
          output?.data?.data?.pipeline_name ||
          output?.data?.pipeline_name ||
          pipelineSnapshot?.pipeline_name ||
          '.github/workflows/ci.yml';

        // Return confirmation-required structure
        return {
          success: true,
          requires_confirmation: true,
          reply:
            `I generated a CI/CD workflow YAML for this repo based on your current settings. It will live at ${pipelineNameFromTool}. Review it in the UI and decide whether to commit it.`,
          message:
            `A pipeline has been generated at ${pipelineNameFromTool}. Would you like me to commit this workflow file to your repository?`,
          suggestions: [
            {
              id: 'review-yaml',
              title: 'Review the generated workflow YAML',
              description:
                'Look over the proposed GitHub Actions workflow to make sure it matches your build, test, and deploy expectations before committing.',
            },
            {
              id: 'test-branch',
              title: 'Test the workflow on a staging or feature branch',
              description:
                'Commit this workflow to a non-main branch first to validate that builds, tests, and deployments behave as expected.',
            },
          ],
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          generated_yaml: generatedYaml,
          pipeline_metadata: {
            ...output,
            pipeline_name: pipelineNameFromTool,
          },
        };
      }

      if (toolName === 'pipeline_commit') {
        console.log('📝 Commit intent detected.');

        // Guard: copilot path is read-only and must not commit directly
        if (!allowPipelineCommit) {
          return {
            success: false,
            agent_decision: agentMeta.agent_decision,
            tool_called: null,
            message:
              'I can help you design and refine the workflow YAML, but committing it to your repo is handled by the UI.',
          };
        }

        // ❗ Guard: Prevent confusing "repo commit history" with "pipeline commit"
        if (
          /recent commits|commit history|see commits|show commits|view commits/i.test(
            decision + ' ' + userPromptText
          )
        ) {
          console.log(
            '⚠ Not pipeline commit. Detected intention to view repo commit history.'
          );
          agentMeta.tool_called = 'github_adapter';

          const repoForCommits = repo || pipelineSnapshot?.repo || null;
          if (!repoForCommits) {
            return {
              success: false,
              error:
                "Please specify a repository, e.g. 'show commits for user/repo'.",
            };
          }

          const output = await callMCPTool(
            'github_adapter',
            { action: 'commits', repo: repoForCommits },
            cookie
          );

          return {
            success: true,
            agent_decision: agentMeta.agent_decision,
            tool_called: agentMeta.tool_called,
            tool_output: output,
          };
        }

        // Ensure we have a repo
        const commitRepo = repo || pipelineSnapshot?.repo || null;
        if (!commitRepo) {
          return {
            success: false,
            error:
              "I don’t know which repository to commit to. Please specify the repo (e.g., 'commit to user/repo').",
          };
        }

        // Extract YAML from userPrompt or fallback to last generated YAML
        const yamlMatch = userPromptText.match(/```yaml([\s\S]*?)```/i);
        const yamlFromPrompt = yamlMatch ? yamlMatch[1].trim() : null;

        const yaml =
          yamlFromPrompt ||
          pipelineSnapshot?.generated_yaml ||
          pipelineSnapshot?.yaml ||
          null;

        if (!yaml) {
          return {
            success: false,
            error:
              'I don’t have a pipeline YAML to commit. Please generate one first.',
          };
        }

        const commitPayload = {
          repoFullName: commitRepo,
          yaml,
          branch: 'main',
          path: '.github/workflows/ci.yml',
        };

        agentMeta.tool_called = 'pipeline_commit';
        const output = await callMCPTool(
          'pipeline_commit',
          commitPayload,
          cookie
        );

        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          committed_repo: commitRepo,
          committed_path: '.github/workflows/ci.yml',
          tool_output: output,
        };
      }

      if (toolName === 'oidc_adapter') {
        const payload = provider ? { provider } : {};
        agentMeta.tool_called = 'oidc_adapter';
        const output = await callMCPTool('oidc_adapter', payload, cookie);
        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          tool_output: output,
        };
      }

      if (toolName === "github_adapter") {
        agentMeta.tool_called = "github_adapter";

        // --- Structured intent extraction ---
        const intentData = await extractGitHubIntent(client, userPromptText);
        const { intent, repo: intentRepo, path: intentPath } = intentData;

        const resolvedRepo = repo || intentRepo;

        // 🔒 Path always implies filesystem, never GitHub Actions metadata
        let normalizedIntent = intent;
        if (intentPath && intent === "list_workflows") {
          normalizedIntent = "list_path";
        }

        // Map intent → github_adapter action
        let action;
        let path;

        switch (normalizedIntent) {
          case "list_repos":
            action = "repos";
            break;

          case "list_root":
            action = "contents";
            break;

          case "list_path":
            action = "contents";
            path = intentPath;
            break;

          case "check_dir":
            action = "contents";
            path = intentPath;
            break;

          case "check_file":
            action = "file";
            path = intentPath;
            break;

          case "read_file":
            action = "file";
            path = intentPath;
            break;

          case "list_workflows":
            action = "workflows";
            break;

          case "list_branches":
            action = "branches";
            break;

          case "list_commits":
            action = "commits";
            break;

          case "repo_info":
          default:
            action = "info";
            break;
        }

        // Repos listing does not require repo
        if (action === "repos") {
          const output = await callMCPTool("github_adapter", { action }, cookie);
          return {
            success: true,
            agent_decision: agentMeta.agent_decision,
            tool_called: agentMeta.tool_called,
            tool_output: output,
          };
        }

        // All other actions require a repo
        if (!resolvedRepo) {
          return {
            success: false,
            error: "Please specify a repository (e.g. 'user/repo')."
          };
        }

        const payload = { action, repo: resolvedRepo };
        if (path) payload.path = path;

        const output = await callMCPTool("github_adapter", payload, cookie);

        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          tool_output: output
        };
      }
    }
  }

  // If no MCP tool matched, but the LLM decision looks like a
  // direct natural-language answer (not a tool-routing plan),
  // surface it as the reply instead of a generic error.
  const natural = (agentMeta.agent_decision || '').trim();

  // Special-case: user asking to remove deploy after a pipeline
  // was generated. The frontend already toggles stages + regenerates
  // YAML; here we just confirm what happened.
  if (/remove (the )?deploy(ment)?|no deploy|without deploy|i don['’]t want the deploy/i.test(userPromptText)) {
    const reply =
      'I turned off the deploy stage for this pipeline. The YAML below has been regenerated without the deploy job; review it before committing.';
    return {
      success: true,
      agent_decision: agentMeta.agent_decision,
      tool_called: null,
      reply,
      message: reply,
    };
  }
  const looksLikeToolPlan = /\b(repo_reader|pipeline_generator|pipeline_commit|github_adapter|oidc_adapter)\b/i.test(
    natural
  );

  if (natural && !looksLikeToolPlan) {
    return {
      success: true,
      agent_decision: agentMeta.agent_decision,
      tool_called: null,
      reply: natural,
      message: natural,
    };
  }

  return {
    success: false,
    agent_decision: agentMeta.agent_decision,
    tool_called: null,
    message:
      'No matching tool found. Try asking about a repo, pipeline, or AWS role.',
  };
}

// Example local test (can comment out for production)
if (process.argv[2]) {
  const input = process.argv.slice(2).join(' ');
  runWizardAgent(input)
    .then((res) => {
      console.log('\n📦 Tool Output:\n', JSON.stringify(res, null, 2));
    })
    .catch(console.error);
}
