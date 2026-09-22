/**
 * battleResourceLoader — V3 Phase 1 single-flight resource manager
 * ─────────────────────────────────────────────────────────────────────────
 * PURPOSE
 *   Own the acquisition of every Battle resource URL exactly once.
 *   Same normalized URL called 2 / 3 / 10 times concurrently
 *   = ONE underlying fetch (memory → IDB → network).
 *
 * CONTRACT
 *   ensure(url, opts?) → Promise<BattleResourceResult>
 *     - Returns the same in-flight Promise for concurrent callers.
 *     - The returned Blob can be consumed as ArrayBuffer / text / JSON.
 *
 *   getState(url)        → BattleResourceState | null
 *   subscribe(cb)        → unsubscribe()
 *   getSnapshot()        → global snapshot of all known resources
 *   reset()              → clears in-memory state only (IDB untouched)
 *
 * CACHE HIERARCHY (per URL)
 *   1. in-memory resolved Promise  ← single-flight
 *   2. existing IDB blob           ← `getCachedAsset()` from assetCache
 *   3. fetch() with cache:'no-store' (via fetchWithTimeout)
 *
 * URL NORMALIZATION (STEP 2)
 *   - Strips scheme + host  (e.g. "http://98.93.252.250/H501/..." → "/H501/...")
 *   - Preserves query string — versioned URLs like `halo.json?v=v2.0.0`
 *     stay distinct because they intentionally represent new asset revisions.
 *
 * STATE MODEL (STEP 4)
 *   idle    → never requested
 *   loading → fetch in flight
 *   ready   → resolved (memory or IDB or network)
 *   error   → last attempt failed (caller may retry by re-ensure)
 *
 * DEV DIAGNOSTICS (STEP 10)
 *   When `process.env.NODE_ENV !== 'production'`, the loader tracks
 *   per-URL counters and exposes them via `getDiagnostics()`.
 *
 * SCOPE (PHASE 1)
 *   Only BG / Halo / Stage 1 / atlas-page textures are routed here.
 *   Stage II–IV are intentionally NOT migrated yet — they contain
 *   placeholder / fallback behaviour that must be re-examined separately.
 *
 * HARD FREEZE
 *   No changes to:
 *     - PIXI container hierarchy (SpineViewer)
 *     - Character transform / Halo transform / GLITCH GUARD
 *     - LoadingScreen JSX / copy / colors / fonts / spacing / icons
 *     - Spine parsing (PIXI / spine-pixi-v8 / spine-core still owns that)
 */

import { getCachedAsset } from '@/app/lib/assetCache';
import { fetchWithTimeout, FetchError } from '@/app/lib/fetchWithTimeout';

// ─── Status / state ───────────────────────────────────────────────────────────

export type BattleResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface BattleResourceState {
  url: string;             // normalized URL — the canonical key
  status: BattleResourceStatus;
  loadedBytes?: number;
  totalBytes?: number;
  fromCache?: boolean;     // true if resolved from IDB (warm path)
  error?: unknown;
}

export interface BattleResourceResult {
  url: string;             // normalized URL (what was requested)
  blob: Blob;              // the acquired bytes
  fromCache: boolean;      // true when served from IDB
  fromMemory: boolean;     // true when served from a previous in-flight resolution
  elapsedMs: number;
}

export interface EnsureOptions {
  /** Timeout (ms). Default: 8000 (fetchWithTimeout default). 0 disables. */
  timeoutMs?: number;
  /** External AbortSignal — caller-initiated cancel. */
  signal?: AbortSignal;
  /** Force network even if IDB has a cached blob. Default: false. */
  forceNetwork?: boolean;
}

// ─── Internal maps ────────────────────────────────────────────────────────────

const inflight = new Map<string, Promise<BattleResourceResult>>();
const states   = new Map<string, BattleResourceState>();
const subscribers = new Set<(snap: ReadonlyMap<string, BattleResourceState>) => void>();

