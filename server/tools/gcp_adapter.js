// server/tools/gcp_adapter.js
import { z } from 'zod';

/**
 * GCP Cloud Run workflow generator (Best practice):
 * - Build & push images to GHCR
 * - Pull from GHCR, push to Artifact Registry
 * - Deploy Cloud Run from Artifact Registry
 *
 * Supports "Option A" (configurable repo layout) + optional Dockerfile generation.
 * IMPORTANT: GHCR requires lowercase repo namespaces → compute owner_lc in each job.
 */

const inputSchema = z.object({
  repo: z.string().optional(),
  branch: z.string().default('main'),

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
  backend_service: z.string().default('mcp-backend'),
  frontend_service: z.string().default('mcp-frontend'),

  // Artifact Registry repos (must exist)
  backend_ar_repo: z.string().default('mcp-backend'),
  frontend_ar_repo: z.string().default('mcp-frontend'),

  // Image names (suffix path)
  backend_image_name: z.string().default('mcp-backend'),
  frontend_image_name: z.string().default('mcp-frontend'),

  // Repo layout (Option A)
  backend_context: z.string().default('.'),
  backend_dockerfile: z.string().default('Dockerfile'),

  frontend_context: z.string().default('.'),
  frontend_dockerfile: z.string().default('Dockerfile.frontend'),

  backend_port: z.number().int().default(3000),
  frontend_port: z.number().int().default(80),

  // Optional: auto-generate Dockerfiles if repo has none
  generate_dockerfiles: z.boolean().default(false),
});

