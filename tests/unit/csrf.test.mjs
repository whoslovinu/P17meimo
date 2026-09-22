/**
 * tests/unit/csrf.test.mjs — unit tests for lib/csrf.ts isOriginAllowed().
 *
 * Run with:  npx tsx tests/unit/csrf.test.mjs
 *
 * These exercise the CSRF Origin/Referer gate as a pure function, without
 * booting the Edge runtime. The middleware imports the same function, so
 * green here == green in production.
 */

import assert from 'node:assert';
import { isOriginAllowed } from '../../lib/csrf.ts';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`      ${err.message}`);
    failed++;
  }
}

/** Build a minimal request-like object. */
function req({ method = 'POST', url = 'http://localhost:3000/api/admin/user/update', origin, referer } = {}) {
  const headers = new Map();
  if (origin !== undefined) headers.set('origin', origin);
  if (referer !== undefined) headers.set('referer', referer);
  return {
    method,
    url,
    headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
  };
}

const PROD = { nodeEnv: 'production', trustedOrigins: '' };
const DEV = { nodeEnv: 'development', trustedOrigins: '' };

console.log('\nisOriginAllowed — read-only methods');

test('GET is always allowed (prod, no origin)', () => {
  assert.strictEqual(isOriginAllowed(req({ method: 'GET' }), PROD), true);
});

test('HEAD is always allowed (prod, no origin)', () => {
  assert.strictEqual(isOriginAllowed(req({ method: 'HEAD' }), PROD), true);
});

test('OPTIONS is always allowed (prod, no origin)', () => {
  assert.strictEqual(isOriginAllowed(req({ method: 'OPTIONS' }), PROD), true);
});

console.log('\nisOriginAllowed — same-origin POST');

test('POST with matching Origin is allowed', () => {
  assert.strictEqual(
    isOriginAllowed(req({ origin: 'http://localhost:3000' }), PROD),
    true
  );
});

test('POST with matching Referer is allowed', () => {
  assert.strictEqual(
    isOriginAllowed(req({ referer: 'http://localhost:3000/admin/users' }), PROD),
    true
  );
});

console.log('\nisOriginAllowed — cross-origin POST (attack)');

test('POST with foreign Origin is REJECTED (prod)', () => {
  assert.strictEqual(
    isOriginAllowed(req({ origin: 'https://evil.example.com' }), PROD),
    false
  );
});

test('POST with foreign Origin is REJECTED (dev too)', () => {
  assert.strictEqual(
    isOriginAllowed(req({ origin: 'https://evil.example.com' }), DEV),
    false
  );
});

test('POST with foreign Referer is REJECTED', () => {
  assert.strictEqual(
    isOriginAllowed(req({ referer: 'https://evil.example.com/x' }), PROD),
    false
  );
});

console.log('\nisOriginAllowed — allow-list');

test('POST with allow-listed Origin is allowed', () => {
  assert.strictEqual(
    isOriginAllowed(req({ origin: 'https://admin.example.com' }), {
      nodeEnv: 'production',
      trustedOrigins: 'https://admin.example.com',
    }),
    true
  );
});

test('POST with Origin not in allow-list is rejected', () => {
  assert.strictEqual(
    isOriginAllowed(req({ origin: 'https://other.example.com' }), {
      nodeEnv: 'production',
      trustedOrigins: 'https://admin.example.com',
    }),
    false
  );
});

console.log('\nisOriginAllowed — missing Origin AND Referer');

test('PROD: no Origin, no Referer POST is REJECTED (forgery signal)', () => {
  assert.strictEqual(isOriginAllowed(req({}), PROD), false);
});

test('DEV: no Origin, no Referer POST is ALLOWED (node fetch)', () => {
  assert.strictEqual(isOriginAllowed(req({}), DEV), true);
});

console.log('\nisOriginAllowed — malformed input');

test('malformed request URL is rejected', () => {
  assert.strictEqual(
    isOriginAllowed({ method: 'POST', url: 'not-a-url', headers: { get: () => null } }, PROD),
    false
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
