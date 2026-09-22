// REPARK 6.0 — P0 attack diagnostic v2
// Fires the attack against /api/action/attack for *the same user that
// is already known to have inventory in Postgres*. If this also 5xx's,
// we will see the real backend stack trace.

const USER_ID = process.env.USER_ID || '00000000-0000-0000-0000-000000000000';
const ITEM = process.env.ITEM || 'item_hand';
const TARGET = process.env.TARGET || 'http://127.0.0.1:3000';
const NONCE = `diag-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
const url = `${TARGET.replace(/\/$/, '')}/api/action/attack`;
const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER_ID}` };
const body = JSON.stringify({ item_type: ITEM, nonce: NONCE });

console.log('[diag-attack-v2] POST', url, 'uid=', USER_ID, 'item=', ITEM);

const t0 = Date.now();
let res;
try {
  res = await fetch(url, { method: 'POST', headers, body });
} catch (e) {
  console.error('[diag-attack-v2] FETCH_THREW', e.message);
  process.exit(1);
}
const text = await res.text();
const elapsed = Date.now() - t0;
console.log('[diag-attack-v2] status', res.status, res.statusText, 'elapsed', elapsed, 'ms');
console.log('[diag-attack-v2] body (raw)', text.slice(0, 1200));
try {
  const j = JSON.parse(text);
  console.log('[diag-attack-v2] ok=', j.ok, 'error=', j.error, 'data.return_code=', j.data?.return_code);
} catch {}