export const gcp_adapter = {
  name: 'gcp_adapter',
  description:
    'Generates GitHub Actions CI/CD workflow for GCP Cloud Run (GHCR → Artifact Registry → Cloud Run) using OIDC (WIF).',
  input_schema: inputSchema,

  handler: async (raw) => {
    const input = inputSchema.parse(raw);

    const {
      branch,
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

    // Note:
    // - `${{ ... }}` inside a JS template string MUST be escaped as `\${{ ... }}`.
    // - Otherwise Node tries to interpret `${` as JS interpolation and you get syntax errors.
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
  build-backend:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Compute lowercase owner
        id: vars
        shell: bash
        run: |
          OWNER_LC="$(echo "\${{ github.repository_owner }}" | tr '[:upper:]' '[:lower:]')"
          echo "owner_lc=$OWNER_LC" >> "$GITHUB_OUTPUT"

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Generate backend Dockerfile (if missing)
        if: \${{ env.GENERATE_DOCKERFILES == 'true' }}
        shell: bash
        run: |
          if [ ! -f "\${{ env.BACKEND_DOCKERFILE_PATH }}" ]; then
            echo "Generating \${{ env.BACKEND_DOCKERFILE_PATH }}"
            mkdir -p "$(dirname "\${{ env.BACKEND_DOCKERFILE_PATH }}")"

            # This Dockerfile assumes the build context is the backend folder (e.g. "server")
            # and the entry point is "index.js" inside that folder.
            cat > "\${{ env.BACKEND_DOCKERFILE_PATH }}" << 'EOF'
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
EOF
          fi

      - name: Build backend image
        shell: bash
        run: |
          BACKEND_GHCR="ghcr.io/\${{ steps.vars.outputs.owner_lc }}/\${{ env.BACKEND_IMAGE_NAME }}"
          echo "BACKEND_GHCR=$BACKEND_GHCR" >> $GITHUB_ENV

          docker build \\
            -f "\${{ env.BACKEND_DOCKERFILE_PATH }}" \\
            -t "$BACKEND_GHCR:\${{ github.sha }}" \\
            -t "$BACKEND_GHCR:latest" \\
            "\${{ env.BACKEND_CONTEXT }}"

      - name: Push backend image to GHCR
        shell: bash
        run: |
          docker push "$BACKEND_GHCR:\${{ github.sha }}"
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
          OWNER_LC="$(echo "\${{ github.repository_owner }}" | tr '[:upper:]' '[:lower:]')"
          echo "owner_lc=$OWNER_LC" >> "$GITHUB_OUTPUT"

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Generate frontend Dockerfile (if missing)
        if: \${{ env.GENERATE_DOCKERFILES == 'true' }}
        shell: bash
        run: |
          if [ ! -f "\${{ env.FRONTEND_DOCKERFILE_PATH }}" ]; then
            echo "Generating \${{ env.FRONTEND_DOCKERFILE_PATH }}"
            mkdir -p "$(dirname "\${{ env.FRONTEND_DOCKERFILE_PATH }}")"

            # Multi-stage build for typical Vite/React frontends that output /dist
            cat > "\${{ env.FRONTEND_DOCKERFILE_PATH }}" << 'EOF'
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
EOF
          fi

      - name: Build frontend image
        shell: bash
        run: |
          FRONTEND_GHCR="ghcr.io/\${{ steps.vars.outputs.owner_lc }}/\${{ env.FRONTEND_IMAGE_NAME }}"
          echo "FRONTEND_GHCR=$FRONTEND_GHCR" >> $GITHUB_ENV

          docker build \\
            -f "\${{ env.FRONTEND_DOCKERFILE_PATH }}" \\
            -t "$FRONTEND_GHCR:\${{ github.sha }}" \\
            -t "$FRONTEND_GHCR:latest" \\
            "\${{ env.FRONTEND_CONTEXT }}"

      - name: Push frontend image to GHCR
        shell: bash
        run: |
          docker push "$FRONTEND_GHCR:\${{ github.sha }}"
          docker push "$FRONTEND_GHCR:latest"

  deploy-backend:
    needs: build-backend
    runs-on: ubuntu-latest
    steps:
      - name: Compute lowercase owner
        id: vars
        shell: bash
        run: |
          OWNER_LC="$(echo "\${{ github.repository_owner }}" | tr '[:upper:]' '[:lower:]')"
          echo "owner_lc=$OWNER_LC" >> "$GITHUB_OUTPUT"

      - name: Auth to Google Cloud (OIDC)
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${workload_identity_provider}
          service_account: ${service_account_email}

      - name: Set up gcloud
        uses: google-github-actions/setup-gcloud@v2
        with:
          project_id: \${{ env.GCP_PROJECT_ID }}

      - name: Compute Artifact Registry host + backend AR image
        id: ar
        shell: bash
        run: |
          AR_HOST="\${{ env.GCP_REGION }}-docker.pkg.dev"
          BACKEND_AR_IMAGE="$AR_HOST/\${{ env.GCP_PROJECT_ID }}/\${{ env.BACKEND_AR_REPO }}/\${{ env.BACKEND_IMAGE_NAME }}"
          echo "AR_HOST=$AR_HOST" >> $GITHUB_OUTPUT
          echo "BACKEND_AR_IMAGE=$BACKEND_AR_IMAGE" >> $GITHUB_OUTPUT

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker "\${{ steps.ar.outputs.AR_HOST }}" --quiet

      - name: Pull backend image from GHCR
        shell: bash
        run: |
          BACKEND_GHCR="ghcr.io/\${{ steps.vars.outputs.owner_lc }}/\${{ env.BACKEND_IMAGE_NAME }}"
          echo "BACKEND_GHCR=$BACKEND_GHCR" >> $GITHUB_ENV
          echo "\${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "\${{ github.actor }}" --password-stdin
          docker pull "$BACKEND_GHCR:\${{ github.sha }}"

      - name: Tag & push backend image to Artifact Registry
        shell: bash
        run: |
          docker tag "$BACKEND_GHCR:\${{ github.sha }}" "\${{ steps.ar.outputs.BACKEND_AR_IMAGE }}:\${{ github.sha }}"
          docker push "\${{ steps.ar.outputs.BACKEND_AR_IMAGE }}:\${{ github.sha }}"

      - name: Deploy backend to Cloud Run
        run: |
          gcloud run deploy "\${{ env.BACKEND_SERVICE }}" \\
            --image "\${{ steps.ar.outputs.BACKEND_AR_IMAGE }}:\${{ github.sha }}" \\
            --region "\${{ env.GCP_REGION }}" \\
            --platform managed \\
            --allow-unauthenticated \\
            --port \${{ env.BACKEND_PORT }}

  deploy-frontend:
    needs: build-frontend
    runs-on: ubuntu-latest
    steps:
      - name: Compute lowercase owner
        id: vars
        shell: bash
        run: |
          OWNER_LC="$(echo "\${{ github.repository_owner }}" | tr '[:upper:]' '[:lower:]')"
          echo "owner_lc=$OWNER_LC" >> "$GITHUB_OUTPUT"

      - name: Auth to Google Cloud (OIDC)
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${workload_identity_provider}
          service_account: ${service_account_email}

      - name: Set up gcloud
        uses: google-github-actions/setup-gcloud@v2
        with:
          project_id: \${{ env.GCP_PROJECT_ID }}

      - name: Compute Artifact Registry host + frontend AR image
        id: ar
        shell: bash
        run: |
          AR_HOST="\${{ env.GCP_REGION }}-docker.pkg.dev"
          FRONTEND_AR_IMAGE="$AR_HOST/\${{ env.GCP_PROJECT_ID }}/\${{ env.FRONTEND_AR_REPO }}/\${{ env.FRONTEND_IMAGE_NAME }}"
          echo "AR_HOST=$AR_HOST" >> $GITHUB_OUTPUT
          echo "FRONTEND_AR_IMAGE=$FRONTEND_AR_IMAGE" >> $GITHUB_OUTPUT

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker "\${{ steps.ar.outputs.AR_HOST }}" --quiet

      - name: Pull frontend image from GHCR
        shell: bash
        run: |
          FRONTEND_GHCR="ghcr.io/\${{ steps.vars.outputs.owner_lc }}/\${{ env.FRONTEND_IMAGE_NAME }}"
          echo "FRONTEND_GHCR=$FRONTEND_GHCR" >> $GITHUB_ENV
          echo "\${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "\${{ github.actor }}" --password-stdin
          docker pull "$FRONTEND_GHCR:\${{ github.sha }}"

      - name: Tag & push frontend image to Artifact Registry
        shell: bash
        run: |
          docker tag "$FRONTEND_GHCR:\${{ github.sha }}" "\${{ steps.ar.outputs.FRONTEND_AR_IMAGE }}:\${{ github.sha }}"
          docker push "\${{ steps.ar.outputs.FRONTEND_AR_IMAGE }}:\${{ github.sha }}"

      - name: Deploy frontend to Cloud Run
        run: |
          gcloud run deploy "\${{ env.FRONTEND_SERVICE }}" \\
            --image "\${{ steps.ar.outputs.FRONTEND_AR_IMAGE }}:\${{ github.sha }}" \\
            --region "\${{ env.GCP_REGION }}" \\
            --platform managed \\
            --allow-unauthenticated \\
            --port \${{ env.FRONTEND_PORT }}
`;

    return {
      success: true,
      data: {
        pipeline_name: 'gcp-cloud-run-ci.yml',
        provider: 'gcp',
        template: 'node_app',
        stages: ['build', 'deploy'],
        generated_yaml: yaml,
      },
    };
  },
};

export default gcp_adapter;
