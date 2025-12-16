// // server/tools/gcp_adapter.js
// import { z } from 'zod';

// /**
//  * GCP Cloud Run workflow generator (GHCR → Artifact Registry → Cloud Run)
//  *
//  * This generator outputs a workflow that expects these GitHub Secrets to exist:
//  * - GCP_PROJECT_ID
//  * - GCP_REGION
//  * - GCP_WIF_PROVIDER          (Workload Identity Provider resource name)
//  * - GCP_DEPLOY_SA_EMAIL       (Service Account email to impersonate)
//  *
//  * Optional note:
//  * - Runtime env vars should be set on Cloud Run (recommended),
//  *   not in the GitHub Actions workflow.
//  */
// export const gcp_adapter = {
//   name: 'gcp_adapter',
//   description:
//     'Generate a GitHub Actions YAML workflow for GCP Cloud Run deployments (GHCR → Artifact Registry → Cloud Run) using GitHub OIDC.',

//   input_schema: z.object({
//     repo: z.string(),
//     branch: z.string().default('main'),

//     // If you pass explicit values, they get baked into the YAML.
//     // If omitted, the YAML references GitHub Secrets (recommended).
//     gcp_project_id: z
//       .string()
//       .optional()
//       .default('${{ secrets.GCP_PROJECT_ID }}'),
//     gcp_region: z.string().optional().default('${{ secrets.GCP_REGION }}'),
//     workload_identity_provider: z
//       .string()
//       .optional()
//       .default('${{ secrets.GCP_WIF_PROVIDER }}'),
//     service_account_email: z
//       .string()
//       .optional()
//       .default('${{ secrets.GCP_DEPLOY_SA_EMAIL }}'),

//     backend_service: z.string().default('mcp-backend'),
//     frontend_service: z.string().default('mcp-frontend'),

//     // Artifact Registry repositories
//     backend_ar_repo: z.string().default('mcp-backend'),
//     frontend_ar_repo: z.string().default('mcp-frontend'),

//     // Image names
//     backend_image_name: z.string().default('mcp-backend'),
//     frontend_image_name: z.string().default('mcp-frontend'),

//     backend_port: z.number().int().default(3000),
//     frontend_port: z.number().int().default(80),
//   }),

//   handler: async (raw) => {
//     const input = gcp_adapter.input_schema.parse(raw);

//     const {
//       branch,
//       gcp_project_id,
//       gcp_region,
//       workload_identity_provider,
//       service_account_email,
//       backend_service,
//       frontend_service,
//       backend_ar_repo,
//       frontend_ar_repo,
//       backend_image_name,
//       frontend_image_name,
//       backend_port,
//       frontend_port,
//     } = input;

//     const backendGhcr = `ghcr.io/\${{ github.repository_owner }}/${backend_image_name}`;
//     const frontendGhcr = `ghcr.io/\${{ github.repository_owner }}/${frontend_image_name}`;

//     const yaml = `name: CI/CD (GCP Cloud Run)

// on:
//   push:
//     branches:
//       - ${branch}
//   pull_request:
//     branches:
//       - ${branch}

// # Needed for GHCR + GCP OIDC
// permissions:
//   contents: read
//   packages: write
//   id-token: write

// env:
//   GCP_REGION: ${gcp_region}
//   GCP_PROJECT_ID: ${gcp_project_id}

//   BACKEND_SERVICE: ${backend_service}
//   FRONTEND_SERVICE: ${frontend_service}

//   BACKEND_AR_REPO: ${backend_ar_repo}
//   FRONTEND_AR_REPO: ${frontend_ar_repo}

//   BACKEND_IMAGE_NAME: ${backend_image_name}
//   FRONTEND_IMAGE_NAME: ${frontend_image_name}

// jobs:
//   build-backend:
//     runs-on: ubuntu-latest
//     steps:
//       - name: Checkout
//         uses: actions/checkout@v4

//       - name: Login to GHCR
//         uses: docker/login-action@v3
//         with:
//           registry: ghcr.io
//           username: \${{ github.actor }}
//           password: \${{ secrets.GITHUB_TOKEN }}

//       - name: Build backend image
//         run: |
//           docker build -t ${backendGhcr}:\${{ github.sha }} -t ${backendGhcr}:latest .

//       - name: Push backend image to GHCR
//         run: |
//           docker push ${backendGhcr}:\${{ github.sha }}
//           docker push ${backendGhcr}:latest

