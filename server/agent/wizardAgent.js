import OpenAI from "openai";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: call MCP routes dynamically
async function callMCPTool(tool, input) {
  const response = await fetch(`http://localhost:3000/mcp/v1/${tool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return await response.json();
}

// Wizard Agent Core
export async function runWizardAgent(userPrompt) {
  const systemPrompt = `
  You are the MCP Wizard Agent.
  You have full access to the following connected tools and APIs:
  - repo_reader: reads local and remote repositories
  - pipeline_generator: generates CI/CD YAMLs
  - oidc_adapter: lists AWS roles or Jenkins jobs
  - github_adapter: fetches real-time GitHub repository data through an authenticated API connection
  Do not say that you lack access to GitHub or external data — you can retrieve this information directly through the available tools.
  Always respond with factual data from the tool response only.
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

  // Basic keyword trigger (mock reasoning)
  if (decision.toLowerCase().includes("repo")) return await callMCPTool("repo_reader", {});
  if (decision.toLowerCase().includes("pipeline"))
    return await callMCPTool("pipeline_generator", {
      repo: "askmyrepo",
      provider: "aws",
      template: "node_app",
    });
  if (decision.toLowerCase().includes("role") || decision.toLowerCase().includes("jenkins"))
    return await callMCPTool("oidc_adapter", { provider: "aws" });
  if (decision.toLowerCase().includes("github") || decision.toLowerCase().includes("repo info"))
    return await callMCPTool("github_adapter", { repo: "paythonveazie/sample-node-app" });

  return { message: "No matching tool found." };
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