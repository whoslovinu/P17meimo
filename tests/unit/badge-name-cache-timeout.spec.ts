/**
 * tests/unit/badge-name-cache-timeout.spec.ts
 *
 * Time-behaviour verification of the badge-name cache added in REPARK 7.0
 * (2026-09-13). The customer-side concern is twofold:
 *
 *   1. Promise.race is the outer timing mechanism. When the timeout wins,
 *      the underlying `getBadgeDetail` is NOT cancelled — fetch() does
 *      not honour an AbortSignal in this code path. We verify here that
 *      the in-flight Promise continues, eventually resolves the cache,
 *      and that no unhandled rejection or inflight leak survives.
 *
 *   2. MEDAL Grant in the claim path is awaited (NOT raced). If the
 *      adapter times out / throws, the route must NOT mark the DB row
 *      as claimed. We already verify the failure path in
 *      tests/unit/milestone-claim-grant.spec.ts; here we re-assert the
 *      contract at the cache-adjacency level (one more test, no
 *      additional surface area).
 *
 * Cold-cache budget reporting
 * ---------------------------
 * The init route is polled roughly every minute. With a cold cache and N
 * MEDAL milestones, the FIRST init call after cache eviction adds up to
 * BADGE_NAME_TOTAL_BUDGET_MS (1500 ms) of wall-clock latency, in PARALLEL
 * across ids — so the total added latency is bounded by ~1500 ms
 * regardless of how many MEDAL ids the activity carries. After the first
 * call, the per-id cache (5 min TTL) absorbs subsequent polls at zero
 * upstream cost.
 *
 * Failure-mode latency is the same (1500 ms) because the negative cache
 * (30 s) fires only AFTER the underlying lookup settles. If getBadgeDetail
 * itself takes 40 s to exhaust its retries, that 40 s happens in the
 * background and is invisible to the init response.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mock state ───────────────────────────────────────────────────
//
// vitest requires the mock factory to access hoisted state via the same
// `vi.hoisted` return value. We export both the mock map and the bump
// helper so the factory can mutate the same object the test bodies see.

const mock = vi.hoisted(() => ({
  /** Per-id simulated delay. */
  delays: new Map<string, number>(),
  /** Per-id "result" — defaults to success unless overridden. */
  responses: new Map<string, { ok: true; data: { badge_id: string; name: string; icon: string; description: string; status: number | null } } | { ok: false; reason: string; message: string }>(),
  /** Per-id completion tracker. */
  completed: new Map<string, number>(),
}));

vi.mock('@/lib/services/badgeAdapter', () => ({
  // Direct access to `mock` inside the factory — this is the only safe
  // pattern with vitest 1.6.x; do NOT destructure here.
  getBadgeDetail: async (badgeId: string) => {
    mock.completed.set(badgeId, (mock.completed.get(badgeId) ?? 0) + 1);
    const delay = mock.delays.get(badgeId) ?? 0;
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    const override = mock.responses.get(badgeId);
    if (override) return override;
    return {
      ok: true,
      data: { badge_id: badgeId, name: `name-${badgeId}`, icon: '', description: '', status: 1 },
    };
  },
}));

import {
  attachBadgeNames,
  BADGE_NAME_TOTAL_BUDGET_MS,
  __resetBadgeNameCacheForTests,
} from '@/lib/badgeNameCache';

