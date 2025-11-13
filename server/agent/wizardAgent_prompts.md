# 🧙‍♂️ Wizard Agent Prompts

This document contains a collection of working questions and CLI commands you can use to interact with the **wizardAgent** for testing, debugging, and generating pipelines.

Each of these can be run from your terminal like so:

```bash
node server/agent/wizardAgent.js "YOUR QUESTION HERE"
```

---

## 🔍 GitHub Discovery

Use these to fetch repositories, metadata, and details from GitHub.

```bash
node server/agent/wizardAgent.js "What GitHub repos are available for pveazie951"
node server/agent/wizardAgent.js "List all repos I have access to on GitHub"
node server/agent/wizardAgent.js "Tell me about PVeazie951/google-extention-ai-summarizer"
node server/agent/wizardAgent.js "Tell me about PVeazie951/google-extention-ai-summarizer"
node server/agent/wizardAgent.js "Get branches for PVeazie951/soloProject"
node server/agent/wizardAgent.js "List workflows for PVeazie951/soloProject"
node server/agent/wizardAgent.js "Get recent commits for PVeazie951/google-extention-ai-summarizer"
node server/agent/wizardAgent.js "Show the languages used in PVeazie951/soloProject"
```

---

## TODO 📂 Repo Contents / Files

These interact with the `list_root` and `contents` actions in the GitHub adapter.

```bash
node server/agent/wizardAgent.js "List root contents for PVeazie951/soloProject"
node server/agent/wizardAgent.js "Get repo contents for PVeazie951/google-extention-ai-summarizer at README.md"
node server/agent/wizardAgent.js "Read the file server/server.js in PVeazie951/google-extention-ai-summarizer"
node server/agent/wizardAgent.js "Is there a readme in this repo PVeazie951/soloProject"
node server/agent/wizardAgent.js "Show me all files in the root of PVeazie951/soloProject"
node server/agent/wizardAgent.js "Get the workflow YAML file in PVeazie951/soloProject"
```

---

## ⚙️ Pipeline Generation & Recommendations

These prompts trigger the pipeline generator logic and repo inference system.

```bash
node server/agent/wizardAgent.js "Generate a pipeline for my Node app"
node server/agent/wizardAgent.js "Generate a CI/CD pipeline for PVeazie951/soloProject"
node server/agent/wizardAgent.js "What kind of CICD pipeline should I use for PVeazie951/google-extention-ai-summarizer"
node server/agent/wizardAgent.js "Create a GitHub Actions pipeline for my soloProject repo"
node server/agent/wizardAgent.js "What kind of deployment pipeline fits this repo"
node server/agent/wizardAgent.js "Use Jenkins instead of GitHub Actions for deployment"
node server/agent/wizardAgent.js "Generate an AWS OIDC pipeline for PVeazie951/soloProject"
```

---

## 🧠 Tooling Awareness

Check what tools and adapters are available and how the AI is reasoning.

```bash
node server/agent/wizardAgent.js "What tools do you have access to"
node server/agent/wizardAgent.js "List all registered adapters"
node server/agent/wizardAgent.js "Which tools can interact with GitHub"
node server/agent/wizardAgent.js "Explain what the github_adapter can do"
node server/agent/wizardAgent.js "What are the available API calls in the github_adapter"
```

---

## 🔧 Error Handling / Validation

Prompts to help debug or confirm connection issues.

```bash
node server/agent/wizardAgent.js "Test GitHub connection for my user"
node server/agent/wizardAgent.js "Verify that I have a valid GitHub access token"
node server/agent/wizardAgent.js "Do I have a repo called soloProject"
node server/agent/wizardAgent.js "Show me what happens if repo lookup fails"
node server/agent/wizardAgent.js "Handle missing GitHub data gracefully"
```

---

## 🪄 Advanced / Multi-Step Prompts

These will trigger reasoning across the adapter, generator, and pipeline layers.

```bash
node server/agent/wizardAgent.js "Analyze the repo structure of PVeazie951/soloProject and recommend a pipeline"
node server/agent/wizardAgent.js "Read the README and infer what language or framework this repo uses"
node server/agent/wizardAgent.js "Suggest an appropriate CI/CD pipeline for PVeazie951/google-extention-ai-summarizer based on its codebase"
node server/agent/wizardAgent.js "If the repo lacks workflows, generate a starter pipeline"
node server/agent/wizardAgent.js "List tools used by the pipeline generator and adapter"
node server/agent/wizardAgent.js "Summarize how this repo would deploy to AWS"
```

---

## 🧰 Local Development Utilities

Useful when testing or debugging environment setups.

```bash
node server/agent/wizardAgent.js "Show environment variables loaded by dotenv"
node server/agent/wizardAgent.js "Check if Supabase connection is active"
node server/agent/wizardAgent.js "Log which user_id is currently active"
node server/agent/wizardAgent.js "Who am I authenticated as on GitHub"
```

---

### ✅ Quick Tip
To list adapter actions directly:
```bash
node server/agent/wizardAgent.js "List all available actions for github_adapter"
```
