import axios from "axios";
import { config } from "../config/env.js";
import { mcpHeaders } from "./utils/authHelper.js";

/**
 * Call MCP “create pipeline” (or whatever route we standardize).
 * Keep signature stable so the Express layer can call this later.
 */
export async function callMcpPipeline(payload) {
  const url = `${config.mcpUrl}/api/pipeline`;
  const headers = mcpHeaders(config.mcpApiKey);

  try {
    console.log("Sending MCP request to:", url);
    console.log("Headers:", headers);
    console.log("payload:", payload);
    const { data } = await axios.post(url, payload, { headers, timeout: 15000 });
    return data;
  } catch (err) {
    // Normalize error shape for the API layer to consume later
    const status = err.response?.status || 500;
    const message = err.response?.data?.error || err.message;
    throw new Error(`MCP call failed (${status}): ${message}`);
  }
}

/**
 * Allow running directly: `npm run agent:test`
 * This lets you develop the agent *before* the Express layer exists.
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      const result = await callMcpPipeline({
        repo: "https://github.com/example/project",
        branch: "main",
        service: "ci-cd-generator"
      });
      console.log("✅ MCP response:", result);
    } catch (e) {
      console.error("❌", e.message);
      process.exit(1);
    }
  })();
}
