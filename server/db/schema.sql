-- =========================================================
-- AutoDeploy core schema
-- =========================================================

-- ---------- Types ----------
CREATE TYPE IF NOT EXISTS deploy_status AS ENUM ('queued', 'running', 'success', 'failed', 'canceled');

-- =========================================================
--  USERS + CONNECTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL UNIQUE,
  github_username  text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connections (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     text NOT NULL,
  access_token text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS connections_user_provider_uniq
  ON connections (user_id, provider);

-- =========================================================
--  DEPLOYMENT LOGS
-- =========================================================

CREATE TABLE IF NOT EXISTS deployment_logs (
  id             bigserial PRIMARY KEY,
  user_id        uuid REFERENCES users(id),
  provider       text NOT NULL,
  repo_full_name text NOT NULL,
  environment    text NOT NULL,
  branch         text,
  commit_sha     text,
  action         text DEFAULT 'deploy',
  status         deploy_status NOT NULL DEFAULT 'queued',
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  summary        text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  parent_id      bigint REFERENCES deployment_logs(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deployment_logs_repo_env_idx
  ON deployment_logs (repo_full_name, environment, started_at DESC);

CREATE INDEX IF NOT EXISTS deployment_logs_status_idx
  ON deployment_logs (status);

-- =========================================================
--  PIPELINE VERSIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS pipeline_versions (
  id              bigserial PRIMARY KEY,
  user_id         uuid REFERENCES users(id),
  repo_full_name  text NOT NULL,
  branch          text NOT NULL,
  workflow_path   text NOT NULL,
  yaml            text NOT NULL,
  yaml_hash       text NOT NULL,
  source          text NOT NULL DEFAULT 'pipeline_commit',
  pipeline_session_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_versions_repo_branch_path_idx
  ON pipeline_versions (repo_full_name, branch, workflow_path, created_at DESC);

-- =========================================================
--  AWS CONNECTIONS + DEVICE FLOW
-- =========================================================

CREATE TABLE IF NOT EXISTS aws_connections (
  id                 bigserial PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sso_start_url      text,
  sso_region         text,
  account_id         text,
  role_to_assume     text,
  access_key         text,
  secret_key         text,
  session_token      text,
  expires_at         timestamptz,
  access_token       text,
  refresh_token      text,
  token_type         text,
  region             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS aws_connections_user_uniq
  ON aws_connections (user_id);

CREATE TABLE IF NOT EXISTS aws_device_sessions (
  id                        bigserial PRIMARY KEY,
  user_id                   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id                 text NOT NULL,
  client_secret             text NOT NULL,
  device_code               text NOT NULL,
  user_code                 text NOT NULL,
  verification_uri          text NOT NULL,
  verification_uri_complete text NOT NULL,
  expires_at                timestamptz NOT NULL,
  poll_interval             integer NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aws_device_sessions_user_expires_idx
  ON aws_device_sessions (user_id, expires_at DESC);

-- =========================================================
--  PIPELINE SESSIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS pipeline_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL,
  github_username     text NOT NULL,
  status              text NOT NULL DEFAULT 'created',
  repo_full_name      text,
  repo_id             bigint,
  repo_language       text,
  repo_visibility     text,
  repo_default_branch text,
  provider            text,
  template            text,
  workflow_path       text,
  branch              text,
  draft_yaml          text,
  final_yaml          text,
  pipeline_version_id bigint REFERENCES pipeline_versions(id),
  commit_sha          text,
  commit_url          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_sessions_user_idx
  ON pipeline_sessions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_events (
  id                  bigserial PRIMARY KEY,
  pipeline_session_id uuid NOT NULL REFERENCES pipeline_sessions(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL,
  event_type          text NOT NULL,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_events_session_idx
  ON pipeline_events (pipeline_session_id, created_at);

-- =========================================================
--  GITHUB REPOS CACHE
-- =========================================================

CREATE TABLE IF NOT EXISTS github_repos (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL,
  full_name       text NOT NULL,
  name            text NOT NULL,
  owner           text NOT NULL,
  private         boolean NOT NULL DEFAULT false,
  visibility      text,
  default_branch  text,
  language        text,
  html_url        text,
  description     text,
  archived        boolean NOT NULL DEFAULT false,
  disabled        boolean NOT NULL DEFAULT false,
  fork            boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS github_repos_user_full_name_idx
  ON github_repos (user_id, full_name);
