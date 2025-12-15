// Central registry for all MCP tools
import { repo_reader } from './repo_reader.js';
import { pipeline_generator } from './pipeline_generator.js';
import { oidc_adapter } from './oidc_adapter.js';
import { github_adapter } from './github_adapter.js';

// Importing the new GCP tool
import { gcp_adapter } from './gcp_adapter.js';

export const MCP_TOOLS = {
  repo: repo_reader,
  repo_reader: repo_reader,
  pipeline_generator: pipeline_generator,
  oidc: oidc_adapter,
  oidc_adapter: oidc_adapter,
  github: github_adapter,
  github_adapter: github_adapter,
  // Adding the GCP adapter to the MCP tools to be able to call it
  gcp: gcp_adapter,
  gcp_adapter: gcp_adapter,
};

// Optional helper for dynamic access
export const getTool = (name) => MCP_TOOLS[name];
