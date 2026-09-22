/**
 * E2E tests for Badge Phase 2 — Admin CRUD surface.
 *
 * REPARK Phase 2 (2026-09-02):
 *   - POST   /api/admin/badge              create
 *   - PUT    /api/admin/badge/[id]         update
 *   - POST   /api/admin/badge/[id]/activate
 *   - POST   /api/admin/badge/[id]/deactivate
 *
 * Coverage:
 *   - create → list shows it
 *   - update → readback reflects changes
 *   - deactivate → GET /[id] returns 404 (Phase 1 GET filters is_active=true)
 *   - activate → GET /[id] returns 200 again
 *   - name uniqueness conflict (409)
 *   - field validation (400)
 *   - malformed id (400)
 *   - auth failure (401)
 *
 * Assumes the dev DB has migration 16_add_badges_table.sql applied (Phase 1).
 * Admin password is `admin123` (same as Phase 1 spec).
 *
 * NOTE: Each test uses a unique name with a timestamp suffix so reruns don't
 * collide with prior runs or with seeded badges.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL       = process.env.BASE_URL ?? 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'admin123';

// Single shared admin cookie — set in beforeAll, reused by every test.
let adminCookie = '';
let authedCtx: Awaited<ReturnType<typeof request.newContext>>;

test.beforeAll(async () => {
  authedCtx = await request.newContext({ baseURL: BASE_URL });
  const loginRes = await authedCtx.post('/api/admin/login', {
    data: { password: ADMIN_PASSWORD },
  });
  if (!loginRes.ok()) {
    throw new Error(`Admin login failed: ${loginRes.status()} ${await loginRes.text()}`);
  }
  const setCookie = loginRes.headers()['set-cookie'];
  if (!setCookie) {
    throw new Error('Admin login did not return a session cookie');
  }
  adminCookie = setCookie.split(';')[0];
});

test.afterAll(async () => {
  await authedCtx?.dispose();
});

// Small helper: build a unique name suffix so reruns don't clash.
const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const PLACEHOLDER_IMG = 'https://placehold.co/100x100/orange/white?text=P2';

test.describe('Badge Phase 2 — create (POST)', () => {
  test('happy path: creates a badge and returns 201 with assigned id', async () => {
    const name = `测试勋章-${suffix()}`;
    const res = await authedCtx.post('/api/admin/badge', {
      data: { name, thumbnail: PLACEHOLDER_IMG, description: 'created by e2e' },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data).toBeDefined();
    expect(typeof json.data.id).toBe('number');
    expect(json.data.id).toBeGreaterThan(0);
    expect(json.data.name).toBe(name);
    expect(json.data.thumbnail).toBe(PLACEHOLDER_IMG);
    expect(json.data.description).toBe('created by e2e');
    expect(json.data.is_active).toBe(true);
  });

  test('400: missing name', async () => {
    const res = await authedCtx.post('/api/admin/badge', {
      data: { thumbnail: PLACEHOLDER_IMG },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('BAD_REQUEST');
  });

  test('400: missing thumbnail', async () => {
    const res = await authedCtx.post('/api/admin/badge', {
      data: { name: `无名-${suffix()}` },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('BAD_REQUEST');
  });

  test('400: invalid thumbnail URL', async () => {
    const res = await authedCtx.post('/api/admin/badge', {
      data: { name: `bad-thumb-${suffix()}`, thumbnail: 'not-a-url' },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('BAD_REQUEST');
  });

  test('400: name too long (>40)', async () => {
    const res = await authedCtx.post('/api/admin/badge', {
      data: { name: 'x'.repeat(50), thumbnail: PLACEHOLDER_IMG },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('BAD_REQUEST');
  });

  test('409: duplicate name against active badge', async () => {
    // 10021 '初级挑战者' is seeded and active.
    const res = await authedCtx.post('/api/admin/badge', {
      data: { name: '初级挑战者', thumbnail: PLACEHOLDER_IMG },
    });
    expect(res.status()).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe('CONFLICT');
  });
});

test.describe('Badge Phase 2 — update (PUT)', () => {
  let createdId = 0;
  let createdName = '';

  test.beforeAll(async () => {
    const name = `PUT-target-${suffix()}`;
    const res = await authedCtx.post('/api/admin/badge', {
      data: { name, thumbnail: PLACEHOLDER_IMG, description: 'before' },
    });
    const json = await res.json();
    createdId   = json.data.id;
    createdName = json.data.name;
  });

  test('updates name + description', async () => {
    const newName = `${createdName}-edited`;
    const res = await authedCtx.put(`/api/admin/badge/${createdId}`, {
      data: { name: newName, description: 'after' },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.id).toBe(createdId);
    expect(json.data.name).toBe(newName);
    expect(json.data.description).toBe('after');
    // Untouched fields preserved.
    expect(json.data.thumbnail).toBe(PLACEHOLDER_IMG);
    expect(json.data.is_active).toBe(true);
    createdName = newName;
  });

  test('400: rejects attempt to change immutable id field', async () => {
    const res = await authedCtx.put(`/api/admin/badge/${createdId}`, {
      data: { id: 99999 },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('BAD_REQUEST');
  });

  test('404: updating a non-existent id', async () => {
    const res = await authedCtx.put('/api/admin/badge/99999999', {
      data: { name: 'ghost' },
    });
    expect(res.status()).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('NOT_FOUND');
  });

  test('400: malformed id', async () => {
    const res = await authedCtx.put('/api/admin/badge/not-a-number', {
      data: { name: 'whatever' },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('BAD_REQUEST');
  });
});

test.describe('Badge Phase 2 — activate / deactivate lifecycle', () => {
  let badgeId = 0;
  const badgeName = `lifecycle-${suffix()}`;

  test.beforeAll(async () => {
    const res = await authedCtx.post('/api/admin/badge', {
      data: { name: badgeName, thumbnail: PLACEHOLDER_IMG },
    });
    const json = await res.json();
    badgeId = json.data.id;
  });

  test('deactivate: flips is_active=false, GET /[id] returns 404 (Phase 1 contract)', async () => {
    const res = await authedCtx.post(`/api/admin/badge/${badgeId}/deactivate`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.id).toBe(badgeId);
    expect(json.data.is_active).toBe(false);

    // Phase 1 GET /[id] filters is_active=true — the deactivated badge
    // must now appear "missing" to MilestoneCard previews.
    const get = await authedCtx.get(`/api/admin/badge/${badgeId}`);
    expect(get.status()).toBe(404);
  });

  test('activate: flips is_active=true, GET /[id] returns 200 again', async () => {
    const res = await authedCtx.post(`/api/admin/badge/${badgeId}/activate`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.is_active).toBe(true);

    const get = await authedCtx.get(`/api/admin/badge/${badgeId}`);
    expect(get.status()).toBe(200);
    const getJson = await get.json();
    expect(getJson.data.id).toBe(badgeId);
    expect(getJson.data.name).toBe(badgeName);
  });

  test('deactivate 404: unknown id', async () => {
    const res = await authedCtx.post('/api/admin/badge/99999999/deactivate');
    expect(res.status()).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('NOT_FOUND');
  });

  test('activate 400: malformed id', async () => {
    const res = await authedCtx.post('/api/admin/badge/abc/activate');
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('BAD_REQUEST');
  });
});

test.describe('Badge Phase 2 — list endpoint integration', () => {
  test('GET /api/admin/badge includes a newly-created badge', async () => {
    const name = `list-include-${suffix()}`;
    const created = await authedCtx.post('/api/admin/badge', {
      data: { name, thumbnail: PLACEHOLDER_IMG },
    });
    const createdJson = await created.json();
    const newId = createdJson.data.id;

    const res = await authedCtx.get('/api/admin/badge');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    const ids = (json.data as Array<{ id: number }>).map((b) => b.id);
    expect(ids).toContain(newId);
  });
});

test.describe('Badge Phase 2 — auth failure', () => {
  test('POST without cookie returns 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const res = await ctx.post('/api/admin/badge', {
      data: { name: 'should-not-create', thumbnail: PLACEHOLDER_IMG },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('PUT without cookie returns 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const res = await ctx.put('/api/admin/badge/10021', {
      data: { name: 'should-not-update' },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('deactivate without cookie returns 401', async () => {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const res = await ctx.post('/api/admin/badge/10021/deactivate');
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
