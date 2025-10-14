# AutoDeploy
Auto-Generated Secure CI/CD Pipelines with AI + MCP


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