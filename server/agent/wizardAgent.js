import OpenAI from "openai";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** --------------------------------------------------
 * Helper: Call MCP tool
 * -------------------------------------------------- */
async function callMCPTool(tool, input, cookie) {
  const response = await fetch(`http://localhost:3000/mcp/v1/${tool}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie":
        cookie ||
        (process.env.MCP_SESSION_TOKEN
          ? `mcp_session=${process.env.MCP_SESSION_TOKEN}`
          : ""),
    },
    body: JSON.stringify(input),
  });

  return await response.json();
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