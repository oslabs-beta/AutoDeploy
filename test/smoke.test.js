import assert from 'node:assert/strict';
assert.equal(1 + 1, 2, 'Math still works');
import '../server/server.js';
console.log('✅ smoke test passed');