//   build-frontend:
//     runs-on: ubuntu-latest
//     steps:
//       - name: Checkout
//         uses: actions/checkout@v4

//       - name: Login to GHCR
//         uses: docker/login-action@v3
//         with:
//           registry: ghcr.io
//           username: \${{ github.actor }}
//           password: \${{ secrets.GITHUB_TOKEN }}

//       - name: Build frontend image
//         run: |
//           docker build -f Dockerfile.frontend -t ${frontendGhcr}:\${{ github.sha }} -t ${frontendGhcr}:latest .

//       - name: Push frontend image to GHCR
//         run: |
//           docker push ${frontendGhcr}:\${{ github.sha }}
//           docker push ${frontendGhcr}:latest

//   deploy-backend:
//     needs: build-backend
//     runs-on: ubuntu-latest
//     steps:
//       - name: Auth to Google Cloud (OIDC)
//         uses: google-github-actions/auth@v2
//         with:
//           workload_identity_provider: ${workload_identity_provider}
//           service_account: ${service_account_email}

//       - name: Set up gcloud
//         uses: google-github-actions/setup-gcloud@v2
//         with:
//           project_id: \${{ env.GCP_PROJECT_ID }}

//       - name: Compute Artifact Registry host + backend AR image
//         id: ar
//         run: |
//           AR_HOST="\${{ env.GCP_REGION }}-docker.pkg.dev"
//           BACKEND_AR_IMAGE="$AR_HOST/\${{ env.GCP_PROJECT_ID }}/\${{ env.BACKEND_AR_REPO }}/\${{ env.BACKEND_IMAGE_NAME }}"
//           echo "AR_HOST=$AR_HOST" >> $GITHUB_OUTPUT
//           echo "BACKEND_AR_IMAGE=$BACKEND_AR_IMAGE" >> $GITHUB_OUTPUT

//       - name: Configure Docker for Artifact Registry
//         run: |
//           gcloud auth configure-docker \${{ steps.ar.outputs.AR_HOST }} --quiet

//       - name: Pull backend image from GHCR
//         run: |
//           echo "\${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "\${{ github.actor }}" --password-stdin
//           docker pull ${backendGhcr}:\${{ github.sha }}

//       - name: Tag & push backend image to Artifact Registry
//         run: |
//           docker tag ${backendGhcr}:\${{ github.sha }} \${{ steps.ar.outputs.BACKEND_AR_IMAGE }}:\${{ github.sha }}
//           docker push \${{ steps.ar.outputs.BACKEND_AR_IMAGE }}:\${{ github.sha }}

//       - name: Deploy backend to Cloud Run
//         run: |
//           gcloud run deploy \${{ env.BACKEND_SERVICE }} \
//             --image \${{ steps.ar.outputs.BACKEND_AR_IMAGE }}:\${{ github.sha }} \
//             --region \${{ env.GCP_REGION }} \
//             --platform managed \
//             --allow-unauthenticated \
//             --port ${backend_port}

//   deploy-frontend:
//     needs: build-frontend
//     runs-on: ubuntu-latest
//     steps:
//       - name: Auth to Google Cloud (OIDC)
//         uses: google-github-actions/auth@v2
//         with:
//           workload_identity_provider: ${workload_identity_provider}
//           service_account: ${service_account_email}

//       - name: Set up gcloud
//         uses: google-github-actions/setup-gcloud@v2
//         with:
//           project_id: \${{ env.GCP_PROJECT_ID }}

//       - name: Compute Artifact Registry host + frontend AR image
//         id: ar
//         run: |
//           AR_HOST="\${{ env.GCP_REGION }}-docker.pkg.dev"
//           FRONTEND_AR_IMAGE="$AR_HOST/\${{ env.GCP_PROJECT_ID }}/\${{ env.FRONTEND_AR_REPO }}/\${{ env.FRONTEND_IMAGE_NAME }}"
//           echo "AR_HOST=$AR_HOST" >> $GITHUB_OUTPUT
//           echo "FRONTEND_AR_IMAGE=$FRONTEND_AR_IMAGE" >> $GITHUB_OUTPUT

//       - name: Configure Docker for Artifact Registry
//         run: |
//           gcloud auth configure-docker \${{ steps.ar.outputs.AR_HOST }} --quiet

