# AutoDeploy
# MCP CI/CD Builder

## 🧩 Overview
AI-driven system that generates secure, automated CI/CD pipelines for GitHub projects.

### Team
- Victoria — Frontend & State Management/GitHub Integrations
- Lorenc — Backend / MCP Orchestration/GitHub Integrations 
- Alex — SCRUM/ AWS / DevOps
- Paython — SCRUM / MCP Integration

### Tech Stack
React + Tailwind + Shadcn + Zustand  
Node + Express + Supabase + MCP SDK  
AWS OIDC + GitHub Actions  


General plan for file structure:

mcp-ci-cd-builder/
├── client/                # React + Tailwind + Zustand frontend (Victoria)
│   ├── src/
│   ├── public/
│   └── package.json
├── server/                # MCP orchestrator + adapters (Lorenc)
│   ├── src/
│   ├── package.json
│   └── mcp.config.json
├── infra/                 # AWS OIDC + GitHub Actions workflows (Alex)
│   ├── workflows/
│   └── terraform/ or aws-oidc.yml
├── tests/                 # Shared test utilities (Paython)
│   ├── integration/
│   └── unit/
├── .github/
│   └── workflows/
│       └── ci.yml
├── README.md
└── .env.example