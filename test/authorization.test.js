import test from 'node:test';
import assert from 'node:assert/strict';

import { isPro, Actions, can } from '../server/lib/authorization.js';

// These tests exercise the pro/free gating logic that now controls
// Workflow Copilot mode (user vs pro) and RAG access.

test('isPro returns false for free users by default', () => {
  const user = { plan: 'free', beta_pro_granted: false };
  assert.equal(isPro(user), false);
});

test('isPro returns true for explicit pro plan', () => {
  const user = { plan: 'pro', beta_pro_granted: false };
  assert.equal(isPro(user), true);
});

test('isPro returns true when beta_pro_granted is set', () => {
  const user = { plan: 'free', beta_pro_granted: true };
  assert.equal(isPro(user), true);
});

test('can(USE_AGENT) matches pro gating', () => {
  const proUser = { plan: 'pro', beta_pro_granted: false, role: 'USER' };
  const freeUser = { plan: 'free', beta_pro_granted: false, role: 'USER' };

  assert.equal(can(proUser, Actions.USE_AGENT), true);
  assert.equal(can(freeUser, Actions.USE_AGENT), false);
});

test('can(USE_MCP_TOOL) is allowed for any authenticated user', () => {
  const proUser = { plan: 'pro', beta_pro_granted: false, role: 'USER' };
  const freeUser = { plan: 'free', beta_pro_granted: false, role: 'USER' };

  assert.equal(can(proUser, Actions.USE_MCP_TOOL), true);
  assert.equal(can(freeUser, Actions.USE_MCP_TOOL), true);
});