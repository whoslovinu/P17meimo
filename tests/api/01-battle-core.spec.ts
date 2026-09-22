/**
 * tests/api/01-battle-core.spec.ts — Phase 12
 *
 * Tests the core battle loop (Stage 1 in LOCAL_TESTING_CHECKLIST.md):
 *   • game/init
 *   • boss/status
 *   • battle/init
 *   • action/attack (idempotency + rate limit)
 *   • battle/leaderboard
 *
 * All tests run against the live Next.js dev server at http://localhost:3000.
 * No auth cookie required for the public endpoints under test.
 *
 * NOTE: Primary assertions use res.status (not res.ok) because Playwright's
 * APIResponse.ok is false for non-2xx codes, which can be confusing when
 * testing error paths (401/409/429).
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

/** Generate a unique nonce so each attack is treated as fresh. */
function nonce(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── 1.1 game/init ─────────────────────────────────────────────────────────────

test('game/init returns 200 + valid activity data', async () => {
  const res = await fetch(`${BASE}/api/game/init`);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(json.data).toBeDefined();
});

// ── 1.2 boss/status ─────────────────────────────────────────────────────────────

test('boss/status returns 200 + HP data', async () => {
  const res = await fetch(`${BASE}/api/boss/status`);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  const data = json.data as Record<string, unknown>;
  expect(typeof data.currentHp).toBe('number');
  expect(typeof data.maxHp).toBe('number');
  expect((data.currentHp as number)).toBeLessThanOrEqual(data.maxHp as number);
});

// ── 1.3 battle/init ────────────────────────────────────────────────────────────

test('battle/init returns 200 + user state', async () => {
  const res = await fetch(`${BASE}/api/battle/init`, {
    headers: { Cookie: 'uid=test-smoke-user' },
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(json.data).toBeDefined();
});

// ── 1.4 attack — first attempt succeeds ────────────────────────────────────────

test('action/attack first attempt returns 200 + positive damage', async () => {
  const userId = `smoke-user-${Date.now()}`;
  const res = await fetch(`${BASE}/api/action/attack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `uid=${userId}`,
    },
    body: JSON.stringify({ item_type: 'item_hand', nonce: nonce('first') }),
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  const data = json.data as Record<string, unknown>;
  expect(typeof data.actualDamage).toBe('number');
  expect(data.actualDamage!).toBeGreaterThan(0);
});

// ── 1.5 attack — duplicate nonce returns 409 ────────────────────────────────────

test('action/attack duplicate nonce returns 409 DUPLICATE_ATTACK', async () => {
  const userId = `smoke-user-${Date.now()}`;
  const dupNonce = `dup-${Date.now()}`;

  const first = await fetch(`${BASE}/api/action/attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `uid=${userId}` },
    body: JSON.stringify({ item_type: 'item_hand', nonce: dupNonce }),
  });
  expect(first.status).toBe(200);

  const second = await fetch(`${BASE}/api/action/attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `uid=${userId}` },
    body: JSON.stringify({ item_type: 'item_hand', nonce: dupNonce }),
  });
  expect(second.status).toBe(409);
  const json = await second.json();
  expect(json.error?.code).toBe('DUPLICATE_ATTACK');
});

// ── 1.6 attack — rate limit window expires ─────────────────────────────────────

test('action/attack succeeds again after 1.2s (proves rate limit expires)', async () => {
  const userId = `smoke-user-${Date.now()}`;
  const n1 = nonce('rate1');
  const n2 = nonce('rate2');

  await fetch(`${BASE}/api/action/attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `uid=${userId}` },
    body: JSON.stringify({ item_type: 'item_hand', nonce: n1 }),
  });

  // Wait for the 1s Redis attack rate limit to expire
  await new Promise((r) => setTimeout(r, 1200));

  const res = await fetch(`${BASE}/api/action/attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `uid=${userId}` },
    body: JSON.stringify({ item_type: 'item_hand', nonce: n2 }),
  });
  expect(res.status).toBe(200);
});

// ── 1.7 attack — rapid 3rd request returns 429 ─────────────────────────────────

test('action/attack 3rd rapid request returns 429 (rate limit)', async () => {
  const userId = `smoke-user-${Date.now()}`;

  const r1 = await fetch(`${BASE}/api/action/attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `uid=${userId}` },
    body: JSON.stringify({ item_type: 'item_hand', nonce: nonce('b1') }),
  });

  const r2 = await fetch(`${BASE}/api/action/attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `uid=${userId}` },
    body: JSON.stringify({ item_type: 'item_hand', nonce: nonce('b2') }),
  });

  // 3rd should be rate-limited
  const r3 = await fetch(`${BASE}/api/action/attack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `uid=${userId}` },
    body: JSON.stringify({ item_type: 'item_hand', nonce: nonce('b3') }),
  });

  expect(r1.status).toBe(200);
  expect(r2.status).toBe(200);
  expect(r3.status).toBe(429);
});

// ── 1.8 leaderboard ────────────────────────────────────────────────────────────

test('battle/leaderboard returns 200 + users array', async () => {
  const res = await fetch(`${BASE}/api/battle/leaderboard`);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(Array.isArray(json.data?.users)).toBe(true);
});

// ── 1.9 milestone/claim ────────────────────────────────────────────────────────

test('game/milestone/claim does not 5xx', async () => {
  const res = await fetch(`${BASE}/api/game/milestone/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'uid=smoke-user' },
  });
  // Any response that is valid JSON is fine — the endpoint should not 5xx
  expect(res.status).toBeLessThan(500);
  const json = await res.json();
  expect(typeof json).toBe('object');
});
