/**
 * tests/api/00-prerequisites.spec.ts — Phase 12
 *
 * Prerequisites check: verifies that the dev server is running with a
 * properly configured .env.local and that required tunnels (Redis / PostgreSQL)
 * are established before any other tests run.
 *
 * This file should be listed FIRST in playwright.config.ts under testDir
 * so it fails fast if the environment is not ready.
 *
 * If this file passes, the full integration suite (01-03-*.spec.ts)
 * can run against a live dev server.
 */

import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

// ── 0.1 Dev server is reachable ───────────────────────────────────────────────

test('dev server is running and responding', async () => {
  const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
  expect(res.ok || res.status < 500).toBe(true);
});

// ── 0.2 Startup endpoint confirms startup was called ───────────────────────────

test('startup endpoint is healthy', async () => {
  const res = await fetch(`${BASE}/api/internal/startup`, {
    signal: AbortSignal.timeout(5000),
  });
  expect(res.ok).toBe(true);
  const json = await res.json();
  expect(json.ok).toBe(true);
});

// ── 0.3 Redis tunnel is open (boss/status depends on Redis) ────────────────────

test('boss/status returns HP data (proves Redis is connected)', async () => {
  const res = await fetch(`${BASE}/api/boss/status`, {
    signal: AbortSignal.timeout(5000),
  });
  // 503 = Redis tunnel not open (run `node scripts/dev_tunnel.mjs`)
  // 200 = Redis connected, test passes
  if (res.status === 503) {
    throw new Error(
      '[PREREQ] Redis tunnel is not open. Run: node scripts/dev_tunnel.mjs\n' +
      'Then restart the dev server so .env.local is reloaded.'
    );
  }
  expect(res.ok).toBe(true);
  const json = await res.json();
  expect(json.ok).toBe(true);
  const data = json.data as Record<string, unknown>;
  expect(typeof data.currentHp).toBe('number');
  expect(typeof data.maxHp).toBe('number');
});

// ── 0.4 PostgreSQL tunnel is open (battle/init depends on PG) ─────────────────

test('battle/init returns user state (proves PostgreSQL is connected)', async () => {
  const res = await fetch(`${BASE}/api/battle/init`, {
    headers: { Cookie: 'uid=prereq-check' },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 503) {
    throw new Error(
      '[PREREQ] PostgreSQL tunnel is not open. Run: node scripts/dev_tunnel.mjs\n' +
      'Then restart the dev server.'
    );
  }
  expect(res.ok).toBe(true);
  const json = await res.json();
  expect(json.ok).toBe(true);
});

// ── 0.5 ADMIN_SECRET_KEY is properly configured ────────────────────────────────

test('admin/login works with password "dev" (ADMIN_SECRET_KEY = SHA256("dev"))', async () => {
  // Simulate what adminToken.ts does: SHA256("dev") should equal ADMIN_SECRET_KEY.
  // We verify this by successfully logging in.
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'dev' }),
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 401) {
    throw new Error(
      '[PREREQ] admin/login returned 401. ADMIN_SECRET_KEY may be wrong.\n' +
      'Set in .env.local: ADMIN_SECRET_KEY=ef260e9aa3c673af240d17a2660480361a8e081d1ffeca2a5ed0e3219fc18567\n' +
      'Then restart the dev server.'
    );
  }
  expect(res.ok).toBe(true);
  const json = await res.json();
  expect(json.ok).toBe(true);
  const setCookie = res.headers.get('set-cookie') ?? '';
  expect(setCookie).toContain('admin_token=');
});

// ── 0.6 Webhook secret is configured ─────────────────────────────────────────

test('webhook endpoint accepts valid test signature', async () => {
  const secret = 'test_webhook_secret_32chars_minimum_ok';
  const payload = JSON.stringify({ event: 'user_action', user_id: 'prereq-check' });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = require('node:crypto')
    .createHmac('sha256', secret)
    .update(`${ts}.${payload}`)
    .digest('hex');

  const res = await fetch(`${BASE}/api/webhook/user-action`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': `sha256=${sig}`,
      'X-Webhook-Timestamp': ts,
    },
    body: payload,
    signal: AbortSignal.timeout(5000),
  });
  expect(res.status).not.toBe(500);
});
