#!/usr/bin/env node
/**
 * verify-badge-endpoints.mjs
 *
 * Customer-supplied-URL smoke test for the Badge Detail + Badge Grant APIs.
 *
 * Purpose:
 *   - Confirm MAIN_STATION_BADGE_DETAIL_URL is reachable, signed correctly,
 *     responds within timeout, and returns a parseable body.
 *   - Confirm MAIN_STATION_BADGE_GRANT_URL behaves the same way.
 *
 * This script does NOT modify production. It only sends test requests
 * using the secret and URLs the customer provides.
 *
 * Usage:
 *   # 1. Provide URLs via env vars
 *   export MAIN_STATION_BADGE_DETAIL_URL="https://customer-host/webhook/activity/badge/detail"
 *   export MAIN_STATION_BADGE_GRANT_URL="https://customer-host/webhook/activity/badge/grant"
 *   export WEBHOOK_SECRET="<shared-32+-char-secret>"
 *
 *   # 2. (Optional) Override test inputs
 *   export TEST_BADGE_ID="10021"
 *   export TEST_USER_ID="128"
 *   export TEST_ACTIVITY_ID="1"
 *
 *   # 3. Run
 *   node scripts/verify-badge-endpoints.mjs
 *
 * Exit codes:
 *   0 = PASS (all required checks green)
 *   1 = FAIL (any required check failed)
 *   2 = CONFIG ERROR (missing env vars)
 *
 * Spec reference:
 *   - Customer doc: 第三方活动勋章接口.md
 *   - HMAC: HMAC-SHA256(raw_body_utf8, WEBHOOK_SECRET).hexdigest()
 *   - Header: X-Webhook-Signature: sha256=<hex>
 *   - Header: X-Request-Id: <opaque>
 *   - Content-Type: application/json; charset=utf-8
 */

import crypto from 'node:crypto';
import process from 'node:process';
import fs from 'node:fs';

// ──────────────────────────────────────────────────────────────────────────
// 1. Config — read from env, fail fast on missing required values
// ──────────────────────────────────────────────────────────────────────────

const DETAIL_URL  = (process.env.MAIN_STATION_BADGE_DETAIL_URL ?? '').trim();
const GRANT_URL   = (process.env.MAIN_STATION_BADGE_GRANT_URL  ?? '').trim();
const SECRET      = (process.env.WEBHOOK_SECRET               ?? '').trim();

const TEST_BADGE_ID    = (process.env.TEST_BADGE_ID    ?? '10021').trim();
const TEST_USER_ID     = (process.env.TEST_USER_ID     ?? '128').trim();
const TEST_ACTIVITY_ID = (process.env.TEST_ACTIVITY_ID ?? '1').trim();

const REQUEST_TIMEOUT_MS = 10_000;  // 10 s per attempt (matches badgeAdapter.ts)

