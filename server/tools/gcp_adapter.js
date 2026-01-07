// server/tools/gcp_adapter.js
import { z } from 'zod';

/**
 * GCP Cloud Run workflow generator (Best practice):
 * - Build & push images to GHCR
 * - Pull from GHCR, push to Artifact Registry
 * - Deploy Cloud Run from Artifact Registry
 *
 * IMPORTANT: GHCR requires lowercase repo namespaces → compute owner_lc in each job.
 */

const inputSchema = z.object({
  repo: z.string().optional(),
  branch: z.string().default('main'),

  // Enabled stages (used to include/exclude jobs in the generated workflow)
  stages: z.array(z.enum(['build', 'test', 'deploy'])).default(['build', 'deploy']),

  // Provider config (prefer secrets at runtime)
  gcp_project_id: z.string().default('${{ secrets.GCP_PROJECT_ID }}'),
  gcp_region: z.string().default('${{ secrets.GCP_REGION }}'),
  workload_identity_provider: z
    .string()
    .default('${{ secrets.GCP_WIF_PROVIDER }}'),
  service_account_email: z
    .string()
    .default('${{ secrets.GCP_DEPLOY_SA_EMAIL }}'),

  // Cloud Run services
  backend_service: z.string().default('my-app-api'),
  frontend_service: z.string().default('my-app-web'),

  // Artifact Registry repos (Option A: single repo)
  backend_ar_repo: z.string().default('autodeploy'),
  frontend_ar_repo: z.string().default('autodeploy'),

  // Image names (suffix path)
  backend_image_name: z.string().default('my-app-api'),
  frontend_image_name: z.string().default('my-app-web'),

  // Repo layout (Option A) — defaults aligned to my-app/
  backend_context: z.string().default('backend'),
  backend_dockerfile: z.string().default('backend/Dockerfile'),

  frontend_context: z.string().default('frontend'),
  frontend_dockerfile: z.string().default('frontend/Dockerfile'),

  backend_port: z.number().int().default(8080),
  frontend_port: z.number().int().default(8080),

  // Optional: auto-generate Dockerfiles if repo has none
  generate_dockerfiles: z.boolean().default(false),
});

