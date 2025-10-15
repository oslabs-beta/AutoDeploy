import dotenv from "dotenv";
dotenv.config();

console.log("🧾 MCP_API_KEY from .env:", process.env.MCP_API_KEY);

export const config = {
  mcpUrl: (process.env.MCP_URL || "http://localhost:7000").trim(),
  mcpApiKey: (process.env.MCP_API_KEY || "").trim(),
  nodeEnv: (process.env.NODE_ENV || "development").trim()
};
