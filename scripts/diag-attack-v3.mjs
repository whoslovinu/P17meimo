// diag-attack for user 11111111... with inventory 9999/9999
const USER_ID = '11111111-1111-1111-1111-111111111111';
const ITEM = 'item_hand';
const TARGET = 'http://127.0.0.1:3000';
const NONCE = `diag-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
const url = `${TARGET}/api/action/attack`;
const body = JSON.stringify({ item_type: ITEM, nonce: NONCE });
console.log('[diag-attack-v2] POST', url, 'uid=', USER_ID, 'item=', ITEM, 'nonce=', NONCE);
const t0 = Date.now();
let res;
try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER_ID}` }, body }); }
catch (e) { console.error('FETCH_THREW', e.message); process.exit(1); }
const text = await res.text();
const elapsed = Date.now() - t0;
console.log('[diag-attack-v2] status', res.status, res.statusText, 'elapsed', elapsed, 'ms');
console.log('[diag-attack-v2] body (raw)', text.slice(0, 1500));
try { const j = JSON.parse(text); console.log('[diag-attack-v2] ok=', j.ok, 'error=', j.error, 'data=', j.data); } catch {}

// Second attack with different nonce — verify Lua success path
console.log('\n[diag-attack-v2] second attack with fresh nonce');
const NONCE2 = `diag2-${Date.now()}-${Math.floor(Math.random()*1e6)}`;
const body2 = JSON.stringify({ item_type: ITEM, nonce: NONCE2 });
const t1 = Date.now();
let res2;
try { res2 = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${USER_ID}` }, body: body2 }); }
catch (e) { console.error('FETCH_THREW', e.message); process.exit(1); }
const text2 = await res2.text();
console.log('[diag-attack-v2] status2', res2.status, res2.statusText, 'elapsed2', Date.now() - t1, 'ms');
console.log('[diag-attack-v2] body2 (raw)', text2.slice(0, 1500));