/**
 * Smoke tests for /api/internal/cron/finalize-milestones auth gate.
 *
 * Verifies:
 *   - Loopback call (dev mode, no key set) → 200
 *   - GET with no token (dev loopback) → 200
 *   - POST with bad JSON → 400
 *
 * Note: full HMAC + replay tests live in tests/unit/internal-auth.test.mjs.
 *       This file is just the route-level smoke check.
 */

const BASE = 'http://localhost:3000';

async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: await r.json() };
}

async function post(path, body, contentType = 'application/json') {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: body,
  });
  return { status: r.status, body: await r.json() };
}

let fail = 0;
function check(label, cond) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fail++;
}

(async () => {
  console.log('─ Loopback GET (dev mode, no key) ───────────────────');
  const g = await get('/api/internal/cron/finalize-milestones');
  check('200 OK', g.status === 200);
  check('ok=true', g.body.ok === true);
  check('has recent[]', Array.isArray(g.body.data?.recent));

  console.log('─ Loopback POST empty body ──────────────────────────');
  const p = await post('/api/internal/cron/finalize-milestones', '{}');
  check('200 OK', p.status === 200);
  check('ok=true', p.body.ok === true);
  check('scanned is a number', typeof p.body.data?.scanned === 'number');

  console.log('─ POST malformed JSON ───────────────────────────────');
  const bad = await post('/api/internal/cron/finalize-milestones', 'not-json');
  check('400', bad.status === 400);
  check('code=BAD_JSON', bad.body.error?.code === 'BAD_JSON');

  console.log(fail ? `\n✗ ${fail} FAIL` : '\n✓ PASS');
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });