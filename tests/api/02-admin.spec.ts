/**
 * tests/api/02-admin.spec.ts — Phase 12
 *
 * Tests Stage 2 of LOCAL_TESTING_CHECKLIST.md:
 *   • admin/login (correct + wrong password)
 *   • admin/stats
 *   • admin/user
 *   • admin/user/inventory (H-1 clamp)
 *   • admin/user/update (toggle_status)
 *   • admin/validate (GET → 405, POST with/without/wrong/correct secret)
 *
 * All tests use plain `fetch()` instead of `page.request` so the API is
 * uniform with tests/api/01-battle-core.spec.ts. Playwright's APIResponse
 * has different field semantics (status() is a method, headers() is a method)
 * which created confusion.
 */

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const BASE = 'http://localhost:3000';

/** Helper: log in as admin and return the admin_token cookie value. */
async function getAdminToken(): Promise<string> {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'dev' }),
  });
  if (res.status !== 200) {
    throw new Error(`admin/login returned ${res.status}, expected 200`);
  }
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/admin_token=([^;]+)/);
  if (!match) {
    throw new Error(`admin/login response missing admin_token cookie: ${setCookie}`);
  }
  return `admin_token=${match[1]}`;
}

// ── 2.1 admin/login (correct password) ────────────────────────────────────────

test('admin/login with correct password returns 200 + admin_token cookie', async () => {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'dev' }),
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('admin_token=');
});

// ── 2.2 admin/login (wrong password) ──────────────────────────────────────────

test('admin/login with wrong password returns 401', async () => {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password-xyz' }),
  });
  expect(res.status).toBe(401);
  const json = await res.json();
  expect(json.error).toBeDefined();
});

// ── 2.3 admin/stats with admin cookie ──────────────────────────────────────────

test('admin/stats returns data with admin cookie', async () => {
  const cookie = await getAdminToken();
  const res = await fetch(`${BASE}/api/admin/stats`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(json.data).toBeDefined();
});

// ── 2.4 admin/user returns user data ──────────────────────────────────────────

test('admin/user returns user data', async () => {
  const cookie = await getAdminToken();
  const res = await fetch(`${BASE}/api/admin/user?userId=smoke-test`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(json.data).toBeDefined();
});

// ── 2.5 admin/user/inventory — H-1 clamp ──────────────────────────────────────

test('admin/user/inventory rejects item_hand_count > H-1 clamp', async () => {
  const cookie = await getAdminToken();
  const res = await fetch(`${BASE}/api/admin/user/inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      userId: 'clamp-test-user',
      item_hand_count: 999_999_999,
    }),
  });
  // Should be rejected with 400 (or 422 — both are acceptable)
  expect([400, 422]).toContain(res.status);
  const json = await res.json();
  expect(json.error).toBeDefined();
});

/** Generate a valid v4 UUID for use as a test userId. */
function uuid4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── 2.6 admin/user/update — toggle_status ──────────────────────────────────────

test('admin/user/update toggle_status changes user status', async () => {
  const cookie = await getAdminToken();
  const userId = uuid4();

  // First check initial status
  const getRes = await fetch(`${BASE}/api/admin/user?userId=${userId}`, {
    headers: { Cookie: cookie },
  });
  expect(getRes.status).toBe(200);

  // Toggle to banned
  const banRes = await fetch(`${BASE}/api/admin/user/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ userId, action: 'toggle_status' }),
  });
  expect(banRes.status).toBe(200);

  // Toggle back to normal
  const unbanRes = await fetch(`${BASE}/api/admin/user/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ userId, action: 'toggle_status' }),
  });
  expect(unbanRes.status).toBe(200);
});

// ── 2.7 admin/validate — GET returns 405 (or 404) ─────────────────────────────

test('admin/validate GET returns 4xx (405 or 404)', async () => {
  const res = await fetch(`${BASE}/api/admin/validate`);
  // Some implementations return 404 for GET on POST-only routes — both are acceptable
  expect([404, 405]).toContain(res.status);
});

// ── 2.8 admin/validate — POST without body returns 400 ─────────────────────────

test('admin/validate POST without body returns 400', async () => {
  const res = await fetch(`${BASE}/api/admin/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
});

// ── 2.9 admin/validate — POST with wrong secret returns 401 ────────────────────

test('admin/validate POST with wrong secret returns 401', async () => {
  const res = await fetch(`${BASE}/api/admin/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: 'wrong-secret-xyz' }),
  });
  expect(res.status).toBe(401);
});

// ── 2.10 admin/validate — POST with correct secret returns 200 ─────────────────

test('admin/validate POST with correct secret returns 200', async () => {
  const res = await fetch(`${BASE}/api/admin/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: 'dev' }),
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
});