// ─── Dev diagnostics ──────────────────────────────────────────────────────────

const IS_DEV = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

interface DevCounters {
  ensureCalls: number;
  networkStarts: number;
  cacheHits: number;
  resolved: number;
}

const devCounters = new Map<string, DevCounters>();

function bumpDev(url: string, key: keyof DevCounters, by = 1) {
  if (!IS_DEV) return;
  const cur = devCounters.get(url) ?? { ensureCalls: 0, networkStarts: 0, cacheHits: 0, resolved: 0 };
  cur[key] += by;
  devCounters.set(url, cur);
}

// ─── URL normalization (STEP 2) ───────────────────────────────────────────────

/**
 * Normalize a URL into a canonical key for single-flight lookup.
 *
 * Rules:
 *   - Strip protocol + host  (so `http://x.com/foo` and `/foo` are the same).
 *   - Preserve query string verbatim (versioned assets use `?v=...`).
 *   - Collapse trailing slash (except the root `/`).
 *
 * What we deliberately do NOT do:
 *   - Drop query parameters — `halo.json?v=v2.0.0` is a different resource
 *     than `halo.json` (intentional cache-bust). Merging them would cause
 *     silent asset staleness.
 */
export function normalizeUrl(input: string): string {
  if (!input) return '';
  let s = input;

  // 1. Strip protocol + host
  try {
    // Use URL constructor only when an absolute URL is given; relative URLs
    // would throw or get resolved against an opaque base.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      const u = new URL(s);
      s = u.pathname + u.search;
    }
  } catch {
    /* relative path — leave as-is */
  }

  // 2. Collapse redundant trailing slash (but never strip the root `/`)
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);

  return s;
}

// ─── State helpers ────────────────────────────────────────────────────────────

function setState(url: string, patch: Partial<BattleResourceState>) {
  const prev = states.get(url) ?? { url, status: 'idle' as BattleResourceStatus };
  const next: BattleResourceState = { ...prev, ...patch, url };
  states.set(url, next);
  notify();
}

