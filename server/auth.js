import crypto from 'node:crypto';

const stateStore = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

export function createState(redirectTo = '/') {
  const state = crypto.randomBytes(16).toString('hex');
  stateStore.set(state, { createdAt: Date.now(), redirectTo });
  return state;
}

export function consumeState(state) {
  const item = stateStore.get(state);
  if (!item) return null;
  stateStore.delete(state);
  if (Date.now() - item.createdAt > STATE_TTL_MS) return null;
  return item;
}
