import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import { pipeline_generator } from '../tools/pipeline_generator.js';

async function generate({ template }) {
  const res = await pipeline_generator.handler({
    repo: 'owner/repo',
    branch: 'main',
    provider: 'aws',
    template,
    stages: ['build', 'test', 'deploy'],
    options: {
      nodeVersion: '20',
      installCmd: 'npm ci',
      testCmd: 'npm test',
      buildCmd: 'npm run build',
      awsRegion: 'us-east-1',
      awsSessionName: 'autodeploy',
      awsRoleArn: 'arn:aws:iam::123456789012:role/test-role',
    },
  });

  assert.equal(res?.success, true, 'pipeline_generator should succeed');
  const generated = res.data?.generated_yaml || res.generated_yaml;
  assert.ok(generated && typeof generated === 'string', 'generated_yaml should be a string');
  return generated;
}

function assertParses(label, yamlText) {
  try {
    yaml.load(yamlText);
  } catch (err) {
    throw new Error(`${label} YAML failed to parse: ${err.message}`);
  }
}

// Basic shape tests for the main templates we use in the wizard.

test('pipeline_generator produces valid YAML for node_app', async () => {
  const y = await generate({ template: 'node_app' });
  assertParses('node_app', y);
});

test('pipeline_generator produces valid YAML for python_app', async () => {
  const y = await generate({ template: 'python_app' });
  assertParses('python_app', y);
});

// Keep this lightweight; if we add more templates, we can extend the
// matrix or move to table-driven tests.
