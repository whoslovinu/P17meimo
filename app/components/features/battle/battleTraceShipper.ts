'use client';

// ════════════════════════════════════════════════════════════════════════════════
// BATTLE RUNTIME TRACE SHIPPER (v1.0 — 2026-08-26)
//
// Purpose: forward the [TRACE] console.log events already deployed in
// LoadingScreen / SpineViewer / BattleLayout to the existing
// /api/diag/client-log endpoint so they appear in `pm2 logs repark-h5`
// as `[DIAG][INFO][battle-trace]…` lines. This lets the operator
// reconstruct a real /battle cold-start timeline without needing a
// local browser console.
//
// Design rules (per Commander, 2026-08-25):
//   1. Fire-and-forget only — never await, never block Loading / PIXI / state.
//   2. Snapshot is read at ship time, not at log time — one source of truth.
//   3. sessionId is per /battle mount; survives across HMR re-renders only
//      within the same page lifetime. Cleared on unload.
//   4. NO new diag API. Reuses /api/diag/client-log verbatim.
//   5. Diag system failure MUST NOT affect the user. All errors are swallowed.
// ════════════════════════════════════════════════════════════════════════════════

import { shipDiag, flushDiagNow } from '@/app/lib/diagShipper';

export interface BattleCanvasSnapshot {
  exists: boolean;
  width: number | null;
  height: number | null;
  clientWidth: number | null;
  clientHeight: number | null;
  opacity: string | null;
  display: string | null;
  visibility: string | null;
}

export interface BattleGateSnapshot {
  battleInit: boolean;
  isSpineLoaded: boolean;
  isStage2Loaded: boolean;
  isStage3Loaded: boolean;
  isStage4Loaded: boolean;
  isAssetLoaded: boolean;
  isCurrentModelRendered: boolean;
  isReadyForLiveView: boolean;
  canvas: BattleCanvasSnapshot;
}

let sessionId: string | null = null;

export function getBattleTraceSessionId(): string {
  if (sessionId !== null) return sessionId;
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    sessionId = `battle-trace-${(crypto as Crypto).randomUUID()}`;
  } else {
    sessionId = `battle-trace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return sessionId;
}

function snapshotCanvas(): BattleCanvasSnapshot {
  if (typeof document === 'undefined') {
    return { exists: false, width: null, height: null, clientWidth: null, clientHeight: null, opacity: null, display: null, visibility: null };
  }
  try {
    const list = Array.from(document.querySelectorAll('canvas'));
    const found = list.find((c) => c.width > 0 && c.height > 0) ?? list[0] ?? null;
    if (!found) {
      return { exists: false, width: null, height: null, clientWidth: null, clientHeight: null, opacity: null, display: null, visibility: null };
    }
    const cs = window.getComputedStyle(found);
    return {
      exists: true,
      width: found.width,
      height: found.height,
      clientWidth: found.clientWidth,
      clientHeight: found.clientHeight,
      opacity: cs.opacity,
      display: cs.display,
      visibility: cs.visibility,
    };
  } catch {
    return { exists: false, width: null, height: null, clientWidth: null, clientHeight: null, opacity: null, display: null, visibility: null };
  }
}

function buildMsg(event: string, gate: Omit<BattleGateSnapshot, 'canvas'>, sid: string): string {
  return JSON.stringify({
    // Diagnostic-only. Server-side /api/diag/client-log slices sessionId to
    // 12 chars in its stdout prefix, which collapses every battle-trace-*
    // session to "battle-trace". We re-embed the FULL sessionId inside the
    // payload so downstream tooling (and pm2-grep scripts) can disambiguate
    // concurrent / concurrent-real sessions without changing server API.
    traceSessionId: sid,
    event,
    pathname: typeof window !== 'undefined' ? window.location.pathname : null,
    visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
    battleInit: gate.battleInit,
    isSpineLoaded: gate.isSpineLoaded,
    isStage2Loaded: gate.isStage2Loaded,
    isStage3Loaded: gate.isStage3Loaded,
    isStage4Loaded: gate.isStage4Loaded,
    isAssetLoaded: gate.isAssetLoaded,
    isCurrentModelRendered: gate.isCurrentModelRendered,
    isReadyForLiveView: gate.isReadyForLiveView,
  });
}

// Canonical allow-list. Anything not in this set is dropped at the source
// to prevent log spam or accidental PII leakage.
const ALLOWED_EVENTS = new Set<string>([
  '[LoadingScreen] progress=100',
  '[LoadingScreen] dismiss-blocked-no-canvas',
  '[LoadingScreen] exit-start',
  '[LoadingScreen] gone=true',
  '[LoadingScreen] onComplete',
  '[SpineViewer] pixi-init-complete',
  '[SpineViewer] bg-mounted',
  '[SpineViewer] character-mounted',
  '[SpineViewer] halo-mounted',
  '[SpineViewer] stage2-mounted',
  '[SpineViewer] stage3-mounted',
  '[SpineViewer] stage4-mounted',
  '[SpineViewer] explicit-first-render-called',
  '[SpineViewer] explicit-first-render-FAILED',
  '[SpineViewer] first-frame-confirmed',
  '[SpineViewer] afterrender-fired',   // LEGACY NAME — kept for PM2 query continuity; actual trigger is double-RAF
  '[BattleLayout] first-visible-frame-ready',
  '[BattleLayout] render-state',
  '[BattleLayout] canvas-dom',
]);

/**
 * Fire-and-forget ship a single TRACE event to /api/diag/client-log.
 * Caller MUST NOT await this. Errors are swallowed.
 */
export function shipBattleTrace(
  event: string,
  gate: Omit<BattleGateSnapshot, 'canvas'>,
  includeCanvas: boolean = false,
): void {
  try {
    if (!ALLOWED_EVENTS.has(event)) return;
    const sid = getBattleTraceSessionId();
    const canvas = includeCanvas ? snapshotCanvas() : null;
    const msg = buildMsg(event, gate, sid);
    // Embed canvas into a follow-up field by overloading the msg with a
    // delimiter. Easier: just append after the JSON via the existing
    // shipDiag signature — but shipDiag takes (origin, level, msg).
    // We use the msg field to carry all structured data; if canvas is
    // requested we serialize it as a second-line marker. The server-side
    // diag client-log handler already prints msg as a single line.
    // To preserve parsing simplicity, we collapse canvas into the JSON
    // when requested.
    const finalMsg = canvas
      ? JSON.stringify({
          traceSessionId: sid,
          event,
          pathname: typeof window !== 'undefined' ? window.location.pathname : null,
          visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
          battleInit: gate.battleInit,
          isSpineLoaded: gate.isSpineLoaded,
          isStage2Loaded: gate.isStage2Loaded,
          isStage3Loaded: gate.isStage3Loaded,
          isStage4Loaded: gate.isStage4Loaded,
          isAssetLoaded: gate.isAssetLoaded,
          isCurrentModelRendered: gate.isCurrentModelRendered,
          isReadyForLiveView: gate.isReadyForLiveView,
          canvas,
        })
      : msg;
    shipDiag('battle-trace', 'info', finalMsg);
  } catch {
    // Shipper must never throw into the caller.
  }
}

/**
 * Force a synchronous flush of the in-flight diag queue to the server.
 * Best-effort. Use on pagehide / visibilitychange / explicit lifecycle hooks.
 */
export function flushBattleTrace(): void {
  try { flushDiagNow(); } catch { /* noop */ }
}
