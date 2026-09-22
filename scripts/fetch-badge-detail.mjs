#!/usr/bin/env node
// fetch-badge-detail.mjs — Direct HMAC probe of MAIN_STATION_BADGE_DETAIL_URL.
// Returns raw {badge_id, name, description, ...} for one or more IDs.
// Usage: MAIN_STATION_BADGE_DETAIL_URL=... WEBHOOK_SECRET=... node scripts/fetch-badge-detail.mjs 59 60 1
import crypto from 'node:crypto';

const DETAIL_URL = (process.env.MAIN_STATION_BADGE_DETAIL_URL ?? '').trim();
const SECRET     = (process.env.WEBHOOK_SECRET               ?? '').trim();
const ids        = process.argv.slice(2);

if (!DETAIL_URL) { console.error('MAIN_STATION_BADGE_DETAIL_URL required'); process.exit(2); }
if (!SECRET)     { console.error('WEBHOOK_SECRET required');              process.exit(2); }
if (ids.length === 0) { console.error('Pass badge ids as args, e.g. 59 60 1'); process.exit(2); }

function signBody(body) {
  return 'sha256=' + crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
}

async function probe(badgeId) {
  const body = JSON.stringify({ badge_id: String(badgeId) });
  const reqId = `PROBE_${badgeId}_${crypto.randomUUID()}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  const start = process.hrtime.bigint();
  try {
    const r = await fetch(DETAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type':        'application/json; charset=utf-8',
        'X-Webhook-Signature': signBody(body),
        'X-Request-Id':        reqId,
      },
      body,
      signal: controller.signal,
    });
    const text = await r.text();
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = { code: -1, message: text }; }
    const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
    return { ok: r.ok, http: r.status, code: parsed?.code, message: parsed?.message, data: parsed?.data, ms };
  } catch (e) {
    const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
    return { ok: false, error: String(e?.message ?? e), ms };
  } finally {
    clearTimeout(t);
  }
}

console.log('---');
for (const id of ids) {
  const r = await probe(id);
  console.log(`id=${id}  http=${r.http}  code=${r.code}  ${r.ms?.toFixed(0)}ms`);
  console.log(`  message: ${r.message ?? ''}`);
  if (r.data) {
    console.log(`  data:`);
    console.log(`    badge_id:    ${r.data.badge_id ?? ''}`);
    console.log(`    name:        ${r.data.name ?? ''}`);
    console.log(`    description: ${r.data.description ?? ''}`);
    console.log(`    status:      ${r.data.status ?? ''}`);
    console.log(`    icon:        ${r.data.icon ?? ''}`);
  }
  if (r.error) console.log(`  error: ${r.error}`);
  console.log('---');
}
