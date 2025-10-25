import OpenAI from "openai";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: call MCP routes dynamically, with error handling
async function callMCPTool(tool, input) {
  try {
    const response = await fetch(`http://localhost:3000/mcp/v1/${tool}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.MCP_SESSION_TOKEN}`,
      },
      body: JSON.stringify(input),
    });
    return await response.json();
  } catch (err) {
    console.warn("⚠️ MCP call failed:", err.message || err);
    return { error: "MCP server unreachable" };
  }
}

// Wizard Agent Core
export async function runWizardAgent(userPrompt) {
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
  `;

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const decision = completion.choices[0].message.content;
  console.log("\n🤖 Agent decided:", decision);

  // Tool mapping using regex patterns
  const toolMap = {
    repo_reader: /\b(list repos|list repositories|repositories|repo_reader)\b/i,
    pipeline_generator: /\bpipeline\b/i,
    oidc_adapter: /\b(role|jenkins)\b/i,
    github_adapter: /\b(github|repo info|repository|[\w-]+\/[\w-]+)\b/i,
  };

  for (const [toolName, pattern] of Object.entries(toolMap)) {
    if (pattern.test(decision)) {
      console.log('🔧 Triggering MCP tool:', toolName);

      // --- Extract context dynamically from userPrompt or decision ---
      const repoMatch = userPrompt.match(/\b([\w-]+\/[\w-]+)\b/) || decision.match(/\b([\w-]+\/[\w-]+)\b/);
      const providerMatch = userPrompt.match(/\b(aws|jenkins|github actions|gcp|azure)\b/i) || decision.match(/\b(aws|jenkins|github actions|gcp|azure)\b/i);
      const templateMatch = userPrompt.match(/\b(node|python|react|express|django|flask|java|go)\b/i) || decision.match(/\b(node|python|react|express|django|flask|java|go)\b/i);

      const repo = repoMatch ? repoMatch[0] : null;
      const provider = providerMatch ? providerMatch[0].toLowerCase() : null;
      const template = templateMatch ? templateMatch[0].toLowerCase() : null;

      if (toolName === "repo_reader") {
        // Extract optional username, user_id, and repo info
        const usernameMatch = userPrompt.match(/\busername[:=]?\s*([\w-]+)\b/i);
        const userIdMatch = userPrompt.match(/\buser[_ ]?id[:=]?\s*([\w-]+)\b/i);
        const repoMatch = userPrompt.match(/\b([\w-]+\/[\w-]+)\b/);

        const payload = {};
        if (usernameMatch) payload.username = usernameMatch[1];
        if (userIdMatch) payload.user_id = userIdMatch[1];
        if (repoMatch) {
          const [username, repo] = repoMatch[1].split("/");
          payload.username = username;
          payload.repo = `${username}/${repo}`;
        }

        return await callMCPTool("repo_reader", payload);
      }

      if (toolName === "pipeline_generator") {
        if (!repo) {
          console.warn("⚠️ Missing repo context for pipeline generation.");
          return { 
            success: false, 
            error: "I couldn’t determine which repository you meant. Please specify it, e.g., 'generate pipeline for user/repo'." 
          };
        }

        const payload = { repo };
        if (provider) payload.provider = provider;
        if (template) payload.template = template;

        // Fetch GitHub repo details before pipeline generation
        let repoInfo = null;
        try {
          const info = await callMCPTool("github_adapter", { action: "info", repo });
          if (info?.data?.success) {
            repoInfo = info.data;
            console.log(`📦 Retrieved repo info from GitHub:`, repoInfo);
          }
        } catch (err) {
          console.warn("⚠️ Failed to fetch GitHub info before pipeline generation:", err.message);
        }

        // Merge language or visibility into payload if available
        if (repoInfo?.language && !payload.language) payload.language = repoInfo.language.toLowerCase();
        if (repoInfo?.visibility && !payload.visibility) payload.visibility = repoInfo.visibility;

        // Infer template if still missing
        if (!payload.template) {
          if (repoInfo?.language?.toLowerCase().includes("javascript") || repoInfo?.language?.toLowerCase().includes("typescript") || /js|ts|node|javascript/i.test(repo)) {
            payload.template = "node_app";
          } else if (repoInfo?.language?.toLowerCase().includes("python") || /py|flask|django/i.test(repo)) {
            payload.template = "python_app";
          } else {
            payload.template = "container_service";
          }
          console.log(`🪄 Inferred template: ${payload.template}`);
        }

        // --- Auto-correct short template names ---
        if (payload.template === "node") payload.template = "node_app";
        if (payload.template === "python") payload.template = "python_app";
        if (payload.template === "container") payload.template = "container_service";

        // --- Preserve repo context globally ---
        if (!payload.repo && globalThis.LAST_REPO_USED) {
          payload.repo = globalThis.LAST_REPO_USED;
        } else if (payload.repo) {
          globalThis.LAST_REPO_USED = payload.repo;
        }

        // ✅ Ensure provider is valid before sending payload
        if (!payload.provider || !["aws", "jenkins"].includes(payload.provider)) {
          // Infer from repo visibility or fallback to AWS
          payload.provider = repoInfo?.visibility === "private" ? "jenkins" : "aws";
          console.log(`🧭 Inferred provider: ${payload.provider}`);
        }

        console.log("🧩 Final payload to pipeline_generator:", payload);
        return await callMCPTool("pipeline_generator", payload);
      }

      if (toolName === "oidc_adapter") {
        const payload = provider ? { provider } : {};
        return await callMCPTool("oidc_adapter", payload);
      }

      if (toolName === "github_adapter") {
        if (repo) {
          return await callMCPTool("github/info", { repo });
        } else {
          console.warn("⚠️ Missing repo for GitHub info retrieval.");
          return { 
            success: false, 
            error: "Couldn’t determine which repository to fetch. Please include it in your request (e.g., 'tell me about user/repo')." 
          };
        }
      }
    }
  }

  return { message: "No matching tool found. Try asking about a repo, pipeline, or AWS role." };
}

// Example local test (can comment out for production)
if (process.argv[2]) {
  const input = process.argv.slice(2).join(" ");
  runWizardAgent(input)
    .then((res) => {
      console.log("\n📦 Tool Output:\n", JSON.stringify(res, null, 2));
    })
    .catch(console.error);
}