//       - name: Pull frontend image from GHCR
//         run: |
//           echo "\${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "\${{ github.actor }}" --password-stdin
//           docker pull ${frontendGhcr}:\${{ github.sha }}

//       - name: Tag & push frontend image to Artifact Registry
//         run: |
//           docker tag ${frontendGhcr}:\${{ github.sha }} \${{ steps.ar.outputs.FRONTEND_AR_IMAGE }}:\${{ github.sha }}
//           docker push \${{ steps.ar.outputs.FRONTEND_AR_IMAGE }}:\${{ github.sha }}

//       - name: Deploy frontend to Cloud Run
//         run: |
//           gcloud run deploy \${{ env.FRONTEND_SERVICE }} \
//             --image \${{ steps.ar.outputs.FRONTEND_AR_IMAGE }}:\${{ github.sha }} \
//             --region \${{ env.GCP_REGION }} \
//             --platform managed \
//             --allow-unauthenticated \
//             --port ${frontend_port}
// `;

//     return { success: true, data: { generated_yaml: yaml } };
//   },
// };
// server/tools/gcp_adapter.js
import { z } from 'zod';

/**
 * GCP Cloud Run workflow generator (Best practice):
 * 1) Build & push images to GHCR
 * 2) Pull from GHCR, push to Artifact Registry
 * 3) Deploy Cloud Run from Artifact Registry
 *
 * Key fix: GHCR namespaces MUST be lowercase.
 * We compute a lowercase owner in each job and use it for all GHCR refs.
 */