export const gcp_adapter = {
  name: 'gcp_adapter',
  description:
    'Generates GitHub Actions CI/CD workflow for GCP Cloud Run (GHCR → Artifact Registry → Cloud Run) using OIDC (WIF).',
  input_schema: inputSchema,

  handler: async (raw) => {
    // Note: GitHub Actions expressions like ${{ ... }} are produced via the gha() helper
    // to avoid JS template interpolation issues.
    const gha = (expr) => '${{ ' + expr + ' }}';

    const input = inputSchema.parse(raw);

    const {
      branch,
      stages,
      gcp_project_id,
      gcp_region,
      workload_identity_provider,
      service_account_email,
      backend_service,
      frontend_service,
      backend_ar_repo,
      frontend_ar_repo,
      backend_image_name,
      frontend_image_name,
      backend_context,
      backend_dockerfile,
      frontend_context,
      frontend_dockerfile,
      backend_port,
      frontend_port,
      generate_dockerfiles,
    } = input;

    const includeDeploy = stages.includes('deploy');
    const includeBuild = stages.includes('build') || includeDeploy;

    const buildJobs = includeBuild
      ? `  build-backend:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Compute lowercase owner
        id: vars
        shell: bash
        run: |
          OWNER_LC="$(echo "${gha(
            'github.repository_owner'
          )}" | tr '[:upper:]' '[:lower:]')"
          echo "owner_lc=$OWNER_LC" >> "$GITHUB_OUTPUT"

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${gha('github.actor')}
          password: ${gha('secrets.GITHUB_TOKEN')}

      - name: Generate backend Dockerfile (if missing)
        if: ${gha("env.GENERATE_DOCKERFILES == 'true'")}
        shell: bash
        run: |
          if [ ! -f "${gha('env.BACKEND_DOCKERFILE_PATH')}" ]; then
            echo "Generating ${gha('env.BACKEND_DOCKERFILE_PATH')}"
            mkdir -p "$(dirname "${gha('env.BACKEND_DOCKERFILE_PATH')}")"
            cat > "${gha('env.BACKEND_DOCKERFILE_PATH')}" << 'EOF'
            FROM node:20-alpine
            WORKDIR /app
            COPY package*.json ./
            RUN npm ci --omit=dev
            COPY . .
            EXPOSE 8080
            CMD ["npm", "start"]
            EOF
          fi

      - name: Build backend image
        shell: bash
        run: |
          BACKEND_GHCR="ghcr.io/${gha('steps.vars.outputs.owner_lc')}/${gha(
      'env.BACKEND_IMAGE_NAME'
    )}"
          echo "BACKEND_GHCR=$BACKEND_GHCR" >> "$GITHUB_ENV"
          docker build -f "${gha(
            'env.BACKEND_DOCKERFILE_PATH'
          )}" -t "$BACKEND_GHCR:${gha(
      'github.sha'
    )}" -t "$BACKEND_GHCR:latest" "${gha('env.BACKEND_CONTEXT')}"

      - name: Push backend image to GHCR
        shell: bash
        run: |
          docker push "$BACKEND_GHCR:${gha('github.sha')}"
          docker push "$BACKEND_GHCR:latest"

  build-frontend:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Compute lowercase owner
        id: vars
        shell: bash
        run: |
          OWNER_LC="$(echo "${gha(
            'github.repository_owner'
          )}" | tr '[:upper:]' '[:lower:]')"
          echo "owner_lc=$OWNER_LC" >> "$GITHUB_OUTPUT"

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${gha('github.actor')}
          password: ${gha('secrets.GITHUB_TOKEN')}

      - name: Generate frontend Dockerfile (if missing)
        if: ${gha("env.GENERATE_DOCKERFILES == 'true'")}
        shell: bash
        run: |
          if [ ! -f "${gha('env.FRONTEND_DOCKERFILE_PATH')}" ]; then
            echo "Generating ${gha('env.FRONTEND_DOCKERFILE_PATH')}"
            mkdir -p "$(dirname "${gha('env.FRONTEND_DOCKERFILE_PATH')}")"
            cat > "${gha('env.FRONTEND_DOCKERFILE_PATH')}" << 'EOF'
            FROM node:20-alpine AS build
            WORKDIR /app
            COPY package*.json ./
            RUN npm ci
            COPY . .
            RUN npm run build

            FROM nginx:alpine
            COPY --from=build /app/dist /usr/share/nginx/html
            EXPOSE 8080
            CMD ["nginx", "-g", "daemon off;"]
            EOF
          fi

      - name: Build frontend image
        shell: bash
        run: |
          FRONTEND_GHCR="ghcr.io/${gha('steps.vars.outputs.owner_lc')}/${gha(
      'env.FRONTEND_IMAGE_NAME'
    )}"
          echo "FRONTEND_GHCR=$FRONTEND_GHCR" >> "$GITHUB_ENV"
          docker build -f "${gha(
            'env.FRONTEND_DOCKERFILE_PATH'
          )}" -t "$FRONTEND_GHCR:${gha(
      'github.sha'
    )}" -t "$FRONTEND_GHCR:latest" "${gha('env.FRONTEND_CONTEXT')}"

      - name: Push frontend image to GHCR
        shell: bash
        run: |
          docker push "$FRONTEND_GHCR:${gha('github.sha')}"
          docker push "$FRONTEND_GHCR:latest"
`
      : '';

    const deployJobs = includeDeploy
      ? `
  deploy-backend:
    needs: build-backend
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Compute lowercase owner
        id: vars
        shell: bash
        run: |
          OWNER_LC="$(echo "${gha(
            'github.repository_owner'
          )}" | tr '[:upper:]' '[:lower:]')"
          echo "owner_lc=$OWNER_LC" >> "$GITHUB_OUTPUT"

      - name: Auth to Google Cloud (OIDC)
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${workload_identity_provider}
          service_account: ${service_account_email}

      - name: Set up gcloud
        uses: google-github-actions/setup-gcloud@v2
        with:
          project_id: ${gha('env.GCP_PROJECT_ID')}

      - name: Compute Artifact Registry host + backend AR image
        id: ar
        shell: bash
        run: |
          AR_HOST="${gha('env.GCP_REGION')}-docker.pkg.dev"
          BACKEND_AR_IMAGE="$AR_HOST/${gha('env.GCP_PROJECT_ID')}/${gha(
      'env.BACKEND_AR_REPO'
    )}/${gha('env.BACKEND_IMAGE_NAME')}"
          echo "AR_HOST=$AR_HOST" >> "$GITHUB_OUTPUT"
          echo "BACKEND_AR_IMAGE=$BACKEND_AR_IMAGE" >> "$GITHUB_OUTPUT"

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker "${gha(
            'steps.ar.outputs.AR_HOST'
          )}" --quiet

      - name: Pull backend image from GHCR
        shell: bash
        run: |
          BACKEND_GHCR="ghcr.io/${gha('steps.vars.outputs.owner_lc')}/${gha(
      'env.BACKEND_IMAGE_NAME'
    )}"
          echo "BACKEND_GHCR=$BACKEND_GHCR" >> "$GITHUB_ENV"
          echo "${gha(
            'secrets.GITHUB_TOKEN'
          )}" | docker login ghcr.io -u "${gha(
      'github.actor'
    )}" --password-stdin
          docker pull "$BACKEND_GHCR:${gha('github.sha')}"

      - name: Tag & push backend image to Artifact Registry
        shell: bash
        run: |
          docker tag "$BACKEND_GHCR:${gha('github.sha')}" "${gha(
      'steps.ar.outputs.BACKEND_AR_IMAGE'
    )}:${gha('github.sha')}"
          docker push "${gha('steps.ar.outputs.BACKEND_AR_IMAGE')}:${gha(
      'github.sha'
    )}"

      - name: Deploy backend to Cloud Run
        run: |
          gcloud run deploy "${gha('env.BACKEND_SERVICE')}" \\
            --image "${gha('steps.ar.outputs.BACKEND_AR_IMAGE')}:${gha(
      'github.sha'
    )}" \\
            --region "${gha('env.GCP_REGION')}" \\
            --platform managed \\
            --allow-unauthenticated \\
            --port ${gha('env.BACKEND_PORT')}

  deploy-frontend:
    needs: build-frontend
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Compute lowercase owner
        id: vars
        shell: bash
        run: |
          OWNER_LC="$(echo "${gha(
            'github.repository_owner'
          )}" | tr '[:upper:]' '[:lower:]')"
          echo "owner_lc=$OWNER_LC" >> "$GITHUB_OUTPUT"

      - name: Auth to Google Cloud (OIDC)
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${workload_identity_provider}
          service_account: ${service_account_email}

      - name: Set up gcloud
        uses: google-github-actions/setup-gcloud@v2
        with:
          project_id: ${gha('env.GCP_PROJECT_ID')}

      - name: Compute Artifact Registry host + frontend AR image
        id: ar
        shell: bash
        run: |
          AR_HOST="${gha('env.GCP_REGION')}-docker.pkg.dev"
          FRONTEND_AR_IMAGE="$AR_HOST/${gha('env.GCP_PROJECT_ID')}/${gha(
      'env.FRONTEND_AR_REPO'
    )}/${gha('env.FRONTEND_IMAGE_NAME')}"
          echo "AR_HOST=$AR_HOST" >> "$GITHUB_OUTPUT"
          echo "FRONTEND_AR_IMAGE=$FRONTEND_AR_IMAGE" >> "$GITHUB_OUTPUT"

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker "${gha(
            'steps.ar.outputs.AR_HOST'
          )}" --quiet

      - name: Pull frontend image from GHCR
        shell: bash
        run: |
          FRONTEND_GHCR="ghcr.io/${gha('steps.vars.outputs.owner_lc')}/${gha(
      'env.FRONTEND_IMAGE_NAME'
    )}"
          echo "FRONTEND_GHCR=$FRONTEND_GHCR" >> "$GITHUB_ENV"
          echo "${gha(
            'secrets.GITHUB_TOKEN'
          )}" | docker login ghcr.io -u "${gha(
      'github.actor'
    )}" --password-stdin
          docker pull "$FRONTEND_GHCR:${gha('github.sha')}"

      - name: Tag & push frontend image to Artifact Registry
        shell: bash
        run: |
          docker tag "$FRONTEND_GHCR:${gha('github.sha')}" "${gha(
      'steps.ar.outputs.FRONTEND_AR_IMAGE'
    )}:${gha('github.sha')}"
          docker push "${gha('steps.ar.outputs.FRONTEND_AR_IMAGE')}:${gha(
      'github.sha'
    )}"

      - name: Deploy frontend to Cloud Run
        run: |
          gcloud run deploy "${gha('env.FRONTEND_SERVICE')}" \\
            --image "${gha('steps.ar.outputs.FRONTEND_AR_IMAGE')}:${gha(
      'github.sha'
    )}" \\
            --region "${gha('env.GCP_REGION')}" \\
            --platform managed \\
            --allow-unauthenticated \\
            --port ${gha('env.FRONTEND_PORT')}
`
      : '';

    const yaml = `name: CI/CD (GCP Cloud Run)

on:
  push:
    branches:
      - ${branch}
  pull_request:
    branches:
      - ${branch}

permissions:
  contents: read
  packages: write
  id-token: write

env:
  GCP_REGION: ${gcp_region}
  GCP_PROJECT_ID: ${gcp_project_id}

  BACKEND_SERVICE: ${backend_service}
  FRONTEND_SERVICE: ${frontend_service}

  BACKEND_AR_REPO: ${backend_ar_repo}
  FRONTEND_AR_REPO: ${frontend_ar_repo}

  BACKEND_IMAGE_NAME: ${backend_image_name}
  FRONTEND_IMAGE_NAME: ${frontend_image_name}

  # Option A: repo layout (docker build context + dockerfile paths)
  BACKEND_CONTEXT: "${backend_context}"
  BACKEND_DOCKERFILE_PATH: "${backend_dockerfile}"
  BACKEND_PORT: "${backend_port}"

  FRONTEND_CONTEXT: "${frontend_context}"
  FRONTEND_DOCKERFILE_PATH: "${frontend_dockerfile}"
  FRONTEND_PORT: "${frontend_port}"

  # If true, the workflow will create Dockerfiles at the paths above (only if missing)
  GENERATE_DOCKERFILES: "${generate_dockerfiles ? 'true' : 'false'}"

jobs:
${buildJobs}${deployJobs}
`;

    const effectiveStages = includeDeploy ? ['build', 'deploy'] : ['build'];

    return {
      success: true,
      data: {
        pipeline_name: 'gcp-cloud-run-ci.yml',
        provider: 'gcp',
        template: 'node_app',
        stages: effectiveStages,
        generated_yaml: yaml,
      },
    };
  },
};

export default gcp_adapter;
