/**
 * tests/unit/internal-auth.test.mjs
 *
 * Pure-Node unit tests for lib/internalAuth.ts — does NOT require a running
 * dev server. Run with:
 *
 *   node tests/unit/internal-auth.test.mjs
 *
 * Verifies:
 *   1. parseInternalTokenHeader accepts the canonical `${ts}.${nonce}.${sig}` shape
 *   2. parseInternalTokenHeader rejects malformed headers
 *   3. verifyInternalTokenAsync accepts a correctly signed token
 *   4. verifyInternalTokenAsync rejects a wrong-key signature
 *   5. verifyInternalTokenAsync rejects a stale timestamp (>5 min)
 *   6. verifyInternalTokenAsync rejects a future timestamp (>5 min)
 *   7. isLoopbackRequest recognizes loopback callers in dev mode
 *   8. isLoopbackRequest returns false for non-loopback callers
 *   9. isLoopbackRequest returns false even for loopback in production
 *  10. getInternalKey enforces the 32-char minimum
 */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// tsx (Node + esbuild) handles the .ts import directly.
const {
  parseInternalTokenHeader,
  verifyInternalTokenAsync,
  isLoopbackRequest,
  getInternalKey,
} = await import('../../lib/internalAuth.ts');

const hex = (n) => Buffer.from(webcrypto.getRandomValues(new Uint8Array(n))).toString('hex');
const sigFor = async (key, payload) => {
  const k = await webcrypto.subtle.importKey(
    'raw', new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await webcrypto.subtle.sign('HMAC', k, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const KEY = 'a'.repeat(64); // 64-char test key
const now = Date.now();

let passed = 0, failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}\n      ${e.message}`);
    failed++;
  }
}

console.log('parseInternalTokenHeader');
await t('accepts canonical ${ts}.${nonce}.${sig}', () => {
  const sig = 'a'.repeat(64);
  const r = parseInternalTokenHeader(`${now}.${hex(8)}.${sig}`);
  assert.equal(r.timestampMs, now);
  assert.equal(r.signature, sig);
});
await t('rejects null header', () => {
  assert.equal(parseInternalTokenHeader(null), null);
});
await t('rejects header with wrong part count', () => {
  assert.equal(parseInternalTokenHeader('a.b'), null);
  assert.equal(parseInternalTokenHeader('a.b.c.d'), null);
});
await t('rejects header with bad nonce shape', () => {
  // nonce must be 8-64 hex chars; "ZZ" is not hex
  assert.equal(parseInternalTokenHeader(`${now}.ZZ.${'a'.repeat(64)}`), null);
});
await t('rejects header with bad signature length', () => {
  // sig must be exactly 64 hex chars
  assert.equal(parseInternalTokenHeader(`${now}.${hex(8)}.short`), null);
});
await t('rejects header with negative timestamp', () => {
  assert.equal(parseInternalTokenHeader(`-1.${hex(8)}.${'a'.repeat(64)}`), null);
});

console.log('\nverifyInternalTokenAsync');
await t('accepts correctly signed token', async () => {
  const ts = now;
  const nonce = hex(8);
  const sig = await sigFor(KEY, `${ts}.${nonce}`);
  const r = await verifyInternalTokenAsync({
    authHeader: `${ts}.${nonce}.${sig}`,
    internalKey: KEY,
    nowMs: now,
  });
  assert.equal(r.ok, true);
});
await t('rejects wrong-key signature', async () => {
  const ts = now;
  const nonce = hex(8);
  const sig = await sigFor('z'.repeat(64), `${ts}.${nonce}`);
  const r = await verifyInternalTokenAsync({
    authHeader: `${ts}.${nonce}.${sig}`,
    internalKey: KEY,
    nowMs: now,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'signature_mismatch');
});
await t('rejects stale timestamp (>5 min old)', async () => {
  const ts = now - 6 * 60 * 1000;
  const nonce = hex(8);
  const sig = await sigFor(KEY, `${ts}.${nonce}`);
  const r = await verifyInternalTokenAsync({
    authHeader: `${ts}.${nonce}.${sig}`,
    internalKey: KEY,
    nowMs: now,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'replay_window_exceeded');
});
await t('rejects future timestamp (>5 min ahead)', async () => {
  const ts = now + 6 * 60 * 1000;
  const nonce = hex(8);
  const sig = await sigFor(KEY, `${ts}.${nonce}`);
  const r = await verifyInternalTokenAsync({
    authHeader: `${ts}.${nonce}.${sig}`,
    internalKey: KEY,
    nowMs: now,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'replay_window_exceeded');
});
await t('rejects tampered nonce', async () => {
  const ts = now;
  const nonce1 = hex(8);
  const nonce2 = hex(8);
  // Sign with nonce1 but send nonce2
  const sig = await sigFor(KEY, `${ts}.${nonce1}`);
  const r = await verifyInternalTokenAsync({
    authHeader: `${ts}.${nonce2}.${sig}`,
    internalKey: KEY,
    nowMs: now,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'signature_mismatch');
});

console.log('\nisLoopbackRequest');
const fakeReq = ({ url, headers = {}, env }) => {
  process.env.NODE_ENV = env;
  return { url, headers: { get: (k) => headers[k.toLowerCase()] ?? null } };
};

await t('dev mode + localhost URL = loopback', () => {
  const r = isLoopbackRequest(fakeReq({
    url: 'http://localhost:3000/api/internal/startup',
    headers: {},
    env: 'development',
  }));
  assert.equal(r, true);
});
await t('dev mode + x-forwarded-for 127.0.0.1 = loopback', () => {
  const r = isLoopbackRequest(fakeReq({
    url: 'http://example.com/api/internal/startup',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    env: 'development',
  }));
  assert.equal(r, true);
});
await t('dev mode + remote IP = NOT loopback', () => {
  const r = isLoopbackRequest(fakeReq({
    url: 'http://example.com/api/internal/startup',
    headers: { 'x-forwarded-for': '203.0.113.42' },
    env: 'development',
  }));
  assert.equal(r, false);
});
await t('production mode + localhost URL = NOT loopback (bypass disabled)', () => {
  const r = isLoopbackRequest(fakeReq({
    url: 'http://localhost:3000/api/internal/startup',
    headers: {},
    env: 'production',
  }));
  assert.equal(r, false);
});
await t('production mode + 127.0.0.1 XFF = NOT loopback', () => {
  const r = isLoopbackRequest(fakeReq({
    url: 'http://example.com/api/internal/startup',
    headers: { 'x-forwarded-for': '127.0.0.1' },
    env: 'production',
  }));
  assert.equal(r, false);
});

console.log('\ngetInternalKey');
await t('returns null when env var missing', () => {
  const oldKey = process.env.INTERNAL_STARTUP_KEY;
  delete process.env.INTERNAL_STARTUP_KEY;
  try {
    assert.equal(getInternalKey(), null);
  } finally {
    process.env.INTERNAL_STARTUP_KEY = oldKey;
  }
});
await t('returns null when env var shorter than 32 chars', () => {
  const oldKey = process.env.INTERNAL_STARTUP_KEY;
  process.env.INTERNAL_STARTUP_KEY = 'short';
  try {
    assert.equal(getInternalKey(), null);
  } finally {
    process.env.INTERNAL_STARTUP_KEY = oldKey;
  }
});
await t('returns key when env var meets minimum length', () => {
  const oldKey = process.env.INTERNAL_STARTUP_KEY;
  process.env.INTERNAL_STARTUP_KEY = 'x'.repeat(32);
  try {
    assert.equal(getInternalKey(), 'x'.repeat(32));
  } finally {
    process.env.INTERNAL_STARTUP_KEY = oldKey;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);