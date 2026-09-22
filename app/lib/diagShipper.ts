'use client';

// ════════════════════════════════════════════════════════════════════════════════
// DIAG LOG SHIPPER (v1.6 — 2026-07-23)
//
// Why this exists: customer repros "弹窗反复弹出" with no console capture in
// production. Code changes are guesses until we see the actual event timeline.
// This shipper batches `console.log` events from a small allow-list of sources
// (modalStore, SubPageModal, BattleLayout) and POSTs them to /api/diag/client-log
// so we can `pm2 logs repark-h5 | grep DIAG` to see the exact mount/open sequence.
//
// Self-throttling: at most one in-flight POST at a time, max 50 events/flush,
// flush every 1.5s OR on a hard `flush()` call. Uses `fetch` (not
// fetchWithTimeout) intentionally — diagnostic traffic must never block the
// app or trigger the user-visible toast layer.
// ════════════════════════════════════════════════════════════════════════════════

const ENDPOINT = '/api/diag/client-log';
const FLUSH_MS = 1500;
const MAX_BATCH = 50;
const MAX_QUEUE = 500;

interface DiagEvent {
  ts: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
  stack?: string;
}

const sessionId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

let queue: DiagEvent[] = [];
let inFlight = false;
let flushTimer: number | null = null;

function scheduleFlush() {
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_MS);
}

async function flush() {
  if (inFlight) return;
  if (queue.length === 0) return;
  inFlight = true;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, origin: 'shipper', events: batch }),
    });
  } catch {
    // Re-queue on failure (best-effort) but cap to avoid unbounded growth
    if (queue.length < MAX_QUEUE) {
      queue.unshift(...batch);
    }
  } finally {
    inFlight = false;
    if (queue.length > 0) scheduleFlush();
  }
}

export function shipDiag(origin: string, level: DiagEvent['level'], msg: string, stack?: string) {
  if (queue.length >= MAX_QUEUE) return; // drop new events under pressure
  queue.push({ ts: Date.now(), level, msg, stack });
  scheduleFlush();
}

export function flushDiagNow() {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  void flush();
}

// Best-effort flush on tab hide / page unload
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => flushDiagNow());
  window.addEventListener('beforeunload', () => flushDiagNow());
}
