import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseCacheHeaders } from './release-headers.js';

function runMiddleware({ method = 'GET', path = '/' } = {}) {
  const headers = {};
  let nextCalled = false;
  releaseCacheHeaders({ method, path }, { setHeader: (name, value) => { headers[name] = value; } }, () => { nextCalled = true; });
  return { headers, nextCalled };
}

test('service worker responses must revalidate', () => {
  const { headers, nextCalled } = runMiddleware({ path: '/sw.js' });
  assert.equal(headers['Cache-Control'], 'no-cache');
  assert.equal(nextCalled, true);
});

test('version manifest responses must not be stored', () => {
  const { headers } = runMiddleware({ path: '/version.json' });
  assert.equal(headers['Cache-Control'], 'no-store');
});

test('other requests are untouched but still pass through', () => {
  const { headers, nextCalled } = runMiddleware({ path: '/assets/index.js' });
  assert.equal(headers['Cache-Control'], undefined);
  assert.equal(nextCalled, true);
});

test('non-GET requests get no cache header', () => {
  const { headers } = runMiddleware({ method: 'POST', path: '/sw.js' });
  assert.equal(headers['Cache-Control'], undefined);
});

test('HEAD requests get the same revalidation header as GET', () => {
  const { headers } = runMiddleware({ method: 'HEAD', path: '/sw.js' });
  assert.equal(headers['Cache-Control'], 'no-cache');
});

test('HEAD version manifest is not stored either', () => {
  const { headers } = runMiddleware({ method: 'HEAD', path: '/version.json' });
  assert.equal(headers['Cache-Control'], 'no-store');
});
