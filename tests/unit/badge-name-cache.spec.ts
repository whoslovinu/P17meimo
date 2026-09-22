/**
 * tests/unit/badge-name-cache.spec.ts
 *
 * Unit-level verification of the badge name resolution contract added in
 * REPARK 7.0 (2026-09-13). Pure-mock: never touches the real Main Station
 * or the local DB. The goal is to prove the four invariants the implementation
 * is supposed to uphold:
 *
 *   1. Successful lookups are returned with the upstream name and stay
 *      warm for the documented TTL.
 *   2. Failed lookups (NOT_FOUND / NETWORK_ERROR / arbitrary exceptions)
 *      do NOT throw and do NOT spam the upstream on repeat calls inside
 *      the negative-cache window.
 *   3. The init-time overall budget caps each per-id resolution at
 *      BADGE_NAME_TOTAL_BUDGET_MS even when the upstream is slow.
 *   4. ENERGY milestones are short-circuited and never hit the upstream.
 *   5. In-flight de-duplication coalesces concurrent calls for the same id
 *      into a single upstream hit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mock state ────────────────────────────────────────────────────
//
// `vi.hoisted` lets us share mutable state between the mock factory below
// and the test bodies without tripping the "factory cannot reference
// out-of-scope variables" lint.

const mock = vi.hoisted(() => {
  type GetBadgeDetail = (badgeId: string) => Promise<
    | { ok: true; data: { badge_id: string; name: string; icon: string; description: string; status: number | null } }
    | { ok: false; reason: string; message: string }
  >;
  const state = {
    /** Per-id manual override: what should getBadgeDetail return next. */
    responses: new Map<string, Awaited<ReturnType<GetBadgeDetail>>>(),
    /** Default response when `responses` has no entry for an id. */
    defaultResponse: {
      ok: true as const,
      data: { badge_id: 'X', name: '默认勋章', icon: '', description: '', status: 1 },
    },
    /** Per-id sleep so we can simulate a slow upstream. */
    delays: new Map<string, number>(),
    /** How many times the mock was invoked, per id. */
    callCounts: new Map<string, number>(),
  };
  return { state };
});

// ── Module mock wiring ────────────────────────────────────────────────────
//
// We replace the adapter module before importing the cache so the cache
// sees a stable, deterministic `getBadgeDetail`.

vi.mock('@/lib/services/badgeAdapter', () => {
  return {
    getBadgeDetail: async (badgeId: string) => {
      const { state } = mock;
      state.callCounts.set(badgeId, (state.callCounts.get(badgeId) ?? 0) + 1);
      const delay = state.delays.get(badgeId) ?? 0;
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      const override = state.responses.get(badgeId);
      return (override ?? state.defaultResponse) as Awaited<
        ReturnType<typeof import('@/lib/services/badgeAdapter').getBadgeDetail>
      >;
    },
  };
});

// ── Imports under test (after mock wiring) ─────────────────────────────────

import {
  attachBadgeNames,
  BADGE_NAME_TOTAL_BUDGET_MS,
  __resetBadgeNameCacheForTests,
} from '@/lib/badgeNameCache';

const ID_CHAMPION    = 'badge-champion';
const ID_RUNNER_UP   = 'badge-runner-up';
const ID_THIRD       = 'badge-third';
const ID_INACTIVE    = 'badge-offline';
const ID_NOT_FOUND   = 'badge-missing';
const ID_SLOW        = 'badge-slow';

// ── Fixtures ───────────────────────────────────────────────────────────────

function mixedMilestones() {
  return [
    { id: 1, threshold: 1000,  rewardType: 'ENERGY' as const, energyValue: 500 },
    { id: 2, threshold: 5000,  rewardType: 'MEDAL'  as const, medalId: ID_CHAMPION },
    { id: 3, threshold: 8000,  rewardType: 'MEDAL'  as const, medalId: ID_RUNNER_UP },
    { id: 4, threshold: 12000, rewardType: 'MEDAL'  as const, medalId: ID_THIRD },
    { id: 5, threshold: 15000, rewardType: 'MEDAL'  as const, medalId: ID_INACTIVE },
    { id: 6, threshold: 20000, rewardType: 'MEDAL'  as const, medalId: ID_NOT_FOUND },
    { id: 7, threshold: 25000, rewardType: 'ENERGY' as const, energyValue: 2000 },
    { id: 8, threshold: 30000, rewardType: 'MEDAL'  as const, medalId: ID_SLOW },
    // Edge: MEDAL row whose medalId is literally "undefined" / null.
    { id: 9, threshold: 40000, rewardType: 'MEDAL'  as const, medalId: 'undefined' },
    { id: 10, threshold: 50000, rewardType: 'MEDAL'  as const, medalId: '' },
  ];
}

