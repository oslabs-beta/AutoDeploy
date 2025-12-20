import { z } from 'zod';

function nodeBackendDockerfile() {
  return `
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "start"]
`.trim();
}

function viteFrontendDockerfile() {
  return `
# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- run stage (Cloud Run friendly) ----
FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist /app/dist

# Cloud Run sets PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "serve -s /app/dist -l \${PORT:-8080}"]
`.trim();
}

const dockerignore = `
node_modules
dist
.DS_Store
npm-debug.log
`.trim();

export const scaffold_generator = {
  name: 'scaffold_generator',
  description:
    'Generate Dockerfiles and dockerignore for a simple repo layout (backend + frontend).',
  input_schema: z.object({
    backendPath: z.string().default('backend'),
    frontendPath: z.string().default('frontend'),
  }),
  handler: async ({ backendPath = 'backend', frontendPath = 'frontend' }) => {
    return {
      ok: true,
      files: [
        { path: `${backendPath}/Dockerfile`, content: nodeBackendDockerfile() },
        { path: `${backendPath}/.dockerignore`, content: dockerignore },
        {
          path: `${frontendPath}/Dockerfile`,
          content: viteFrontendDockerfile(),
        },
        { path: `${frontendPath}/.dockerignore`, content: dockerignore },
      ],
    };
  },
};
