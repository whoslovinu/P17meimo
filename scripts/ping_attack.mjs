#!/usr/bin/env node
/**
 * scripts/ping_attack.mjs — Quick liveness probe for /api/action/attack.
 *
 * Issues a single attack request and times it. Useful to figure out whether
 * the "network error" toast is a real server-side hang or just the client
 * 5s AbortController firing while dev is busy.
 */

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

async function loginAdmin() {
  const res = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.ADMIN_SECRET_KEY ?? 'dev' }),
  });
  if (!res.ok) throw new Error(`admin/login ${res.status}`);
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/admin_token=([^;]+)/);
  return `admin_token=${m[1]}`;
}

async function getCookieUid() {
  // The browser cookie uid controls which user attacks apply to. Hit init to
  // see what the server would do. (init is auth-tolerant.)
  const res = await fetch(`${BASE}/api/battle/init?activityId=1`);
  const text = await res.text();
  return text.slice(0, 200);
}

async function attack(userId) {
  const nonce = `nonce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const t0 = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${BASE}/api/action/attack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `uid=${userId}`,
      },
      body: JSON.stringify({ item_type: 'item_hand', nonce }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const elapsed = Date.now() - t0;
    const body = await res.text();
    return { ok: res.ok, status: res.status, elapsed, body };
  } catch (err) {
    clearTimeout(timeoutId);
    return { ok: false, status: 0, elapsed: Date.now() - t0, error: String(err) };
  }
}

async function main() {
  const [, , userId = '11111111-2222-3333-4444-555555555555'] = process.argv;
  console.log(`[ping_attack] target user: ${userId}`);

  console.log('\n[1] login admin (warm up)');
  await loginAdmin();
  console.log('  ✓');

  console.log('\n[2] /api/battle/init smoke');
  const init = await getCookieUid();
  console.log('  ', init);

  console.log('\n[3] single attack (item_hand) …');
  const r = await attack(userId);
  console.log('  ok:', r.ok, '  status:', r.status, '  elapsed:', r.elapsed, 'ms');
  if (r.error) console.log('  error:', r.error);
  if (r.body) console.log('  body:', r.body.slice(0, 500));
}

main().catch((e) => { console.error('[ping_attack] failed:', e); process.exit(1); });