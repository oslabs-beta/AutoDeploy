

import OpenAI from "openai";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: call MCP routes dynamically
async function callMCPTool(tool, input) {
  const response = await fetch(`http://localhost:4000/mcp/v1/${tool}`, {
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
  You have access to these tools:
  - repo_reader: lists repos and branches
  - pipeline_generator: builds a CI/CD pipeline YAML
  - oidc_adapter: lists AWS roles or Jenkins jobs
  Decide which tool to call based on user intent and return results in plain text.
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

  return { message: "No matching tool found." };
}

// Example local test (can comment out for production)
if (process.argv[2]) {
  const input = process.argv.slice(2).join(" ");
  runWizardAgent(input)
    .then((res) => {
      console.log("\n📦 Tool Output:\n", res);
    })
    .catch(console.error);
}