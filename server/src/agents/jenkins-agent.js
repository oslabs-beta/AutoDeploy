import path from "node:path";
import { Agent, run, MCPServerStreamableHttp } from "@openai/agents";


export async function askJenkins(question) {
  // construct Basic Auth
  const authToken = Buffer.from(
    `${process.env.JENKINS_USER}:${process.env.JENKINS_TOKEN}`
  ).toString("base64");


  // 1. URL change /mcp-server/mcp
  // 2. use requestInit.headers pass Authorization
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
    const agent = new Agent({
      name: "Jenkins Assistant",
      instructions: `
        You are an intelligent Jenkins assistant that can manage and query Jenkins jobs through the Model Context Protocol (MCP).
        You have access to MCP tools provided by a Jenkins MCP server.  
        Use these tools whenever the user asks about:
        - Job status, build history, build results
        - Triggering builds
        - Getting logs or console output
        - Listing jobs or checking recent failures
        Always use the appropriate MCP tool instead of making up an answer.  
        If the MCP response includes structured data (like JSON or status codes), summarize it clearly and naturally in plain English.
        When the user asks something unrelated to Jenkins, politely clarify that you specialize in Jenkins automation and can help with jobs, builds, or logs.
        If a tool call fails (for example, connection timeout or authentication error), provide a short diagnostic message like:
        > “I wasn’t able to reach the Jenkins MCP server. Please verify your Jenkins URL or token.”
        Keep answers short, factual, and professional. Use bullet points for lists or multiple jobs.
      `,
      mcpServers: [jenkinsMcp],
    });

    const result = await run(agent, question);
    return result.finalOutput;
  } finally {
    await jenkinsMcp.close();
  }
}