export const gcp_adapter = {
  name: 'gcp_adapter',
  description:
    'Generate a GitHub Actions YAML workflow for GCP Cloud Run (GHCR → Artifact Registry → Cloud Run) using GitHub OIDC (WIF).',

  input_schema: z.object({
    // Repo identification (not used directly by YAML, but helpful for callers)
    repo: z.string(),
    branch: z.string().default('main'),

    // Prefer secrets in the generated workflow
    gcp_project_id: z
      .string()
      .optional()
      .default('${{ secrets.GCP_PROJECT_ID }}'),
    gcp_region: z.string().optional().default('${{ secrets.GCP_REGION }}'),

    // OIDC / WIF
    workload_identity_provider: z
      .string()
      .optional()
      .default('${{ secrets.GCP_WIF_PROVIDER }}'),
    service_account_email: z
      .string()
      .optional()
      .default('${{ secrets.GCP_DEPLOY_SA_EMAIL }}'),

    // Cloud Run service names
    backend_service: z.string().default('mcp-backend'),
    frontend_service: z.string().default('mcp-frontend'),

    // Artifact Registry repositories (must exist in GCP)
    backend_ar_repo: z.string().default('mcp-backend'),
    frontend_ar_repo: z.string().default('mcp-frontend'),

    // Image names (path suffixes)
    backend_image_name: z.string().default('mcp-backend'),
    frontend_image_name: z.string().default('mcp-frontend'),

    // Build inputs
    backend_dockerfile: z.string().default('Dockerfile'),
    backend_context: z.string().default('.'),

    frontend_dockerfile: z.string().default('Dockerfile.frontend'),
    frontend_context: z.string().default('.'),

    // Cloud Run ports
    backend_port: z.number().int().default(3000),
    frontend_port: z.number().int().default(80),
  }),

  handler: async (raw) => {
    const input = gcp_adapter.input_schema.parse(raw);

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
      backend_dockerfile,
      backend_context,
      frontend_dockerfile,
      frontend_context,
      backend_port,
      frontend_port,
    } = input;

    // NOTE: We intentionally DO NOT embed `${{ github.repository_owner }}` directly into GHCR refs
    // because GHCR requires lowercase. We'll compute owner_lc per job and build the GHCR refs from it.

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

      - name: Build backend image
        run: |
          BACKEND_GHCR="ghcr.io/\${{ steps.vars.outputs.owner_lc }}/\${{ env.BACKEND_IMAGE_NAME }}"
          echo "BACKEND_GHCR=$BACKEND_GHCR" >> $GITHUB_ENV
          docker build -f ${backend_dockerfile} -t "$BACKEND_GHCR:\${{ github.sha }}" -t "$BACKEND_GHCR:latest" ${backend_context}

      - name: Push backend image to GHCR
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

      - name: Build frontend image
        run: |
          FRONTEND_GHCR="ghcr.io/\${{ steps.vars.outputs.owner_lc }}/\${{ env.FRONTEND_IMAGE_NAME }}"
          echo "FRONTEND_GHCR=$FRONTEND_GHCR" >> $GITHUB_ENV
          docker build -f ${frontend_dockerfile} -t "$FRONTEND_GHCR:\${{ github.sha }}" -t "$FRONTEND_GHCR:latest" ${frontend_context}

      - name: Push frontend image to GHCR
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
        run: |
          AR_HOST="\${{ env.GCP_REGION }}-docker.pkg.dev"
          BACKEND_AR_IMAGE="$AR_HOST/\${{ env.GCP_PROJECT_ID }}/\${{ env.BACKEND_AR_REPO }}/\${{ env.BACKEND_IMAGE_NAME }}"
          echo "AR_HOST=$AR_HOST" >> $GITHUB_OUTPUT
          echo "BACKEND_AR_IMAGE=$BACKEND_AR_IMAGE" >> $GITHUB_OUTPUT

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker "\${{ steps.ar.outputs.AR_HOST }}" --quiet

      - name: Pull backend image from GHCR
        run: |
          BACKEND_GHCR="ghcr.io/\${{ steps.vars.outputs.owner_lc }}/\${{ env.BACKEND_IMAGE_NAME }}"
          echo "BACKEND_GHCR=$BACKEND_GHCR" >> $GITHUB_ENV
          echo "\${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "\${{ github.actor }}" --password-stdin
          docker pull "$BACKEND_GHCR:\${{ github.sha }}"

      - name: Tag & push backend image to Artifact Registry
        run: |
          docker tag "$BACKEND_GHCR:\${{ github.sha }}" "\${{ steps.ar.outputs.BACKEND_AR_IMAGE }}:\${{ github.sha }}"
          docker push "\${{ steps.ar.outputs.BACKEND_AR_IMAGE }}:\${{ github.sha }}"

      - name: Deploy backend to Cloud Run
        run: |
          gcloud run deploy "\${{ env.BACKEND_SERVICE }}" \
            --image "\${{ steps.ar.outputs.BACKEND_AR_IMAGE }}:\${{ github.sha }}" \
            --region "\${{ env.GCP_REGION }}" \
            --platform managed \
            --allow-unauthenticated \
            --port ${backend_port}

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
        run: |
          AR_HOST="\${{ env.GCP_REGION }}-docker.pkg.dev"
          FRONTEND_AR_IMAGE="$AR_HOST/\${{ env.GCP_PROJECT_ID }}/\${{ env.FRONTEND_AR_REPO }}/\${{ env.FRONTEND_IMAGE_NAME }}"
          echo "AR_HOST=$AR_HOST" >> $GITHUB_OUTPUT
          echo "FRONTEND_AR_IMAGE=$FRONTEND_AR_IMAGE" >> $GITHUB_OUTPUT

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker "\${{ steps.ar.outputs.AR_HOST }}" --quiet

      - name: Pull frontend image from GHCR
        run: |
          FRONTEND_GHCR="ghcr.io/\${{ steps.vars.outputs.owner_lc }}/\${{ env.FRONTEND_IMAGE_NAME }}"
          echo "FRONTEND_GHCR=$FRONTEND_GHCR" >> $GITHUB_ENV
          echo "\${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u "\${{ github.actor }}" --password-stdin
          docker pull "$FRONTEND_GHCR:\${{ github.sha }}"

      - name: Tag & push frontend image to Artifact Registry
        run: |
          docker tag "$FRONTEND_GHCR:\${{ github.sha }}" "\${{ steps.ar.outputs.FRONTEND_AR_IMAGE }}:\${{ github.sha }}"
          docker push "\${{ steps.ar.outputs.FRONTEND_AR_IMAGE }}:\${{ github.sha }}"

      - name: Deploy frontend to Cloud Run
        run: |
          gcloud run deploy "\${{ env.FRONTEND_SERVICE }}" \
            --image "\${{ steps.ar.outputs.FRONTEND_AR_IMAGE }}:\${{ github.sha }}" \
            --region "\${{ env.GCP_REGION }}" \
            --platform managed \
            --allow-unauthenticated \
            --port ${frontend_port}
`;

    return { success: true, data: { generated_yaml: yaml } };
  },
};
