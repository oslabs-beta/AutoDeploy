import OpenAI from 'openai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

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
    const response = await fetch(`http://localhost:3000/mcp/v1/${tool}`, {
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
    return { error: 'MCP server unreachable' };
  }
}

// Wizard Agent Core
export async function runWizardAgent(userPrompt) {
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
    github_adapter: /\b(github|repo info|repository|[\w-]+\/[\w-]+)\b/i,
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
      const repo =
        labeledRepo?.[1] ||
        genericRepo?.[1] ||
        pipelineSnapshot?.repo ||
        globalThis.LAST_REPO_USED ||
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
        // --- Preserve repo context globally ---
        if (!payload.repo && globalThis.LAST_REPO_USED) {
          payload.repo = globalThis.LAST_REPO_USED;
        } else if (payload.repo) {
          globalThis.LAST_REPO_USED = payload.repo;
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
          null;
        // Store YAML globally for future commit step
        globalThis.LAST_GENERATED_YAML = generatedYaml;
        // Return confirmation-required structure
        return {
          success: true,
          requires_confirmation: true,
          message:
            'A pipeline has been generated. Would you like me to commit this workflow file to your repository?',
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          generated_yaml: generatedYaml,
          pipeline_metadata: output,
        };
      }

      if (toolName === 'pipeline_commit') {
        console.log('📝 Commit intent detected.');

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

          const repoForCommits = repo || globalThis.LAST_REPO_USED;
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
        const commitRepo = repo || globalThis.LAST_REPO_USED;
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

        const yaml = yamlFromPrompt || globalThis.LAST_GENERATED_YAML || null;

        if (!yaml) {
          return {
            success: false,
            error:
              'I don’t have a pipeline YAML to commit. Please generate one first.',
          };
        }

        // Save YAML globally for future edits
        globalThis.LAST_GENERATED_YAML = yaml;

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
