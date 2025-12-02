import OpenAI from 'openai';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();
//const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Construct the OpenAI client lazily so that the server does not shut down completely when we build the container
let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY - cannot run Wizard Agent');
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

/** --------------------------------------------------
 * Helper: Call MCP tool
 * -------------------------------------------------- */
async function callMCPTool(tool, input, cookie) {
  try {
    const response = await fetch(`http://localhost:3000/mcp/v1/${tool}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie || (process.env.MCP_SESSION_TOKEN ? `mcp_session=${process.env.MCP_SESSION_TOKEN}` : ""),
      },
      body: JSON.stringify(input),
    });

    return await response.json();
  } catch (err) {
    console.warn("⚠️ MCP call failed:", err.message || err);
    return { success: false, error: "MCP server unreachable" };
  }
}

// Wizard Agent Core
export async function runWizardAgent(userPrompt) {
  // Normalize userPrompt into a consistent text form + extract cookie
  const userPromptText =
    typeof userPrompt === "string"
      ? userPrompt
      : userPrompt?.prompt || "";

  const cookie = userPrompt?.cookie || "";
  const systemPrompt = `
  You are the MCP Wizard Agent.
  You have full access to the following connected tools and APIs:
  - repo_reader: reads local and remote repositories, useful for listing or describing repositories
  - pipeline_generator: generates CI/CD YAMLs
  - oidc_adapter: lists AWS roles or Jenkins jobs
  - github_adapter: fetches real-time GitHub repository data through an authenticated API connection
  Do not say that you lack access to GitHub or external data — you can retrieve this information directly through the available tools.
  Always respond with factual data from the tool response only.

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

  const client = getClient();

  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: typeof userPrompt === "string" ? userPrompt : userPrompt.prompt },
    ],
  });

  const decision = completion.choices[0].message.content;
  console.log("\n🤖 Agent decided:", decision);

  let agentMeta = {
    agent_decision: decision,
    tool_called: null,
  };

  // Tool mapping using regex patterns
  const toolMap = {
    repo_reader: /\b(list repos|list repositories|repositories|repo_reader)\b/i,
    pipeline_generator: /\bpipeline\b/i,
    pipeline_commit: /\b(yes commit|commit (the )?(pipeline|workflow|file)|apply (the )?(pipeline|workflow)|save (the )?(pipeline|workflow)|push (the )?(pipeline|workflow))\b/i,
    oidc_adapter: /\b(role|jenkins)\b/i,
    github_adapter: /\b(github|repo info|repository|[\w-]+\/[\w-]+)\b/i,
  };

  for (const [toolName, pattern] of Object.entries(toolMap)) {
    if (pattern.test(decision) || pattern.test(userPromptText)) {
      console.log('🔧 Triggering MCP tool:', toolName);

      // --- Extract context dynamically from userPrompt or decision ---
      // Prefer explicit labels like: "repo owner/name", "template node_app", "provider aws"
      const labeledRepo = userPromptText.match(/\brepo\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i) 
                       || decision.match(/\brepo\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i);
      const genericRepo = (userPromptText + " " + decision).match(/\b(?!ci\/cd\b)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);
      const repo = (labeledRepo?.[1] || genericRepo?.[1] || null);

      const labeledProvider = userPromptText.match(/\bprovider\s+(aws|jenkins|gcp|azure)\b/i) 
                           || decision.match(/\bprovider\s+(aws|jenkins|gcp|azure)\b/i);
      const genericProvider = userPromptText.match(/\b(aws|jenkins|github actions|gcp|azure)\b/i) 
                           || decision.match(/\b(aws|jenkins|github actions|gcp|azure)\b/i);
      const provider = (labeledProvider?.[1] || genericProvider?.[1] || null)?.toLowerCase().replace(/\s+/g, ' ');

      const labeledTemplate = userPromptText.match(/\btemplate\s+([a-z_][a-z0-9_]+)\b/i) 
                           || decision.match(/\btemplate\s+([a-z_][a-z0-9_]+)\b/i);
      const genericTemplate = userPromptText.match(/\b(node_app|python_app|container_service|node|python|react|express|django|flask|java|go)\b/i) 
                           || decision.match(/\b(node_app|python_app|container_service|node|python|react|express|django|flask|java|go)\b/i);
      const template = (labeledTemplate?.[1] || genericTemplate?.[1] || null)?.toLowerCase();

      if (toolName === "repo_reader") {
        // Extract optional username, user_id, and repo info
        const usernameMatch = userPromptText.match(/\busername[:=]?\s*([\w-]+)\b/i);
        const userIdMatch = userPromptText.match(/\buser[_ ]?id[:=]?\s*([\w-]+)\b/i);
        const repoMatch = userPromptText.match(/\b([\w-]+\/[\w-]+)\b/);

        const payload = {};
        if (usernameMatch) payload.username = usernameMatch[1];
        if (userIdMatch) payload.user_id = userIdMatch[1];
        if (repoMatch) {
          const [username, repo] = repoMatch[1].split('/');
          payload.username = username;
          payload.repo = `${username}/${repo}`;
        }

        agentMeta.tool_called = "repo_reader";
        const output = await callMCPTool("repo_reader", payload, cookie);
        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          tool_output: output
        };
      }

      if (toolName === 'pipeline_generator') {
        if (!repo) {
          console.warn('⚠️ Missing repo context for pipeline generation.');
          return {
            success: false,
            error:
              "I couldn’t determine which repository you meant. Please specify it, e.g., 'generate pipeline for user/repo'.",
          };
        }

        const payload = { repo };
        if (provider) payload.provider = provider;
        if (template) payload.template = template;

        // Fetch GitHub repo details before pipeline generation
        let repoInfo = null;
        try {
          const info = await callMCPTool("github_adapter", { action: "info", repo }, cookie);
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

        // Infer template if still missing
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
        const allowedTemplates = ["node_app", "python_app", "container_service"];
        if (!allowedTemplates.includes(payload.template)) {
          console.warn("⚠ Invalid template inferred:", payload.template, "— auto-correcting to node_app.");
          payload.template = "node_app";
        }

        // --- Preserve repo context globally ---
        if (!payload.repo && globalThis.LAST_REPO_USED) {
          payload.repo = globalThis.LAST_REPO_USED;
        } else if (payload.repo) {
          globalThis.LAST_REPO_USED = payload.repo;
        }

        // ✅ Ensure provider is valid before sending payload
        if (
          !payload.provider ||
          !['aws', 'jenkins'].includes(payload.provider)
        ) {
          // Infer from repo visibility or fallback to AWS
          payload.provider =
            repoInfo?.visibility === 'private' ? 'jenkins' : 'aws';
          console.log(`🧭 Inferred provider: ${payload.provider}`);
        }

        console.log("🧩 Final payload to pipeline_generator:", payload);
        agentMeta.tool_called = "pipeline_generator";
        const output = await callMCPTool("pipeline_generator", payload, cookie);

        // Extract YAML for confirmation step
        const generatedYaml =
          output?.data?.data?.generated_yaml ||
          output?.tool_output?.data?.generated_yaml ||
          null;

        // Store YAML globally for future commit step
        globalThis.LAST_GENERATED_YAML = generatedYaml;

        // Return confirmation-required structure
        return {
          success: true,
          requires_confirmation: true,
          message: "A pipeline has been generated. Would you like me to commit this workflow file to your repository?",
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          generated_yaml: generatedYaml,
          pipeline_metadata: output
        };
      }

      if (toolName === "pipeline_commit") {
        console.log("📝 Commit intent detected.");

        // ❗ Guard: Prevent confusing "repo commit history" with "pipeline commit"
        if (/recent commits|commit history|see commits|show commits|view commits/i.test(decision + " " + userPromptText)) {
          console.log("⚠ Not pipeline commit. Detected intention to view repo commit history.");
          agentMeta.tool_called = "github_adapter";

          const repoForCommits = repo || globalThis.LAST_REPO_USED;
          if (!repoForCommits) {
            return {
              success: false,
              error: "Please specify a repository, e.g. 'show commits for user/repo'."
            };
          }

          const output = await callMCPTool("github_adapter", { action: "commits", repo: repoForCommits }, cookie);

          return {
            success: true,
            agent_decision: agentMeta.agent_decision,
            tool_called: agentMeta.tool_called,
            tool_output: output
          };
        }

        // Ensure we have a repo
        const commitRepo = repo || globalThis.LAST_REPO_USED;
        if (!commitRepo) {
          return {
            success: false,
            error: "I don’t know which repository to commit to. Please specify the repo (e.g., 'commit to user/repo')."
          };
        }

        // Extract YAML from userPrompt or fallback to last generated YAML
        const yamlMatch = userPromptText.match(/```yaml([\s\S]*?)```/i);
        const yamlFromPrompt = yamlMatch ? yamlMatch[1].trim() : null;

        const yaml =
          yamlFromPrompt ||
          globalThis.LAST_GENERATED_YAML ||
          null;

        if (!yaml) {
          return {
            success: false,
            error: "I don’t have a pipeline YAML to commit. Please generate one first."
          };
        }

        // Save YAML globally for future edits
        globalThis.LAST_GENERATED_YAML = yaml;

        const commitPayload = {
          repoFullName: commitRepo,
          yaml,
          branch: "main",
          path: ".github/workflows/ci.yml"
        };

        agentMeta.tool_called = "pipeline_commit";
        const output = await callMCPTool("pipeline_commit", commitPayload, cookie);

        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          committed_repo: commitRepo,
          committed_path: ".github/workflows/ci.yml",
          tool_output: output
        };
      }

      if (toolName === 'oidc_adapter') {
        const payload = provider ? { provider } : {};
        agentMeta.tool_called = "oidc_adapter";
        const output = await callMCPTool("oidc_adapter", payload, cookie);
        return {
          success: true,
          agent_decision: agentMeta.agent_decision,
          tool_called: agentMeta.tool_called,
          tool_output: output
        };
      }

      if (toolName === 'github_adapter') {
        if (repo) {
          agentMeta.tool_called = "github_adapter";
          const output = await callMCPTool("github/info", { repo }, cookie);
          return {
            success: true,
            agent_decision: agentMeta.agent_decision,
            tool_called: agentMeta.tool_called,
            tool_output: output
          };
        } else {
          console.warn('⚠️ Missing repo for GitHub info retrieval.');
          return {
            success: false,
            error:
              "Couldn’t determine which repository to fetch. Please include it in your request (e.g., 'tell me about user/repo').",
          };
        }
      }
    }
  }

  return {
    success: false,
    agent_decision: agentMeta.agent_decision,
    tool_called: null,
    message: "No matching tool found. Try asking about a repo, pipeline, or AWS role."
  };
}