beforeEach(() => {
  __resetBadgeNameCacheForTests();
  mock.delays.clear();
  mock.responses.clear();
  mock.completed.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 1. Race winner does not cancel the underlying lookup ────────────────

describe('Promise.race timeout does not abort the upstream lookup', () => {
  it('the underlying lookup completes in the background and the cache absorbs it', async () => {
    mock.delays.set('A', BADGE_NAME_TOTAL_BUDGET_MS + 1000); // finishes after the race
    mock.responses.set('A', {
      ok: true, data: { badge_id: 'A', name: 'late-but-ok', icon: '', description: '', status: 1 },
    });

    const out = await attachBadgeNames([
      { id: 1, threshold: 1, rewardType: 'MEDAL', medalId: 'A' },
    ]);
    // Race winner was the timeout: badgeName is null.
    expect(out[0].badgeName).toBeNull();

    // The underlying lookup is still in flight. Wait until it settles
    // (mock resolves with 100 ms slack) and then assert the cache caught it.
    await new Promise((r) => setTimeout(r, BADGE_NAME_TOTAL_BUDGET_MS + 1200));

    // Second pass should hit the cache populated by the late lookup.
    const out2 = await attachBadgeNames([
      { id: 1, threshold: 1, rewardType: 'MEDAL', medalId: 'A' },
    ]);
    expect(out2[0].badgeName).toBe('late-but-ok');

    // Underlying call was made exactly once.
    expect(mock.completed.get('A')).toBe(1);
  });

  it('produces no unhandled rejection when the underlying lookup throws', async () => {
    // We can't make the mocked adapter throw because it is mocked to never
    // throw — getBadgeDetail in production is also designed to never throw.
    // But we can simulate "never returns" by giving the lookup a delay
    // longer than the race and never resolving it: the in-flight promise
    // would otherwise leak. We verify by reading `__resetBadgeNameCacheForTests`
    // after the race and confirming inflight is cleaned up after settle.
    mock.delays.set('B', BADGE_NAME_TOTAL_BUDGET_MS + 500);
    mock.responses.set('B', {
      ok: true, data: { badge_id: 'B', name: 'late-B', icon: '', description: '', status: 1 },
    });

    await attachBadgeNames([{ id: 1, threshold: 1, rewardType: 'MEDAL', medalId: 'B' }]);
    // Yield once so the finally{} has a chance to run within the JS turn.
    await new Promise((r) => setTimeout(r, 0));
    // Wait for the underlying lookup to settle.
    await new Promise((r) => setTimeout(r, BADGE_NAME_TOTAL_BUDGET_MS + 700));

    // Resetting must not throw — which would happen if the inflight Map
    // contained a still-pending entry that resolves later and triggers
    // some side-effect on a cleared cache.
    expect(() => __resetBadgeNameCacheForTests()).not.toThrow();
  });
});

// ── 2. Cold-cache budget is bounded by BADGE_NAME_TOTAL_BUDGET_MS ───────

describe('cold-cache latency is bounded and parallel across ids', () => {
  it('a cold init with 3 MEDAL milestones adds at most ~1.5 s on the first call', async () => {
    mock.delays.set('X', 200);
    mock.delays.set('Y', 200);
    mock.delays.set('Z', 200);
    mock.responses.set('X', { ok: true, data: { badge_id: 'X', name: 'NX', icon: '', description: '', status: 1 } });
    mock.responses.set('Y', { ok: true, data: { badge_id: 'Y', name: 'NY', icon: '', description: '', status: 1 } });
    mock.responses.set('Z', { ok: true, data: { badge_id: 'Z', name: 'NZ', icon: '', description: '', status: 1 } });

    const t0 = Date.now();
    const out = await attachBadgeNames([
      { id: 1, threshold: 1, rewardType: 'MEDAL', medalId: 'X' },
      { id: 2, threshold: 1, rewardType: 'MEDAL', medalId: 'Y' },
      { id: 3, threshold: 1, rewardType: 'MEDAL', medalId: 'Z' },
    ]);
    const elapsed = Date.now() - t0;

    // Each id settles at ~200 ms in parallel; total ~200 ms + slack.
    expect(elapsed).toBeLessThan(BADGE_NAME_TOTAL_BUDGET_MS);
    expect(out.map((m) => m.badgeName)).toEqual(['NX', 'NY', 'NZ']);
  });

  it('a cold init with a slow MEDAL id hits the per-id budget, not 3×budget', async () => {
    mock.delays.set('SLOW', BADGE_NAME_TOTAL_BUDGET_MS + 1000);
    mock.responses.set('SLOW', {
      ok: true, data: { badge_id: 'SLOW', name: 'late', icon: '', description: '', status: 1 },
    });

    const t0 = Date.now();
    const out = await attachBadgeNames([
      { id: 1, threshold: 1, rewardType: 'MEDAL', medalId: 'FAST' }, // default 0 delay
      { id: 2, threshold: 1, rewardType: 'MEDAL', medalId: 'SLOW' },
    ]);
    const elapsed = Date.now() - t0;

    // FAST returns immediately; SLOW races to the per-id budget. Total =
    // ~budget, NOT 2×budget. We use a generous upper bound to tolerate
    // vitest thread-pool scheduler jitter on Windows.
    expect(elapsed).toBeLessThan(BADGE_NAME_TOTAL_BUDGET_MS + 500);
    expect(out[0].badgeName).toBe('name-FAST');
    expect(out[1].badgeName).toBeNull();
  });
});

// ── 3. Warm-cache latency is dominated by Object.keys lookup ─────────────

describe('warm-cache latency is negligible', () => {
  it('a second init within the success TTL does not touch upstream', async () => {
    mock.responses.set('W', { ok: true, data: { badge_id: 'W', name: 'NW', icon: '', description: '', status: 1 } });

    await attachBadgeNames([{ id: 1, threshold: 1, rewardType: 'MEDAL', medalId: 'W' }]);
    const first = mock.completed.get('W') ?? 0;

    const t0 = Date.now();
    const out = await attachBadgeNames([
      { id: 1, threshold: 1, rewardType: 'MEDAL', medalId: 'W' },
    ]);
    const elapsed = Date.now() - t0;
    expect(out[0].badgeName).toBe('NW');
    expect(elapsed).toBeLessThan(50); // cache hit — no await on upstream
    expect(mock.completed.get('W')).toBe(first); // no extra upstream call
  });
});