function checkConfig() {
  const errors = [];
  if (!DETAIL_URL) errors.push('MAIN_STATION_BADGE_DETAIL_URL is missing');
  if (!GRANT_URL)  errors.push('MAIN_STATION_BADGE_GRANT_URL is missing');
  if (!SECRET)     errors.push('WEBHOOK_SECRET is missing');
  if (SECRET && SECRET.length < 32) {
    errors.push(`WEBHOOK_SECRET is too short (${SECRET.length} chars; need ≥ 32)`);
  }
  if (errors.length > 0) {
    console.error('❌ CONFIG ERROR:');
    for (const e of errors) console.error(`   - ${e}`);
    console.error('\nSet the env vars listed above and re-run.');
    process.exit(2);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 2. HMAC sign helper — byte-identical to lib/services/badgeAdapter.ts
// ──────────────────────────────────────────────────────────────────────────

function signBody(body) {
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(body, 'utf8');  // raw UTF-8 bytes — never parse+re-serialise
  return 'sha256=' + hmac.digest('hex');
}

function randomRequestId() {
  return `VERIFY_${Date.now()}_${crypto.randomUUID()}`;
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Probe helper — measures latency, captures status, parses body
// ──────────────────────────────────────────────────────────────────────────

async function probe({ label, url, body }) {
  const result = {
    label,
    url,
    requestId: randomRequestId(),
    signature: '',
    httpStatus: null,
    bodyCode: null,
    bodyMessage: '',
    bodyData: null,
    latencyMs: null,
    bodyText: '',
    error: null,
  };

  const signature = signBody(body);
  result.signature = signature;

  const headers = {
    'Content-Type':         'application/json; charset=utf-8',
    'X-Webhook-Signature':  signature,
    'X-Request-Id':         result.requestId,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const start = process.hrtime.bigint();
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers,
      body,    // raw JSON string — never JSON.stringify here
      signal:  controller.signal,
    });
    const end = process.hrtime.bigint();
    result.latencyMs  = Number(end - start) / 1_000_000;
    result.httpStatus = res.status;
    result.bodyText   = await res.text();

    try {
      const parsed = JSON.parse(result.bodyText);
      result.bodyCode    = parsed.code   ?? null;
      result.bodyMessage = parsed.message ?? '';
      result.bodyData    = parsed.data   ?? null;
    } catch (_e) {
      result.bodyCode = -1;
      result.bodyMessage = result.bodyText.slice(0, 200);
    }
  } catch (err) {
    const end = process.hrtime.bigint();
    result.latencyMs = Number(end - start) / 1_000_000;
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Assertion helpers — return { pass, reason }
// ──────────────────────────────────────────────────────────────────────────

function assertReachable(r) {
  if (r.error) return { pass: false, reason: `Network/timeout error: ${r.error}` };
  if (r.httpStatus === null) return { pass: false, reason: 'No HTTP response' };
  return { pass: true, reason: `HTTP ${r.httpStatus}` };
}

function assertHttps(r) {
  if (!r.url.toLowerCase().startsWith('https://')) {
    return { pass: false, reason: `URL is not HTTPS: ${r.url}` };
  }
  return { pass: true, reason: 'HTTPS scheme' };
}

function assertHmacAccepted(r) {
  // HMAC acceptance surfaces as body.code === 200 (success) OR body.message
  // containing "签名" / "sign" / "signature" / 401 in HTTP status.
  if (r.bodyCode === 401) return { pass: false, reason: 'Main Station rejected signature (code=401)' };
  if (r.bodyMessage && /签名|signature|sign/i.test(r.bodyMessage)) {
    return { pass: false, reason: `Signature-related message: "${r.bodyMessage}"` };
  }
  if (r.httpStatus === 401 || r.httpStatus === 403) {
    return { pass: false, reason: `HTTP ${r.httpStatus} — likely signature/IP rejected` };
  }
  return { pass: true, reason: 'HMAC not rejected' };
}

function assertHttpStatus(r) {
  // Spec: "HTTP 状态码一般为 200". Tolerate 200 as success. Non-2xx is a fail.
  if (r.httpStatus === null) return { pass: false, reason: 'No HTTP status' };
  if (r.httpStatus >= 200 && r.httpStatus < 300) {
    return { pass: true, reason: `HTTP ${r.httpStatus} (2xx)` };
  }
  return { pass: false, reason: `Unexpected HTTP status: ${r.httpStatus}` };
}

function assertResponseBody(r) {
  if (!r.bodyText) return { pass: false, reason: 'Empty body' };
  if (r.bodyCode === -1) return { pass: false, reason: `Body is not valid JSON: ${r.bodyMessage.slice(0, 80)}` };
  if (r.bodyCode === null) return { pass: false, reason: 'Body has no `code` field' };
  return { pass: true, reason: `code=${r.bodyCode} message="${r.bodyMessage}"` };
}

function assertTimeout(r) {
  if (r.latencyMs === null) return { pass: false, reason: 'No latency recorded' };
  if (r.latencyMs > REQUEST_TIMEOUT_MS) {
    return { pass: false, reason: `Latency ${r.latencyMs.toFixed(0)}ms exceeds timeout ${REQUEST_TIMEOUT_MS}ms` };
  }
  return { pass: true, reason: `${r.latencyMs.toFixed(0)}ms < ${REQUEST_TIMEOUT_MS}ms` };
}

function assertLatencyReported(r) {
  return { pass: r.latencyMs !== null, reason: r.latencyMs === null ? 'No latency' : `${r.latencyMs.toFixed(1)}ms` };
}

// ──────────────────────────────────────────────────────────────────────────
// 5. Per-endpoint test runner
// ──────────────────────────────────────────────────────────────────────────

function runEndpointChecks(label, result) {
  const checks = [
    { name: 'URL reachable',           fn: assertReachable      },
    { name: 'HTTPS scheme',            fn: assertHttps          },
    { name: 'HMAC signature accepted', fn: assertHmacAccepted   },
    { name: 'HTTP status',             fn: assertHttpStatus     },
    { name: 'Response body',           fn: assertResponseBody   },
    { name: 'Within timeout',          fn: assertTimeout        },
    { name: 'Latency measured',        fn: assertLatencyReported},
  ];

  const lines = [];
  let allPass = true;
  for (const c of checks) {
    const out = c.fn(result);
    if (!out.pass) allPass = false;
    lines.push({ name: c.name, pass: out.pass, reason: out.reason });
  }
  return { allPass, lines };
}

// ──────────────────────────────────────────────────────────────────────────
// 6. Body builders — match the customer spec exactly
// ──────────────────────────────────────────────────────────────────────────

function buildDetailBody(badgeId) {
  return JSON.stringify({ badge_id: String(badgeId) });
}

function buildGrantBody(userId, badgeId, activityId, requestId) {
  return JSON.stringify({
    user_id:     String(userId),
    badge_id:    String(badgeId),
    activity_id: String(activityId),
    request_id:  String(requestId),
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 7. Report rendering
// ──────────────────────────────────────────────────────────────────────────

function renderCheck(name, pass, reason) {
  const mark = pass ? '✓' : '✗';
  const pad  = pass ? 'PASS' : 'FAIL';
  return `  ${mark} ${name.padEnd(28)} [${pad}] ${reason}`;
}

function renderEndpoint(name, url, result, checks) {
  const lines = [];
  lines.push('');
  lines.push(`── ${name} ──────────────────────────────────────────────`);
  lines.push(`  URL:           ${url}`);
  lines.push(`  Request-Id:    ${result.requestId}`);
  lines.push(`  Signature:     ${result.signature.slice(0, 40)}…`);
  lines.push(`  Latency:       ${result.latencyMs !== null ? result.latencyMs.toFixed(1) + 'ms' : 'n/a'}`);
  lines.push(`  HTTP Status:   ${result.httpStatus ?? 'n/a'}`);
  lines.push(`  Body.code:     ${result.bodyCode ?? 'n/a'}`);
  lines.push(`  Body.message:  ${result.bodyMessage || '(empty)'}`);
  if (result.bodyData && typeof result.bodyData === 'object') {
    try {
      const summary = JSON.stringify(result.bodyData).slice(0, 120);
      lines.push(`  Body.data:     ${summary}${summary.length >= 120 ? '…' : ''}`);
    } catch (_e) { /* ignore */ }
  }
  if (result.error) lines.push(`  Error:         ${result.error}`);

  lines.push('');
  lines.push('  Checks:');
  for (const c of checks.lines) {
    lines.push(renderCheck(c.name, c.pass, c.reason));
  }
  lines.push('');
  lines.push(`  Endpoint result: ${checks.allPass ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// 8. Main
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  checkConfig();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Badge Endpoint Verification');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  TEST_BADGE_ID:    ${TEST_BADGE_ID}`);
  console.log(`  TEST_USER_ID:     ${TEST_USER_ID}`);
  console.log(`  TEST_ACTIVITY_ID: ${TEST_ACTIVITY_ID}`);
  console.log(`  Timeout:          ${REQUEST_TIMEOUT_MS}ms per request`);

  // ── Test 1: Badge Detail ──
  const detailBody = buildDetailBody(TEST_BADGE_ID);
  const detailResult = await probe({ label: 'DETAIL', url: DETAIL_URL, body: detailBody });
  const detailChecks = runEndpointChecks('Badge Detail', detailResult);

  // ── Test 2: Badge Grant ──
  // Use a unique request_id for the grant test so re-runs don't collide.
  const grantRequestId = randomRequestId();
  const grantBody = buildGrantBody(TEST_USER_ID, TEST_BADGE_ID, TEST_ACTIVITY_ID, grantRequestId);
  const grantResult = await probe({ label: 'GRANT', url: GRANT_URL, body: grantBody });
  const grantChecks = runEndpointChecks('Badge Grant', grantResult);

  // ── Render report ──
  const report = [
    renderEndpoint('Badge Detail', DETAIL_URL, detailResult, detailChecks),
    renderEndpoint('Badge Grant',  GRANT_URL,  grantResult,  grantChecks),
  ].join('\n');

  console.log(report);

  const allPass = detailChecks.allPass && grantChecks.allPass;

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  OVERALL: ${allPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log('═══════════════════════════════════════════════════════════');

  if (!allPass) {
    const failures = [];
    if (!detailChecks.allPass) {
      for (const c of detailChecks.lines) {
        if (!c.pass) failures.push(`Detail/${c.name}: ${c.reason}`);
      }
    }
    if (!grantChecks.allPass) {
      for (const c of grantChecks.lines) {
        if (!c.pass) failures.push(`Grant/${c.name}: ${c.reason}`);
      }
    }
    console.log('\nFailure reasons:');
    for (const f of failures) console.log(`  - ${f}`);
  }

  // ── Write JSON report ──
  const jsonReport = {
    timestamp:        new Date().toISOString(),
    overall:         allPass ? 'PASS' : 'FAIL',
    detail: {
      url:           DETAIL_URL,
      requestId:     detailResult.requestId,
      signature:     detailResult.signature,
      latencyMs:     detailResult.latencyMs,
      httpStatus:    detailResult.httpStatus,
      bodyCode:      detailResult.bodyCode,
      bodyMessage:   detailResult.bodyMessage,
      bodyData:      detailResult.bodyData,
      error:         detailResult.error,
      checks:        detailChecks.lines,
      result:        detailChecks.allPass ? 'PASS' : 'FAIL',
    },
    grant: {
      url:           GRANT_URL,
      requestId:     grantResult.requestId,
      signature:     grantResult.signature,
      latencyMs:     grantResult.latencyMs,
      httpStatus:    grantResult.httpStatus,
      bodyCode:      grantResult.bodyCode,
      bodyMessage:   grantResult.bodyMessage,
      bodyData:      grantResult.bodyData,
      error:         grantResult.error,
      checks:        grantChecks.lines,
      result:        grantChecks.allPass ? 'PASS' : 'FAIL',
    },
  };

  const reportPath = process.env.REPORT_PATH ?? '/tmp/badge-endpoint-verify.json';
  try {
    fs.writeFileSync(reportPath, JSON.stringify(jsonReport, null, 2));
    console.log(`\nJSON report written to: ${reportPath}`);
  } catch (err) {
    console.warn(`\nCould not write JSON report: ${err.message}`);
  }

  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('❌ Unhandled error:', err);
  process.exit(1);
});