function notify() {
  if (subscribers.size === 0) return;
  const snap = new Map(states) as ReadonlyMap<string, BattleResourceState>;
  for (const cb of subscribers) {
    try { cb(snap); } catch { /* subscriber error must not break loader */ }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensure the bytes for `url` are available.
 *
 * Concurrent callers with the same normalized URL share ONE acquisition.
 * The returned result carries metadata so callers (LoadingScreen, SpineViewer)
 * can decide how to consume the bytes without re-fetching.
 *
 * Throws on hard failure (network / non-2xx / JSON errors). Cache hits and
 * memory replays never throw.
 */
export async function ensure(
  rawUrl: string,
  opts: EnsureOptions = {},
): Promise<BattleResourceResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error('[BattleResourceLoader] empty URL');

  bumpDev(url, 'ensureCalls');

  // ── Single-flight: same URL in-flight already → return its promise ───────
  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = acquire(url, rawUrl, opts).finally(() => {
    inflight.delete(url);
  });
  inflight.set(url, promise);
  return promise;
}

async function acquire(
  url: string,
  originalUrl: string,
  opts: EnsureOptions,
): Promise<BattleResourceResult> {
  const startedAt = now();

  // ── Mark loading (visible to subscribers) ────────────────────────────────
  setState(url, { status: 'loading', error: undefined });

  let blob: Blob | null = null;
  let fromCache = false;

  // ── IDB check (unless forced network) ────────────────────────────────────
  if (!opts.forceNetwork) {
    try {
      const cached = await getCachedAsset(originalUrl);
      if (cached) {
        blob = cached;
        fromCache = true;
        bumpDev(url, 'cacheHits');
      }
    } catch {
      /* IDB failure → fall through to network, no throw */
    }
  }

  // ── Network fetch if cache missed ────────────────────────────────────────
  if (!blob) {
    bumpDev(url, 'networkStarts');
    try {
      const res = await fetchWithTimeout(originalUrl, {
        rawResponse: true,
        timeoutMs: opts.timeoutMs ?? 8000,
        signal: opts.signal,
      });
      if (!res.raw.ok) {
        throw new FetchError({
          kind: 'HTTP_NON_2XX',
          status: res.raw.status,
          statusText: res.raw.statusText,
          retryable: res.raw.status >= 500,
          reqId: res.reqId,
          url: originalUrl,
          method: 'GET',
          elapsedMs: res.elapsedMs,
        });
      }
      blob = await res.raw.blob();
    } catch (err) {
      setState(url, { status: 'error', error: err });
      throw err;
    }
  }

  const elapsedMs = now() - startedAt;

  bumpDev(url, 'resolved');

  setState(url, {
    status: 'ready',
    loadedBytes: blob.size,
    totalBytes: blob.size,
    fromCache,
    error: undefined,
  });

  return {
    url,
    blob,
    fromCache,
    fromMemory: false, // single-flight re-use is signalled via the inflight Map, not here
    elapsedMs,
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Snapshot the state of one URL (normalized). */
export function getState(rawUrl: string): BattleResourceState | null {
  return states.get(normalizeUrl(rawUrl)) ?? null;
}

/**
 * Subscribe to ALL state transitions. Receives a fresh snapshot Map on
 * each transition. Return the unsubscribe function.
 *
 * The snapshot is a shallow copy; mutating it does not affect loader state.
 */
export function subscribe(
  cb: (snap: ReadonlyMap<string, BattleResourceState>) => void,
): () => void {
  subscribers.add(cb);
  // Fire once on subscribe with current state so consumers can hydrate.
  try { cb(new Map(states) as ReadonlyMap<string, BattleResourceState>); } catch { /* ignore */ }
  return () => { subscribers.delete(cb); };
}

/** Whole-snapshot view of every URL the loader has seen this session. */
export function getSnapshot(): ReadonlyMap<string, BattleResourceState> {
  return new Map(states) as ReadonlyMap<string, BattleResourceState>;
}

/**
 * Reset in-memory state and diagnostics. Does NOT touch IDB.
 * Useful between cold/warm test runs in dev.
 */
export function reset(): void {
  inflight.clear();
  states.clear();
  devCounters.clear();
  notify();
}

// ─── Dev diagnostics ──────────────────────────────────────────────────────────

export interface DevDiagnosticRow {
  url: string;
  ensureCalls: number;
  networkStarts: number;
  cacheHits: number;
  resolved: number;
  /** status === 'ready' ? 1 : 0 — convenience for tabular output */
  ready: 0 | 1;
}

export function getDiagnostics(): DevDiagnosticRow[] {
  if (!IS_DEV) return [];
  const rows: DevDiagnosticRow[] = [];
  for (const [url, c] of devCounters.entries()) {
    const state = states.get(url);
    rows.push({
      url,
      ensureCalls: c.ensureCalls,
      networkStarts: c.networkStarts,
      cacheHits: c.cacheHits,
      resolved: c.resolved,
      ready: state?.status === 'ready' ? 1 : 0,
    });
  }
  // Sort by networkStarts desc then ensureCalls desc — biggest offenders first.
  rows.sort((a, b) => b.networkStarts - a.networkStarts || b.ensureCalls - a.ensureCalls);
  return rows;
}

/**
 * Dev-only: print a tabular report to console. No-op in production.
 * Returns the rows so callers can also forward them to a logger.
 */
export function logDiagnosticsTable(label = 'BattleResourceLoader diagnostics'): DevDiagnosticRow[] {
  const rows = getDiagnostics();
  if (typeof console !== 'undefined' && rows.length > 0) {
    console.groupCollapsed(`[${label}] ${rows.length} URL(s)`);
    console.table(rows);
    console.groupEnd();
  }
  return rows;
}
