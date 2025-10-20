// Central registry for all MCP tools
import { repo_reader } from "./repo_reader.js";
import { pipeline_generator } from "./pipeline_generator.js";
import { oidc_adapter } from "./oidc_adapter.js";
import { github_adapter } from "./github_adapter.js";

export const MCP_TOOLS = {
  repo_reader,
  pipeline_generator,
  oidc_adapter,
  github_adapter,
};

// Optional helper for dynamic access
export const getTool = (name) => MCP_TOOLS[name];