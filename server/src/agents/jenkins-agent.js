import { Agent, run, MCPServerStreamableHttp } from "@openai/agents";

const DEFAULT_JENKINS_MCP_URL = "http://192.168.1.35:8090/mcp-server/mcp";

export async function askJenkins(question, options = {}) {
  const user = process.env.JENKINS_USER;
  const token = options.token || process.env.JENKINS_TOKEN;
  const mcpUrl = options.mcpUrl || process.env.JENKINS_MCP_URL || DEFAULT_JENKINS_MCP_URL;

  if (!user) {
    throw new Error("JENKINS_USER is not set in the environment");
  }

  if (!token) {
    throw new Error("JENKINS_TOKEN is required. Provide it in the request body or environment");
  }

  const authToken = Buffer.from(`${user}:${token}`).toString("base64");

  const jenkinsMcp = new MCPServerStreamableHttp({
    name: "jenkins-mcp",
    url: mcpUrl,
    requestInit: {
      headers: {
        Authorization: `Basic ${authToken}`,
      },
    },
  });

  try {
    console.log(`[askJenkins] connecting to Jenkins MCP at ${mcpUrl}…`);
    await jenkinsMcp.connect();
    console.log("[askJenkins] connected. Listing tools…");

    const tools = await jenkinsMcp.listTools();
    console.log("[askJenkins] Jenkins MCP tools:", JSON.stringify(tools, null, 2));

    const agent = new Agent({
      name: "Jenkins Assistant",
      instructions: `
        You are an intelligent Jenkins assistant that can manage and query Jenkins jobs through the Model Context Protocol (MCP).
        You have access to MCP tools provided by a Jenkins MCP server.

        When asked things like "what jobs exist" or "list jobs", you MUST call the getJobs tool.
        Do not guess job names or statuses — always call a tool.

        If a tool call returns an error object like {"status":"FAILED","message":"..."},
        briefly summarize that message to the user instead of hiding it.
      `,
      mcpServers: [jenkinsMcp],
    });

    console.log("[askJenkins] running agent with question:", question);
    const result = await run(agent, question);

    // Inspect the full result for debugging:
    console.dir(result, { depth: 5 });

    return result.finalOutput;
  } catch (err) {
    console.error("[askJenkins] ERROR:", err);
    throw err;
  } finally {
    await jenkinsMcp.close();
    console.log("[askJenkins] MCP connection closed.");
  }
}
