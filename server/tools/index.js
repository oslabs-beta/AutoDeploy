// Central registry for all MCP tools
import { repo_reader } from './repo_reader.js';
import { pipeline_generator } from './pipeline_generator.js';
import { oidc_adapter } from './oidc_adapter.js';
import { github_adapter } from './github_adapter.js';

// Importing the new GCP tools
import { gcp_adapter } from './gcp_adapter.js';
import { scaffold_generator } from './scaffold_generator.js'; // Dockerfile generator

// AskMyRepo RAG v2 tools (Pinecone + Supabase via external service)
import {
  rag_ingest_zip,
  rag_ingest_github,
  rag_query_namespace,
  rag_get_logs,
} from './askmyrepo_rag.js';

export const MCP_TOOLS = {
  repo: repo_reader,
  repo_reader: repo_reader,
  pipeline_generator: pipeline_generator,
  oidc: oidc_adapter,
  oidc_adapter: oidc_adapter,
  github: github_adapter,
  github_adapter: github_adapter,
  // Adding the GCP adapter and Docker file generator to the MCP tools list to be able to call it
  gcp: gcp_adapter,
  gcp_adapter: gcp_adapter,
  scaffold: scaffold_generator,
  scaffold_generator: scaffold_generator,

  // AskMyRepo RAG tools
  rag_ingest_zip: rag_ingest_zip,
  rag_ingest_github: rag_ingest_github,
  rag_query_namespace: rag_query_namespace,
  rag_get_logs: rag_get_logs,
};

// Optional helper for dynamic access
export const getTool = (name) => MCP_TOOLS[name];
