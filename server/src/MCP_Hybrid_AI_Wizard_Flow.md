# 🧭 MCP Hybrid AI Wizard – Flow & Module Architecture

This document shows how user-driven input and AI-driven automation combine within the MCP system.  
The goal: users still interact with forms, while the AI Wizard orchestrates MCP tools to build pipelines and deploy them automatically.

---

## 🧩 High-Level Flow

```mermaid
flowchart TD

A[User UI / Wizard Form] -->|Form Data| B[AI Wizard Agent]
B -->|Decides Which Tool(s) to Use| C[MCP API Layer]
C -->|REST Call| D[Tool Endpoint]
D -->|Calls Integration Stub| E[Integration Layer]
E -->|Returns Mock/Real Data| C
C -->|Response| B
B -->|Summarized Result / Next Step| A
```

---

## ⚙️ Module Breakdown

### 1️⃣ Frontend (Wizard UI)
- Presents form fields (repo, branch, provider, template).
- Sends collected inputs to the **AI Wizard Agent**.
- Renders conversation steps or results returned by the agent.

**Tech stack:** React + Zustand + shadcn/ui  
**Responsibility:** UX and data capture.

---

### 2️⃣ AI Wizard Agent
- Acts as the **intelligent middle layer** between the user and the MCP tools.
- Determines which tool(s) to invoke based on the user’s form data and conversation context.
- Parses MCP responses, summarizes, and sends human-readable updates back to UI.

**Example logic:**
```js
if (user.provider === "aws") useTool("oidc_adapter");
useTool("pipeline_generator", user);
```

**Responsibility:** Reasoning, orchestration, and dynamic flow.

---

### 3️⃣ MCP API Layer
- Express server exposing endpoints under `/mcp/v1`.
- Validates input with Zod.
- Routes requests to internal tool modules (repo_reader, pipeline_generator, oidc_adapter).

**Responsibility:** Standardize all backend access through predictable JSON schemas.

---

### 4️⃣ MCP Tools (under `/server/tools/`)
Each tool = single responsibility function with metadata and schema.

Example structure:
```js
export const pipeline_generator = {
  name: "pipeline_generator",
  description: "Generate CI/CD YAML for a given repo and provider",
  input_schema: z.object({
    repo: z.string(),
    provider: z.enum(["aws", "jenkins"]),
    template: z.string()
  }),
  handler: async (params) => { ... }
}
```

**Responsibility:** Encapsulate logic for each automation unit.

---

### 5️⃣ Integrations Layer
- Mock or real API wrappers for external systems.
- Organized by provider type.

Structure:
```
server/integrations/
├── github/
│   └── index.js
├── aws/
│   └── index.js
└── jenkins/
    └── index.js
```

**Responsibility:** Handle API auth, SDK calls, and return normalized data.

---

### 6️⃣ Database (Supabase / Postgres)
- Stores users, connections, and tokens (encrypted).
- Provides audit logs of which tools ran under which user.

**Responsibility:** Persistence and security layer.

---

## ✅ Summary

| Layer | Role | Example Interaction |
|-------|------|----------------------|
| Frontend | Collects user input | Form submits data |
| AI Wizard | Decides which MCP tool to use | “I’ll generate your AWS pipeline.” |
| MCP Server | Hosts tools and APIs | `/mcp/v1/pipeline_generator` |
| Tools | Do one job well | Return YAML or list of roles |
| Integrations | Communicate externally | AWS IAM, GitHub, Jenkins |
| Database | Persist context | Users, connections, logs |

---

## 🧠 Next Steps for Implementation
1. Create `/server/routes/mcp.js` to modularize endpoints.  
2. Move endpoint logic into `/server/tools/`.  
3. Register each tool in an MCP registry.  
4. Integrate the AI Wizard (OpenAI, LangChain, or custom agent).  
5. Have the agent call MCP tools dynamically based on user input.
