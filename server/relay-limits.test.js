import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from './relay-limits.js';
test('limiter expires windows and fails closed at bounded key capacity', () => {
  let now = 0;
  const limit = createLimiter({ maxKeys: 1, windowMs: 1000, now: () => now });
  assert.equal(limit('a', 1), 0);
  assert.equal(limit('a', 1), 1);
  assert.equal(limit('b', 1), 1);
  now = 1001;
  assert.equal(limit('b', 1), 0);
  assert.equal(limit('a', 1), 1);
});