// ── Reset between tests ───────────────────────────────────────────────────

beforeEach(() => {
  __resetBadgeNameCacheForTests();
  mock.state.responses.clear();
  mock.state.delays.clear();
  mock.state.callCounts.clear();
  mock.state.defaultResponse = {
    ok: true,
    data: { badge_id: 'X', name: '默认勋章', icon: '', description: '', status: 1 },
  };
  // Per-id stubs for the test fixtures.
  mock.state.responses.set(ID_CHAMPION,  { ok: true, data: { badge_id: ID_CHAMPION,  name: '冠军',     icon: '', description: '', status: 1 } });
  mock.state.responses.set(ID_RUNNER_UP, { ok: true, data: { badge_id: ID_RUNNER_UP, name: '亚军',     icon: '', description: '', status: 1 } });
  mock.state.responses.set(ID_THIRD,     { ok: true, data: { badge_id: ID_THIRD,     name: '季军',     icon: '', description: '', status: 1 } });
  mock.state.responses.set(ID_INACTIVE,  { ok: false, reason: 'INACTIVE',   message: 'offline' });
  mock.state.responses.set(ID_NOT_FOUND, { ok: false, reason: 'NOT_FOUND',  message: 'no record' });
  // ID_SLOW will inherit the default (success) but with a delay > budget.
  mock.state.delays.set(ID_SLOW, BADGE_NAME_TOTAL_BUDGET_MS + 500);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 1. Happy path ─────────────────────────────────────────────────────────

describe('attachBadgeNames — happy path', () => {
  it('returns Main Station names for MEDAL milestones', async () => {
    const out = await attachBadgeNames(mixedMilestones());

    // ENERGY rows always have badgeName=null and never hit the upstream.
    const e0 = out.find((m) => m.id === 1)!;
    const e1 = out.find((m) => m.id === 7)!;
    expect(e0.badgeName).toBeNull();
    expect(e1.badgeName).toBeNull();

    // MEDAL rows resolve to the upstream-provided name.
    expect(out.find((m) => m.id === 2)!.badgeName).toBe('冠军');
    expect(out.find((m) => m.id === 3)!.badgeName).toBe('亚军');
    expect(out.find((m) => m.id === 4)!.badgeName).toBe('季军');
  });

  it('returns null for INACTIVE and NOT_FOUND failures without throwing', async () => {
    const out = await attachBadgeNames(mixedMilestones());
    expect(out.find((m) => m.id === 5)!.badgeName).toBeNull();
    expect(out.find((m) => m.id === 6)!.badgeName).toBeNull();
  });

  it('returns null for invalid medalId values without consulting the upstream', async () => {
    const out = await attachBadgeNames(mixedMilestones());
    expect(out.find((m) => m.id === 9)!.badgeName).toBeNull();  // "undefined"
    expect(out.find((m) => m.id === 10)!.badgeName).toBeNull(); // ""
    // Neither id should have appeared in the call counts.
    expect(mock.state.callCounts.has('undefined')).toBe(false);
    expect(mock.state.callCounts.has('')).toBe(false);
  });

  it('ENERGY milestones do not call getBadgeDetail', async () => {
    await attachBadgeNames(mixedMilestones());
    // ENERGY ids are 1 and 7; nothing in mock.state.responses references them,
    // so the default upstream response would be returned IF getBadgeDetail
    // were ever called. zero call count for any non-medal id is what we want.
    expect(mock.state.callCounts.has(ID_CHAMPION)).toBe(true);
    expect(mock.state.callCounts.has(ID_RUNNER_UP)).toBe(true);
    // No spurious call for "1" / "7" / etc — we never look those up.
    expect(mock.state.callCounts.has('1')).toBe(false);
    expect(mock.state.callCounts.has('7')).toBe(false);
  });
});

// ── 1b. Description side-car (REPARK 7.0 2026-09-21) ──────────────────────

describe('attachBadgeNames — badgeDescription (MEDAL CARD POLISH V2)', () => {
  it('normalises empty upstream descriptions to null for MEDAL milestones', async () => {
    // Existing fixtures set description: '' for champion / runner-up / third.
    // The contract is "empty / whitespace → null" so /admin/users can hide
    // the description row cleanly.
    const out = await attachBadgeNames(mixedMilestones());
    expect(out.find((m) => m.id === 2)!.badgeDescription).toBeNull();
    expect(out.find((m) => m.id === 3)!.badgeDescription).toBeNull();
    expect(out.find((m) => m.id === 4)!.badgeDescription).toBeNull();
  });

  it('passes real descriptions through unchanged when non-empty', async () => {
    mock.state.responses.set(ID_CHAMPION, {
      ok: true,
      data: {
        badge_id: ID_CHAMPION,
        name: '魅魔杯冠军',
        icon: '',
        description: '魅魔杯冠军专属勋章，永久有效，携带渐变色昵称，象征赛事最高荣誉。',
        status: 1,
      },
    });
    const out = await attachBadgeNames([
      { id: 2, threshold: 5000, rewardType: 'MEDAL', medalId: ID_CHAMPION },
    ]);
    expect(out[0].badgeDescription).toBe(
      '魅魔杯冠军专属勋章，永久有效，携带渐变色昵称，象征赛事最高荣誉。',
    );
    expect(out[0].badgeName).toBe('魅魔杯冠军');
  });

  it('returns null badgeDescription for ENERGY milestones', async () => {
    const out = await attachBadgeNames([
      { id: 1, threshold: 1000, rewardType: 'ENERGY', energyValue: 500 },
    ]);
    expect(out[0].badgeDescription).toBeNull();
    expect(out[0].badgeName).toBeNull();
  });

  it('normalises empty / whitespace descriptions to null', async () => {
    mock.state.responses.set(ID_CHAMPION, {
      ok: true,
      data: { badge_id: ID_CHAMPION, name: 'X', icon: '', description: '   ', status: 1 },
    });
    const out = await attachBadgeNames([
      { id: 2, threshold: 5000, rewardType: 'MEDAL', medalId: ID_CHAMPION },
    ]);
    expect(out[0].badgeDescription).toBeNull();
    expect(out[0].badgeName).toBe('X');
  });

  it('returns null badgeDescription for INACTIVE / NOT_FOUND failures', async () => {
    const out = await attachBadgeNames([
      { id: 5, threshold: 15000, rewardType: 'MEDAL', medalId: ID_INACTIVE },
      { id: 6, threshold: 20000, rewardType: 'MEDAL', medalId: ID_NOT_FOUND },
    ]);
    expect(out[0].badgeDescription).toBeNull();
    expect(out[1].badgeDescription).toBeNull();
  });

  it('returns null badgeDescription for invalid medalId values without consulting upstream', async () => {
    const out = await attachBadgeNames([
      { id: 9,  threshold: 40000, rewardType: 'MEDAL', medalId: 'undefined' },
      { id: 10, threshold: 50000, rewardType: 'MEDAL', medalId: '' },
    ]);
    expect(out[0].badgeDescription).toBeNull();
    expect(out[1].badgeDescription).toBeNull();
  });

  it('caches the description so repeat init calls do not re-hit upstream', async () => {
    await attachBadgeNames([
      { id: 2, threshold: 5000, rewardType: 'MEDAL', medalId: ID_CHAMPION },
    ]);
    const callsAfterFirst = mock.state.callCounts.get(ID_CHAMPION) ?? 0;
    await attachBadgeNames([
      { id: 2, threshold: 5000, rewardType: 'MEDAL', medalId: ID_CHAMPION },
    ]);
    const callsAfterSecond = mock.state.callCounts.get(ID_CHAMPION) ?? 0;
    expect(callsAfterFirst).toBe(1);
    expect(callsAfterSecond).toBe(1);
  });
});

// ── 2. Cache + negative cache ─────────────────────────────────────────────

describe('attachBadgeNames — caching', () => {
  it('caches successful lookups so repeat init calls do not re-hit upstream', async () => {
    const first  = await attachBadgeNames(mixedMilestones());
    const second = await attachBadgeNames(mixedMilestones());

    expect(first.find((m) => m.id === 2)!.badgeName).toBe('冠军');
    expect(second.find((m) => m.id === 2)!.badgeName).toBe('冠军');

    // First pass calls each medal id once; second pass should hit the cache
    // and add zero new upstream calls.
    const championCallsAfterFirst  = mock.state.callCounts.get(ID_CHAMPION) ?? 0;
    await attachBadgeNames(mixedMilestones()); // third pass
    const championCallsAfterThird  = mock.state.callCounts.get(ID_CHAMPION) ?? 0;
    expect(championCallsAfterFirst).toBe(1);
    expect(championCallsAfterThird).toBe(1);
  });

  it('suppresses repeat failure lookups for the negative-cache window', async () => {
    // First call → upstream says NOT_FOUND, we cache the failure.
    await attachBadgeNames([{ id: 1, threshold: 1, rewardType: 'MEDAL', medalId: ID_NOT_FOUND }]);
    const callsAfterFirst = mock.state.callCounts.get(ID_NOT_FOUND) ?? 0;

    // Second call within the window — must NOT re-hit the upstream.
    await attachBadgeNames([{ id: 1, threshold: 1, rewardType: 'MEDAL', medalId: ID_NOT_FOUND }]);
    const callsAfterSecond = mock.state.callCounts.get(ID_NOT_FOUND) ?? 0;

    expect(callsAfterFirst).toBe(1);
    expect(callsAfterSecond).toBe(1);
  });
});

// ── 3. Per-id budget ──────────────────────────────────────────────────────

describe('attachBadgeNames — total budget', () => {
  it('caps each id at BADGE_NAME_TOTAL_BUDGET_MS even when upstream is slow', async () => {
    const t0 = Date.now();
    const out = await attachBadgeNames([
      { id: 8, threshold: 30000, rewardType: 'MEDAL', medalId: ID_SLOW },
    ]);
    const elapsed = Date.now() - t0;
    // The slow id has a delay of (BUDGET + 500) ms; we must return within the
    // budget + a small slop for setTimeout drift.
    expect(elapsed).toBeLessThan(BADGE_NAME_TOTAL_BUDGET_MS + 250);
    expect(out[0].badgeName).toBeNull();
  });

  it('does NOT serialise ids — multiple slow ids resolve in parallel', async () => {
    const slow = 'badge-slow-parallel';
    mock.state.responses.set(slow, {
      ok: true, data: { badge_id: slow, name: '慢', icon: '', description: '', status: 1 },
    });
    mock.state.delays.set(slow, 300);
    mock.state.delays.set('badge-slow-parallel-2', 300);
    mock.state.responses.set('badge-slow-parallel-2', {
      ok: true, data: { badge_id: 'badge-slow-parallel-2', name: '慢2', icon: '', description: '', status: 1 },
    });

    const t0 = Date.now();
    await attachBadgeNames([
      { id: 1, threshold: 1, rewardType: 'MEDAL', medalId: slow },
      { id: 2, threshold: 1, rewardType: 'MEDAL', medalId: 'badge-slow-parallel-2' },
    ]);
    const elapsed = Date.now() - t0;
    // Parallel: ≈ 300 ms (not 600 ms).
    expect(elapsed).toBeLessThan(BADGE_NAME_TOTAL_BUDGET_MS);
  });
});

// ── 4. In-flight de-duplication ───────────────────────────────────────────

describe('attachBadgeNames — in-flight de-duplication', () => {
  it('coalesces concurrent requests for the same id into one upstream call', async () => {
    // Make the upstream slow enough that two parallel attachBadgeNames calls
    // overlap in the in-flight map.
    mock.state.delays.set(ID_CHAMPION, 100);

    const [a, b] = await Promise.all([
      attachBadgeNames([{ id: 1, threshold: 1, rewardType: 'MEDAL', medalId: ID_CHAMPION }]),
      attachBadgeNames([{ id: 1, threshold: 1, rewardType: 'MEDAL', medalId: ID_CHAMPION }]),
    ]);

    expect(a[0].badgeName).toBe('冠军');
    expect(b[0].badgeName).toBe('冠军');
    // Two concurrent calls for the same id → exactly ONE upstream hit.
    expect(mock.state.callCounts.get(ID_CHAMPION)).toBe(1);
  });
});
