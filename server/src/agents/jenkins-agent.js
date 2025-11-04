import path from "node:path";
import { Agent, run, MCPServerStreamableHttp } from "@openai/agents";


export async function askJenkins(question) {
  const user = process.env.JENKINS_USER;
  const token = process.env.JENKINS_TOKEN;
  // construct Basic Auth
  const authToken = Buffer.from(
    `${process.env.JENKINS_USER}:${process.env.JENKINS_TOKEN}`
  ).toString("base64");

  if (!user || !token) {
    throw new Error("JENKINS_USER or JENKINS_TOKEN is not set in the environment");
  }

  // 1. URL change /mcp-server/mcp
  // 2. use requestInit.headers pass Authorization
  console.log(authToken);
  const jenkinsMcp = new MCPServerStreamableHttp({
    name: "jenkins-mcp",
    url: "https://jenkins.ilessai.com/mcp-server/mcp",
    requestInit: {
      headers: {
        Authorization: `Basic ${authToken}`,
      },
    },
  });


  await jenkinsMcp.connect();


  try {
    console.log("[askJenkins] connecting to Jenkins MCP…");
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