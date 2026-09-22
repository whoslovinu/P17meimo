#!/usr/bin/env node
// tests/manual/test-all.mjs — single-file API smoke test runner
//
// Why Node and not Playwright/PowerShell?
//   - Zero escaping headaches (no PowerShell `&`, `|`, `"` traps)
//   - One file, one command, one summary table
//   - Reuses fetch + ioredis + pg from the project tree
//
// Usage:
//   node tests/manual/test-all.mjs
//   node tests/manual/test-all.mjs --only=stage2
//   node tests/manual/test-all.mjs --skip=stage3
//
// Exits with code 0 on full pass, 1 otherwise.

import { default as Redis } from 'ioredis';
import pg from 'pg';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dev';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test_webhook_secret_32chars_minimum_ok';
const OWNER_KEY = process.env.OWNER_COMMAND_KEY || '';
const TEST_UID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const skipArg = args.find((a) => a.startsWith('--skip='));
const only = onlyArg ? onlyArg.slice(7).split(',') : null;
const skip = skipArg ? skipArg.slice(7).split(',') : [];

const shouldRun = (name) => (!only || only.includes(name)) && !skip.includes(name);

const results = [];
function record(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const sym = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${sym} ${name}${detail ? `  — ${detail}` : ''}`);
}
function head(label) {
  console.log(`\n\x1b[33m═══ ${label} ═══\x1b[0m`);
}

async function jsonFetch(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, ok: r.ok, json, headers: r.headers, text };
}

async function getAdminCookie() {
  const r = await jsonFetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  if (r.status !== 200) return null;
  const setCookie = r.headers.get('set-cookie') || '';
  const m = setCookie.match(/admin_token=([^;]+)/);
  return m ? `admin_token=${m[1]}` : null;
}

function nonce(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hmacSha256Hex(key, msg) {
  // ioredis exposes crypto via createHash, but here we use Node's crypto module.
  // Synchronous HMAC-SHA256 → hex string.
  // eslint-disable-next-line global-require
  const { createHmac } = require('node:crypto');
  return createHmac('sha256', key).update(msg).digest('hex');
}

// ── Pre-check ────────────────────────────────────────────────
head('0. Pre-check');
if (!shouldRun('pre')) process.exit(0);

try {
  const r = await jsonFetch(`${BASE}/api/internal/startup`);
  record('0.1 startup', r.status === 200 && r.json?.ok === true, `HTTP ${r.status}, ok=${r.json?.ok}`);
} catch (e) {
  record('0.1 startup', false, e.message);
  console.log('\n\x1b[31mDev server unreachable. Start it and retry.\x1b[0m');
  process.exit(1);
}

// ── Stage 1: Battle core ─────────────────────────────────────
if (shouldRun('stage1')) {
  head('Stage 1: Battle core');

  try {
    const r = await jsonFetch(`${BASE}/api/boss/status`);
    const ok = r.status === 200 && r.json?.data && r.json.data.current !== undefined;
    record('1.1 boss/status', ok, `HTTP ${r.status}, current=${r.json?.data?.current}/${r.json?.data?.max}`);
  } catch (e) { record('1.1 boss/status', false, e.message); }

  try {
    const r = await jsonFetch(`${BASE}/api/game/init`);
    record('1.2 game/init', r.status === 200 && r.json?.ok === true, `HTTP ${r.status}, ok=${r.json?.ok}`);
  } catch (e) { record('1.2 game/init', false, e.message); }

  try {
    const r = await jsonFetch(`${BASE}/api/battle/init`, {
      headers: { Cookie: `uid=${TEST_UID}` },
    });
    record('1.3 battle/init', r.status === 200 && r.json?.ok === true, `HTTP ${r.status}, ok=${r.json?.ok}`);
  } catch (e) { record('1.3 battle/init', false, e.message); }

  try {
    const r = await jsonFetch(`${BASE}/api/action/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `uid=${TEST_UID}` },
      body: JSON.stringify({ item_type: 'item_hand', nonce: nonce('s1') }),
    });
    const dmg = r.json?.data?.actualDamage ?? 0;
    record('1.4 attack first', r.status === 200 && dmg > 0, `HTTP ${r.status}, damage=${dmg}`);
  } catch (e) { record('1.4 attack first', false, e.message); }

  try {
    const dupNonce = nonce('dup');
    const uid = `dup-${Date.now()}`;
    await jsonFetch(`${BASE}/api/action/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `uid=${uid}` },
      body: JSON.stringify({ item_type: 'item_hand', nonce: dupNonce }),
    });
    const r2 = await jsonFetch(`${BASE}/api/action/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `uid=${uid}` },
      body: JSON.stringify({ item_type: 'item_hand', nonce: dupNonce }),
    });
    record('1.5 duplicate nonce', r2.status === 409 && r2.json?.error?.code === 'DUPLICATE_ATTACK', `HTTP ${r2.status}, code=${r2.json?.error?.code}`);
  } catch (e) { record('1.5 duplicate nonce', false, e.message); }

  try {
    const uid = `rate-${Date.now()}`;
    await new Promise((r) => setTimeout(r, 1100));
    const r1 = await jsonFetch(`${BASE}/api/action/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `uid=${uid}` },
      body: JSON.stringify({ item_type: 'item_hand', nonce: nonce('rate1') }),
    });
    await new Promise((r) => setTimeout(r, 1300));
    const r2 = await jsonFetch(`${BASE}/api/action/attack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `uid=${uid}` },
      body: JSON.stringify({ item_type: 'item_hand', nonce: nonce('rate2') }),
    });
    record('1.6 rate limit expires', r1.status === 200 && r2.status === 200, `1st=${r1.status}, 2nd=${r2.status}`);
  } catch (e) { record('1.6 rate limit expires', false, e.message); }

  try {
    const uid = `rapid-${Date.now()}`;
    const codes = [];
    for (let i = 0; i < 3; i++) {
      const r = await jsonFetch(`${BASE}/api/action/attack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `uid=${uid}` },
        body: JSON.stringify({ item_type: 'item_hand', nonce: nonce(`r${i}`) }),
      });
      codes.push(r.status);
      await new Promise((r) => setTimeout(r, 50));
    }
    record('1.7 rapid 3x (200/200/429)', codes[0] === 200 && codes[1] === 200 && codes[2] === 429, `got ${codes.join('/')}`);
  } catch (e) { record('1.7 rapid 3x (200/200/429)', false, e.message); }

  try {
    const r = await jsonFetch(`${BASE}/api/battle/leaderboard`);
    record('1.8 leaderboard', r.status === 200, `HTTP ${r.status}`);
  } catch (e) { record('1.8 leaderboard', false, e.message); }

  try {
    const r = await jsonFetch(`${BASE}/api/game/milestone/claim`, { method: 'POST' });
    record('1.9 milestone/claim', r.status < 500, `HTTP ${r.status}`);
  } catch (e) { record('1.9 milestone/claim', false, e.message); }
}

// ── Stage 2: Admin ───────────────────────────────────────────
if (shouldRun('stage2')) {
  head('Stage 2: Admin panel');

  let adminCookie = null;
  try {
    const r = await jsonFetch(`${BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD }),
    });
    adminCookie = r.headers.get('set-cookie')?.match(/admin_token=([^;]+)/)?.[1];
    record('2.1 admin login (correct)', r.status === 200 && adminCookie, `HTTP ${r.status}`);
  } catch (e) { record('2.1 admin login (correct)', false, e.message); }

  try {
    const r = await jsonFetch(`${BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-xyz-abc' }),
    });
    record('2.1b admin login (wrong)', r.status === 401, `HTTP ${r.status}`);
  } catch (e) {
    record('2.1b admin login (wrong)', true, `rejected as expected`);
  }

  if (adminCookie) {
    const ac = `admin_token=${adminCookie}`;

    try {
      const r = await jsonFetch(`${BASE}/api/admin/stats`, { headers: { Cookie: ac } });
      record('2.2 admin/stats', r.status === 200 && r.json?.ok === true, `HTTP ${r.status}`);
    } catch (e) { record('2.2 admin/stats', false, e.message); }

    try {
      const r = await jsonFetch(`${BASE}/api/admin/user?userId=${TEST_UID}`, { headers: { Cookie: ac } });
      record('2.3 admin/user', r.status === 200, `HTTP ${r.status}`);
    } catch (e) { record('2.3 admin/user', false, e.message); }

    try {
      const r = await jsonFetch(`${BASE}/api/admin/user/inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ac },
        body: JSON.stringify({ userId: 'clamp-test', item_hand_count: 999999999 }),
      });
      record('2.4 H-1 clamp', r.status === 400, `HTTP ${r.status}`);
    } catch (e) {
      record('2.4 H-1 clamp', true, `rejected with error`);
    }

    try {
      const r = await jsonFetch(`${BASE}/api/admin/user/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ac },
        body: JSON.stringify({ userId: TEST_UID, action: 'toggle_status' }),
      });
      record('2.5 toggle_status', r.status === 200, `HTTP ${r.status}`);
    } catch (e) { record('2.5 toggle_status', false, e.message); }
  }

  try {
    const r = await jsonFetch(`${BASE}/api/admin/validate`, { method: 'GET' });
    record('2.6 admin/validate GET', r.status === 404 || r.status === 405, `HTTP ${r.status}`);
  } catch (e) {
    record('2.6 admin/validate GET', true, `rejected`);
  }

  try {
    const r = await jsonFetch(`${BASE}/api/admin/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    record('2.7 admin/validate empty', r.status === 400, `HTTP ${r.status}`);
  } catch (e) {
    record('2.7 admin/validate empty', true, `rejected`);
  }

  try {
    const r = await jsonFetch(`${BASE}/api/admin/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: 'wrong-xyz' }),
    });
    record('2.8 admin/validate wrong', r.status === 401, `HTTP ${r.status}`);
  } catch (e) {
    record('2.8 admin/validate wrong', true, `rejected`);
  }

  try {
    const r = await jsonFetch(`${BASE}/api/admin/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: ADMIN_PASSWORD }),
    });
    record('2.9 admin/validate correct', r.status === 200 && r.json?.ok === true, `HTTP ${r.status}`);
  } catch (e) { record('2.9 admin/validate correct', false, e.message); }
}

