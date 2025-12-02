# MCP CI/CD Builder – API Usage Guide

This short guide explains how to use the **Wizard Agent API** to generate pipelines, confirm workflows, and commit the final YAML to GitHub. It also highlights the new **confirmation flow** that ensures pipelines are only committed when the user explicitly approves.

---

## 🚀 Overview
The Wizard Agent provides a multi‑step workflow for generating and committing CI/CD pipelines via API calls:

1. **User requests a pipeline** → Agent generates YAML
2. **Agent asks for confirmation** → `requires_confirmation: true`
3. **User confirms** → Agent commits workflow to GitHub

The session must include a valid `mcp_session` cookie for authentication.

---

## 📌 Step 1 — Generate a Pipeline
Send a prompt describing the pipeline you want.

```bash
curl -X POST http://localhost:3000/agent/wizard/ai \
  -H "Content-Type: application/json" \
  -H "Cookie: mcp_session=YOUR_SESSION_TOKEN" \
  -d '{
    "prompt": "Generate pipeline for PVeazie951/google-extention-ai-summarizer"
  }'
```

### ✔ Expected Response
```json
{
  "success": true,
  "requires_confirmation": true,
  "message": "A pipeline has been generated. Would you like me to commit this workflow file?",
  "generated_yaml": "...",
  "pipeline_metadata": { ... }
}
```

The agent stores the repo name + generated YAML internally for the next step.

---

## 📌 Step 2 — Confirm the Commit
Once the agent asks for confirmation, send a follow-up prompt such as:

```bash
curl -X POST http://localhost:3000/agent/wizard/ai \
  -H "Content-Type: application/json" \
  -H "Cookie: mcp_session=YOUR_SESSION_TOKEN" \
  -d '{
    "prompt": "yes commit"
  }'
```

### ✔ Expected Response
```json
{
  "success": true,
  "tool_called": "pipeline_commit",
  "committed_repo": "PVeazie951/google-extention-ai-summarizer",
  "committed_path": ".github/workflows/ci.yml",
  "sha": "...",
  "html_url": "https://github.com/.../ci.yml"
}
```
This confirms the workflow file was successfully committed to the repo.

---

## 🛡 How Confirmation Works
To avoid accidental commits:

- Only explicit intent triggers `pipeline_commit` (e.g., **"yes commit", "commit workflow", "apply pipeline"**)  
- The agent now **ignores model-generated phrases** like "recent commits" or "show commits" during confirmation
- User intent always overrides the agent's reasoning

This makes the multi-step flow consistent and safe.

---

## 📌 Extra: Listing Repositories
You can ask the agent anything:

```bash
curl -X POST http://localhost:3000/agent/wizard/ai \
  -H "Content-Type: application/json" \
  -H "Cookie: mcp_session=YOUR_SESSION_TOKEN" \
  -d '{ "prompt": "List my repositories" }'
```

---

## ✅ Summary
- Use the Wizard Agent API to generate pipelines from natural language prompts
- The agent **requires confirmation** before committing workflows
- Multi-step flow works via persistent session state
- Commits are safe and deterministic due to improved intent detection

If you need a longer doc, diagrams, or frontend usage examples, I can generate those too.

