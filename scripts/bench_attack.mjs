#!/usr/bin/env node
/**
 * scripts/bench_attack.mjs
 *
 * Production-mode latency benchmark for /api/action/attack.
 *
 * Usage:
 *   node scripts/bench_attack.mjs                  # default 50 samples, text output
 *   BENCH_SAMPLE=200 node scripts/bench_attack.mjs # longer run for P99 confidence
 *   node scripts/bench_attack.mjs --format=json    # CI-friendly JSON output
 *   node scripts/bench_attack.mjs --format=junit   # JUnit XML for test reporters
 *   node scripts/bench_attack.mjs --gate           # exit 1 if any SLA breached
 *
 * Environment variables:
 *   BENCH_URL   - target base URL (default http://localhost:3000)
 *   BENCH_UID   - dev user id (default 00000000-0000-0000-0000-000000000000)
 *   BENCH_SAMPLE - sample count (default 50)
 *
 * Exit codes:
 *   0 - all SLAs met (when --gate) or just informational (no --gate)
 *   1 - SLA breach (when --gate)
 *   2 - script error (e.g. server unreachable)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const FORMAT = getArg('--format', 'text'); // text | json | junit
const GATE = hasFlag('--gate');
const OUT_FILE = getArg('--output', null);   // optional file path
const SAMPLE = parseInt(process.env.BENCH_SAMPLE || getArg('--sample', '50'), 10);
const BASE = process.env.BENCH_URL || getArg('--url', 'http://localhost:3000');
const UID = process.env.BENCH_UID || '00000000-0000-0000-0000-000000000000';

// ── SLA thresholds (from docs/P17_API_BASELINE.md) ──────────────────────────
const SLA = {
  p50_ms: 200,
  p95_ms: 1500,
  p99_ms: 8000,    // hard cap = timeout budget
  max_errors: 0,
};

// ── Sample collection ──────────────────────────────────────────────────────
const msList = [];
const errorList = [];

console.error(`[bench] targeting ${BASE}/api/action/attack × ${SAMPLE} samples`);

for (let i = 0; i < SAMPLE; i++) {
  const nonce = `prod-bench-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
  const t0 = performance.now();
  try {
    const res = await fetch(`${BASE}/api/action/attack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${UID}`,
      },
      body: JSON.stringify({ item_type: 'item_hand', nonce }),
    });
    const t1 = performance.now();
    msList.push(t1 - t0);
    if (!res.ok) {
      errorList.push({ status: res.status, sample: i });
    } else {
      const json = await res.json();
      if (!json.ok) errorList.push({ code: json.error?.code, sample: i });
    }
  } catch (e) {
    msList.push(-1);
    errorList.push({ msg: e?.message ?? String(e), sample: i });
  }
  if ((i + 1) % 10 === 0) console.error(`[bench] ${i + 1}/${SAMPLE} done`);
}

// ── Compute stats ──────────────────────────────────────────────────────────
const valid = msList.filter((m) => m >= 0).sort((a, b) => a - b);
const pick = (p) => valid[Math.min(valid.length - 1, Math.floor(valid.length * p))];
const stats = {
  samples: SAMPLE,
  errors: errorList.length,
  min_ms: round(valid[0] ?? 0),
  avg_ms: round(valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : 0),
  p50_ms: round(pick(0.50)),
  p90_ms: round(pick(0.90)),
  p95_ms: round(pick(0.95)),
  p99_ms: round(pick(0.99)),
  max_ms: round(valid[valid.length - 1] ?? 0),
  sampled_at: new Date().toISOString(),
  base_url: BASE,
};

const breaches = [];
if (stats.errors > SLA.max_errors) breaches.push(`errors ${stats.errors} > ${SLA.max_errors}`);
if (stats.p50_ms > SLA.p50_ms) breaches.push(`p50 ${stats.p50_ms}ms > ${SLA.p50_ms}ms`);
if (stats.p95_ms > SLA.p95_ms) breaches.push(`p95 ${stats.p95_ms}ms > ${SLA.p95_ms}ms`);
if (stats.p99_ms > SLA.p99_ms) breaches.push(`p99 ${stats.p99_ms}ms > ${SLA.p99_ms}ms (HARD CAP)`);

stats.sla_breaches = breaches;
stats.sla_ok = breaches.length === 0;

// ── Format output ──────────────────────────────────────────────────────────
let output = '';
if (FORMAT === 'json') {
  output = JSON.stringify({ stats, errors: errorList.slice(0, 8) }, null, 2);
} else if (FORMAT === 'junit') {
  output = renderJUnit(stats, errorList);
} else {
  // text (default)
  output = [
    '--- benchmark results ---',
    `samples : ${stats.samples}`,
    `errors  : ${stats.errors}`,
    `min ms  : ${stats.min_ms.toFixed(1)}`,
    `avg ms  : ${stats.avg_ms.toFixed(1)}`,
    `p50 ms  : ${stats.p50_ms.toFixed(1)}`,
    `p90 ms  : ${stats.p90_ms.toFixed(1)}`,
    `p95 ms  : ${stats.p95_ms.toFixed(1)}`,
    `p99 ms  : ${stats.p99_ms.toFixed(1)}`,
    `max ms  : ${stats.max_ms.toFixed(1)}`,
  ].join('\n');
  if (breaches.length) {
    output += '\n\n!!! SLA BREACHES !!!';
    for (const b of breaches) output += `\n  - ${b}`;
  }
  if (errorList.length) output += `\nerrors[]: ${JSON.stringify(errorList.slice(0, 8))}`;
}

if (OUT_FILE) {
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, output, 'utf-8');
  console.error(`[bench] wrote ${OUT_FILE}`);
}

console.log(output);

// ── Exit code ──────────────────────────────────────────────────────────────
if (GATE && breaches.length > 0) {
  console.error(`\n[bench] GATE FAILED: ${breaches.length} SLA breach(es)`);
  process.exit(1);
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function renderJUnit(stats, errors) {
  const testName = `bench.${new URL(stats.base_url).host || 'localhost'}.attack`;
  const failures = stats.sla_ok ? '' : `<failure type="SLA_BREACH" message="${escapeXml(stats.sla_breaches.join('; '))}"/>`;
  const errorXml = errors.length
    ? `<system-err>${escapeXml(JSON.stringify(errors.slice(0, 5)))}</system-err>`
    : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites>`,
    `  <testsuite name="${escapeXml(testName)}" tests="1" failures="${stats.sla_ok ? 0 : 1}" errors="${errors.length}" time="${(stats.avg_ms / 1000).toFixed(3)}">`,
    `    <testcase name="attack-latency" classname="${escapeXml(testName)}">`,
    `      ${failures}`,
    `      <system-out>p50=${stats.p50_ms}ms p95=${stats.p95_ms}ms p99=${stats.p99_ms}ms errors=${stats.errors}</system-out>`,
    `      ${errorXml}`,
    `    </testcase>`,
    `  </testsuite>`,
    `</testsuites>`,
  ].join('\n');
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}