/** --------------------------------------------------
 * 1. Generate YAML (NO inference, NO guessing)
 * -------------------------------------------------- */
export async function generateYAML({
  repo_full_name,
  template,
  provider,
  language,
  default_branch,
  workflow_path,
  cookie,
}) {
  try {
    const payload = {
      repo: repo_full_name,
      template,
      provider,
      language,
      default_branch,
      workflow_path,
    };

    const result = await callMCPTool("pipeline_generator", payload, cookie);

    // Extract YAML from multiple possible MCP structures
    const yaml =
      result?.data?.generated_yaml ||
      result?.tool_output?.data?.generated_yaml ||
      result?.data?.data?.generated_yaml ||
      result?.data?.data?.yaml ||
      result?.generated_yaml ||
      null;

    if (!yaml) {
      return {
        success: false,
        error: "pipeline_generator returned no YAML",
        raw: result,
      };
    }

    return {
      success: true,
      yaml,
      metadata: result,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

/** --------------------------------------------------
 * 2. Edit YAML (LLM-assisted, but deterministic)
 * -------------------------------------------------- */
export async function editYAML({ current_yaml, user_request, cookie }) {
  try {
    const prompt = `
You are a YAML editing assistant. 
You ONLY modify YAML that is explicitly provided to you.

Rules:
- Never guess repo details.
- Never infer provider, template, or metadata.
- Only modify the YAML according to the user request.
- Output ONLY the final YAML. No commentary.

User request:
"${user_request}"

Current YAML:
\`\`\`yaml
${current_yaml}
\`\`\`
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You edit YAML only. Output YAML only." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
    });

    const edited = completion.choices[0].message.content;

    return {
      success: true,
      yaml: edited,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
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