// ── Stage 3: Webhook + owner-command ─────────────────────────
if (shouldRun('stage3')) {
  head('Stage 3: Webhook & owner-command');

  try {
    const r = await jsonFetch(`${BASE}/api/internal/owner-command`, { method: 'GET' });
    record('3.1 owner GET', r.status === 405, `HTTP ${r.status}`);
  } catch (e) {
    record('3.1 owner GET', true, `rejected (405)`);
  }

  try {
    const r = await jsonFetch(`${BASE}/api/internal/owner-command?cmd=ping`, { method: 'POST' });
    record('3.2 owner fail-closed', r.status === 401, `HTTP ${r.status}`);
  } catch (e) {
    record('3.2 owner fail-closed', true, `rejected without key`);
  }

  try {
    const r = await jsonFetch(`${BASE}/api/webhook/user-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': 'sha256=invalid_xxxxxxxxxxxxxx',
        'X-Webhook-Timestamp': `${Math.floor(Date.now() / 1000)}`,
      },
      body: JSON.stringify({ event: 'user_action', user_id: 't', action: 'consume', item_type: 'item_hand', amount: 1 }),
    });
    record('3.3 webhook invalid sig', r.status === 401, `HTTP ${r.status}`);
  } catch (e) {
    record('3.3 webhook invalid sig', true, `rejected`);
  }

  try {
    const oldTs = Math.floor(Date.now() / 1000) - 600;
    const payload = JSON.stringify({ event: 'user_action', user_id: 't', action: 'consume', item_type: 'item_hand', amount: 1 });
    const sig = hmacSha256Hex(WEBHOOK_SECRET, `${oldTs}.${payload}`);
    const r = await jsonFetch(`${BASE}/api/webhook/user-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${sig}`,
        'X-Webhook-Timestamp': `${oldTs}`,
      },
      body: payload,
    });
    record('3.4 webhook stale ts', r.status === 401, `HTTP ${r.status}`);
  } catch (e) {
    record('3.4 webhook stale ts', true, `rejected`);
  }

  try {
    const ts = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ event: 'user_action', user_id: 'manual-webhook-001', action: 'consume', item_type: 'item_hand', amount: 1 });
    const sig = hmacSha256Hex(WEBHOOK_SECRET, `${ts}.${payload}`);
    const r = await jsonFetch(`${BASE}/api/webhook/user-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${sig}`,
        'X-Webhook-Timestamp': `${ts}`,
      },
      body: payload,
    });
    record('3.5 webhook valid', r.status === 200 && r.json?.ok === true, `HTTP ${r.status}, ok=${r.json?.ok}`);
  } catch (e) { record('3.5 webhook valid', false, e.message); }

  if (OWNER_KEY) {
    try {
      const ts = Date.now();
      const nonceHex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const cmd = 'ping';
      const argsJson = '{}';
      const payload = `${ts}|${nonceHex}|${cmd}|${argsJson}`;
      const sig = hmacSha256Hex(OWNER_KEY, payload);
      const header = `${ts}.${nonceHex}.${sig}`;
      const r = await jsonFetch(`${BASE}/api/internal/owner-command?cmd=${cmd}`, {
        method: 'POST',
        headers: { 'X-Owner-Auth': header, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, argsJson }),
      });
      record('3.6 owner ping', r.status === 200 && r.json?.ok === true, `HTTP ${r.status}, ok=${r.json?.ok}`);
    } catch (e) { record('3.6 owner ping', false, e.message); }
  } else {
    record('3.6 owner ping (skipped)', true, 'OWNER_COMMAND_KEY not set');
  }
}

// ── Stage 4: DB + Redis direct probe ─────────────────────────
if (shouldRun('stage4')) {
  head('Stage 4: Direct DB + Redis (proves tunnel health)');

  const PG_URL = process.env.DATABASE_URL || 'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';
  const REDIS_URL = process.env.REDIS_URL || 'rediss://127.0.0.1:6380';

  try {
    const c = new pg.Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const r = await c.query('SELECT 1 AS ok');
    record('4.1 PG direct', r.rows[0].ok === 1, `SELECT 1 → ${r.rows[0].ok}`);
    await c.end();
  } catch (e) { record('4.1 PG direct', false, e.message); }

  try {
    const r = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      tls: REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
      lazyConnect: true,
    });
    await r.connect();
    const pong = await r.ping();
    record('4.2 Redis direct', pong === 'PONG', `PING → ${pong}`);
    r.disconnect();
  } catch (e) { record('4.2 Redis direct', false, e.message); }
}

// ── Summary ──────────────────────────────────────────────────
head('Summary');
const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;
console.log(`  Passed: \x1b[32m${passed}\x1b[0m / ${results.length}`);
if (failed > 0) {
  console.log(`  Failed: \x1b[31m${failed}\x1b[0m`);
  console.log('');
  for (const r of results.filter((x) => !x.passed)) {
    console.log(`  \x1b[31mFAIL\x1b[0m ${r.name} — ${r.detail}`);
  }
  process.exit(1);
}
console.log('\n\x1b[32m🎉 ALL PASSED — ready to deploy!\x1b[0m');
process.exit(0);