/**
 * scripts/diag-attack.mjs
 *
 * REPARK 6.0 — diagnostic attack caller
 *
 * What this does:
 *   1. Reads the production .env to discover the real public URL.
 *   2. Fires an attack POST /api/action/attack with a Commander-style
 *      Authorization: Bearer <userId> header (no cookie).
 *   3. Prints the raw HTTP status, headers, and body.
 *   4. Prints parsed error.message and code so we can see WHAT the backend
 *      actually rejects with.
 *
 * Usage:
 *   TARGET_URL=http://98.93.252.250:3000 node scripts/diag-attack.mjs
 *   USER_ID=11111111-1111-1111-1111-111111111111 TARGET_URL=http://localhost:3000 node scripts/diag-attack.mjs
 */

import crypto from 'node:crypto';

const TARGET_URL = process.env.TARGET_URL ?? 'http://98.93.252.250:3000';
const USER_ID = process.env.USER_ID ?? '11111111-1111-1111-1111-111111111111';

const url = `${TARGET_URL.replace(/\/$/, '')}/api/action/attack`;
const body = {
  item_type: 'item_hand',
  nonce: `diag-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
};

console.log('[diag-attack] POST', url);
console.log('[diag-attack] Authorization: Bearer', USER_ID);
console.log('[diag-attack] body:', body);

const startedAt = Date.now();
let res;
try {
  res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${USER_ID}`,
    },
    body: JSON.stringify(body),
  });
} catch (err) {
  console.error('[diag-attack] FETCH_THREW:', err.message);
  process.exit(1);
}

const elapsed = Date.now() - startedAt;
const text = await res.text();
console.log('[diag-attack] status:', res.status, res.statusText);
console.log('[diag-attack] elapsedMs:', elapsed);
console.log('[diag-attack] content-type:', res.headers.get('content-type'));
console.log('[diag-attack] raw body (first 800 chars):');
console.log(text.slice(0, 800));

try {
  const json = JSON.parse(text);
  console.log('[diag-attack] parsed ok=', json.ok);
  console.log('[diag-attack] parsed error.code=', json.error?.code);
  console.log('[diag-attack] parsed error.message=', json.error?.message);
  console.log('[diag-attack] parsed returnCode=', json.data?.return_code ?? json.data?.returnCode);
  console.log('[diag-attack] parsed actual_damage=', json.data?.actual_damage ?? json.data?.actualDamage);
  console.log('[diag-attack] parsed new_hp=', json.data?.new_hp ?? json.data?.newHp);
} catch (e) {
  console.log('[diag-attack] (response not JSON)');
}
