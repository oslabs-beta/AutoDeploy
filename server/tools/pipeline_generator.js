import { github_adapter } from './github_adapter.js';

import { pool } from '../db.js';

import jwt from 'jsonwebtoken';

import { z } from 'zod';

export const pipeline_generator = {
  name: 'pipeline_generator',
  description:
    'Generate a mock CI/CD YAML configuration for a given repository and provider.',

  // ✅ Input schema for validation
  input_schema: z.object({
    repo: z.string(),
    branch: z.string().default('main'),
    provider: z.enum(['aws', 'jenkins']).optional().default('aws'),
    template: z.enum(['node_app', 'python_app', 'container_service']),
    options: z
      .object({
        run_tests: z.boolean().default(true),
        include_trivy_scan: z.boolean().default(false),
        artifact_name: z.string().optional(),
      })
      .optional(),
  }),

  // Real handler (queries github_adapter for repo info and generates pipeline config)
  handler: async ({ repo, branch = 'main', provider = 'aws', template, options }) => {
    const sessionToken = process.env.MCP_SESSION_TOKEN;
    let decoded = {};
    let userId = null;

    // No req.cookies available in MCP tool mode — skip direct session lookups.
    console.warn('⚠️ Skipping requireSession — tool is running without HTTP request context.');

    // Fallback: decode MCP_SESSION_TOKEN if no user found
    if (!userId && sessionToken) {
      try {
        decoded = jwt.decode(sessionToken);
        userId = decoded?.user?.id || decoded?.sub || null;
        if (userId)
          console.log('🧠 Resolved user_id from decoded token:', userId);
      } catch (err) {
        console.warn('⚠️ Could not decode MCP_SESSION_TOKEN:', err.message);
      }
    }

    if (!userId) {
      console.warn('⚠️ Could not resolve user_id — defaulting to anonymous.');
      userId = '00000000-0000-0000-0000-000000000000';
    }

    // 🧠 Try to resolve user_id from GitHub username if still anonymous
    if (userId === '00000000-0000-0000-0000-000000000000') {
      let githubUsername =
        decoded?.github_username || process.env.GITHUB_USERNAME || null;

      if (githubUsername) {
        try {
          const { rows: userRows } = await pool.query(
            `SELECT id FROM users WHERE github_username = $1 LIMIT 1`,
            [githubUsername]
          );

          if (userRows.length > 0) {
            userId = userRows[0].id;
            console.log('🔄 Resolved user_id from github_username:', userId);
          } else {
            console.warn(
              '⚠️ No user found in DB matching github_username:',
              githubUsername
            );
          }
        } catch (err) {
          console.warn(
            '⚠️ Failed to resolve user_id from github_username:',
            err.message
          );
        }
      } else {
        console.warn('⚠️ No GitHub username available to resolve user_id.');
      }
    }

    // Try DB lookup for GitHub token first
    let githubToken = null;
    try {
      const { rows } = await pool.query(
        `SELECT access_token 
         FROM connections 
         WHERE user_id = $1 
         AND provider = 'github' 
         LIMIT 1`,
        [userId]
      );

      if (rows.length > 0 && rows[0].access_token) {
        githubToken = rows[0].access_token;
        console.log('🗝️ GitHub token retrieved from DB for user:', userId);
      } else {
        console.warn('⚠️ No GitHub access token found for user:', userId);
      }
    } catch (dbErr) {
      console.warn('⚠️ DB lookup failed:', dbErr.message);
    }

    if (!githubToken) {
      githubToken =
        process.env.GITHUB_ACCESS_TOKEN ||
        decoded?.github_token ||
        (globalThis.MCP_SESSION?.github_token ?? null);
    }

    console.log(
      '🪶 Using GitHub token from source:',
      githubToken ? 'available' : 'missing'
    );

    if (!githubToken) {
      return {
        success: false,
        error: 'No GitHub access token found for this user.',
      };
    }

    // ✅ Normalize repo path to include username/repo format
    if (!repo.includes('/')) {
      let githubUsername =
        decoded?.github_username || process.env.GITHUB_USERNAME;
      if (!githubUsername) {
        try {
          const { rows: userRows } = await pool.query(
            `SELECT github_username FROM users WHERE id = $1 LIMIT 1`,
            [userId]
          );
          if (userRows.length > 0) {
            githubUsername = userRows[0].github_username;
            console.log(
              '🧠 Retrieved GitHub username from DB:',
              githubUsername
            );
          } else {
            console.warn('⚠️ No GitHub username found in DB for user:', userId);
          }
        } catch (dbErr) {
          console.warn(
            '⚠️ Failed to query DB for GitHub username:',
            dbErr.message
          );
        }
      }

      if (githubUsername) {
        repo = `${githubUsername}/${repo}`;
        console.log('🧩 Normalized repo path:', repo);
      } else {
        console.warn(
          '⚠️ Cannot normalize repo path: no GitHub username found.'
        );
      }
    }

    // Attach token when fetching repo info
    let repoInfo;
    try {
      repoInfo = await github_adapter.handler({
        action: 'get_repo',
        user_id: userId,
        repo,
        token: githubToken,
      });
    } catch (err) {
      console.warn('⚠️ GitHub API fetch failed:', err.message);
      repoInfo = null;
    }

    // ✅ Normalize GitHub adapter return structure
    if (repoInfo?.data) {
      repoInfo = repoInfo.data;
    }

    // If repo info failed, try fallback to github_adapter info or mock data
    if (!repoInfo) {
      console.warn(
        `⚠️ Could not retrieve repository information for ${repo}, attempting fallback...`
      );
      try {
        repoInfo = await github_adapter.handler({
          action: 'info',
          user_id: userId,
          repo,
          token: githubToken,
        });
        console.log('🧠 Fallback repo info retrieved successfully.');
      } catch (fallbackErr) {
        console.warn(
          '⚠️ Fallback GitHub info retrieval failed:',
          fallbackErr.message
        );
      }
    }

    // Final safeguard: if still missing, create mock repo info to continue pipeline generation
    if (!repoInfo) {
      console.warn(
        '⚠️ Both primary and fallback repo info unavailable — using minimal mock data.'
      );
      repoInfo = {
        language: 'JavaScript',
        visibility: 'public',
        default_branch: branch,
      };
    }

    // Determine defaults dynamically
    const language = repoInfo.language || 'JavaScript';
    const inferredTemplate = language.toLowerCase().includes('python')
      ? 'python_app'
      : 'node_app';

    const inferredProvider =
      repoInfo.visibility === 'private' ? 'jenkins' : 'aws';

    const selectedProvider = provider || inferredProvider;
    const selectedTemplate = template || inferredTemplate;

    const pipelineName = `${selectedProvider}-${selectedTemplate}-ci.yml`;

    const generated_yaml = `
name: CI/CD Pipeline for ${repo}
on:
  push:
    branches:
      - ${branch}
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup ${selectedTemplate === 'node_app' ? 'Node.js' : 'Python'}
        uses: actions/setup-${
          selectedTemplate === 'node_app' ? 'node' : 'python'
        }@v4
      - name: Install Dependencies
        run: ${
          selectedTemplate === 'node_app'
            ? 'npm ci'
            : 'pip install -r requirements.txt'
        }
      - name: Run Tests
        run: ${selectedTemplate === 'node_app' ? 'npm test' : 'pytest'}
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Configure ${selectedProvider.toUpperCase()}
        run: echo "Configuring ${selectedProvider.toUpperCase()} OIDC..."
      - name: Deploy Application
        run: echo "Deploying ${repo} to ${selectedProvider.toUpperCase()}..."
`;

    return {
      success: true,
      data: {
        pipeline_name: pipelineName,
        repo,
        branch,
        provider: selectedProvider,
        template: selectedTemplate,
        options: options || {},
        stages: ['build', 'test', 'deploy'],
        generated_yaml,
        repo_info: repoInfo,
        created_at: new Date().toISOString(),
      },
    };
  },
};
