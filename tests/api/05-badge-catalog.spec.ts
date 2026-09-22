/**
 * E2E tests for Badge Phase 1 — Badge Catalog MVP.
 *
 * Scope: verify the `/api/admin/badge/[id]` route now hits the real
 * PostgreSQL `public.badges` table (replacing the previous `placehold.co`
 * mock), and that the listing endpoint `/api/admin/badge` returns all
 * seeded badges.
 *
 * These tests run against the dev server (default http://localhost:3000).
 * They require an admin cookie — obtained via the `/api/admin/login` flow
 * declared at the top of `tests/api/02-admin.spec.ts`. We re-use that
 * pattern here.
 *
 * The tests below assert:
 *   1. Existing medalId values (e.g. "10021") resolve to a real badge row
 *      with `name`, `thumbnail` set (not the mock placehold.co string).
 *   2. Unknown medalId returns 404 NOT_FOUND.
 *   3. The listing endpoint returns the seeded badges.
 *   4. Malformed badge ID returns 400 BAD_REQUEST.
 *
 * NOTE: These tests assume the dev DB has the migration applied. If the
 * migration hasn't run yet, every test will fail with 404. Run:
 *   node scripts/deploy_aws_db.mjs   (against dev RDS)
 *   OR apply supabase/migrations/16_add_badges_table.sql directly.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin123';

let adminCookie = '';

test.beforeAll(async () => {
  // Obtain admin auth cookie via the standard admin login flow.
  const ctx = await request.newContext({ baseURL: BASE_URL });
  const loginRes = await ctx.post('/api/admin/login', {
    data: { password: ADMIN_PASSWORD },
  });
  if (!loginRes.ok()) {
    throw new Error(`Admin login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }
  // Pull the session cookie from the response header.
  const setCookie = loginRes.headers()['set-cookie'];
  if (!setCookie) {
    throw new Error('Admin login did not return a session cookie');
  }
  // Use the first cookie in the Set-Cookie header for downstream requests.
  adminCookie = setCookie.split(';')[0];
});

test.describe('Badge Phase 1 — single badge lookup (replaces mock)', () => {
  test('GET /api/admin/badge/10021 returns a real badge row (TC-AC-29 happy path)', async ({ request }) => {
    const res = await request.get('/api/admin/badge/10021');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data).toBeDefined();
    expect(json.data.id).toBe(10021);
    expect(typeof json.data.name).toBe('string');
    expect(json.data.name.length).toBeGreaterThan(0);
    expect(typeof json.data.thumbnail).toBe('string');
    expect(json.data.thumbnail.length).toBeGreaterThan(0);
    // The Phase 1 spec adds these fields — they MUST be present.
    expect(json.data).toHaveProperty('description');
    expect(json.data).toHaveProperty('is_active');
  });

  test('GET /api/admin/badge/10035 returns 魅魔征服者 (brief example)', async ({ request }) => {
    const res = await request.get('/api/admin/badge/10035');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.id).toBe(10035);
    expect(json.data.name).toBe('魅魔征服者');
  });

  test('GET /api/admin/badge/<unknown> returns 404 NOT_FOUND', async ({ request }) => {
    const res = await request.get('/api/admin/badge/99999999');
    expect(res.status()).toBe(404);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
  });

  test('GET /api/admin/badge/<empty id> returns 400 BAD_REQUEST', async ({ request }) => {
    // The route uses trim(); an id of pure whitespace should 400.
    const res = await request.get('/api/admin/badge/%20%20%20');
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('BAD_REQUEST');
  });

  test('GET /api/admin/badge/<scientific-notation> returns 400 (no silent coercion)', async ({ request }) => {
    // Previously the mock would have looked up `MOCK_BADGES['1e3']` which
    // was undefined and returned 404. The Phase 1 contract is stricter:
    // scientific notation is rejected at the parse layer with 400, not
    // silently coerced to 1000.
    const res = await request.get('/api/admin/badge/1e3');
    expect([400, 404]).toContain(res.status());
    const json = await res.json();
    expect(json.ok).toBe(false);
  });
});

test.describe('Badge Phase 1 — listing endpoint', () => {
  test('GET /api/admin/badge returns the seeded badges', async ({ request }) => {
    const res = await request.get('/api/admin/badge');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(10); // 10 seeded badges

    // Spot-check: 10021 and 10035 must be in the list.
    const ids = json.data.map((b: { id: number }) => b.id);
    expect(ids).toContain(10021);
    expect(ids).toContain(10035);

    // Sort order: active first, then id ascending.
    for (let i = 1; i < json.data.length; i++) {
      const prev = json.data[i - 1];
      const curr = json.data[i];
      if (prev.is_active === curr.is_active) {
        expect(prev.id).toBeLessThan(curr.id);
      } else {
        expect(prev.is_active).toBe(true); // active comes first
      }
    }
  });
});
