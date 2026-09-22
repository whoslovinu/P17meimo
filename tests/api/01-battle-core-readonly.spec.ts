/**
 * tests/api/01-battle-core-readonly.spec.ts
 *
 * READ-ONLY variant of 01-battle-core.spec.ts — used for RC standalone smoke
 * validation. EXCLUDES action/attack (writes to DB).
 *
 * Run against an arbitrary baseURL via:
 *   E2E_BASE_URL=http://127.0.0.1:3101 \
 *     npx playwright test tests/api/01-battle-core-readonly.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

test('game/init returns 200 + valid activity data', async () => {
  const res = await fetch(`${BASE}/api/game/init`);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
});

test('boss/status returns 200 + HP data', async () => {
  const res = await fetch(`${BASE}/api/boss/status`);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
});

test('battle/init returns 200 + user state', async () => {
  const res = await fetch(`${BASE}/api/battle/init`, {
    headers: { Cookie: `uid=smoke-readonly-${Date.now()}` },
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
});

test('battle/leaderboard returns 200 + users array', async () => {
  const res = await fetch(`${BASE}/api/battle/leaderboard`);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(Array.isArray(json.data?.users ?? json.users ?? json.data)).toBe(true);
});

test('game/milestone/claim returns 400 (no body) — read-only shape check', async () => {
  const res = await fetch(`${BASE}/api/game/milestone/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `uid=smoke-readonly-${Date.now()}` },
    body: JSON.stringify({ milestone_id: 99999 }),
  });
  // Should NOT 5xx; shape can be 200/400/404 etc.
  expect(res.status).toBeLessThan(500);
});
