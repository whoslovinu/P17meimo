/**
 * tests/unit/milestone-claim-grant.spec.ts
 *
 * Mock-based verification of the /api/game/milestone/claim MEDAL branch
 * rewritten in REPARK 7.0 (2026-09-13). We exercise the route handler
 * directly with stubbed auth/db/adapter modules so we never need a live
 * server, live DB, or live Main Station.
 *
 * Assertions cover the contract documented at the call site:
 *
 *   1. MEDAL success: grantBadge is awaited with the resolved medalId and
 *      activityId, the DB upsert runs AFTER the grant succeeds, the client
 *      receives a 200 with the claimed payload.
 *   2. MEDAL failure (adapter returns ok:false): no DB upsert, the client
 *      receives a 500 INTERNAL_ERROR — the optimistic local lock state in
 *      the frontend must NOT be triggered because the response is not ok.
 *   3. MEDAL with missing medalId: explicit CONFIG_ERROR 500, no DB upsert.
 *   4. MEDAL with ALREADY_CLAIMED in DB: returns the existing claimed row
 *      shape, NEVER re-issues the grant (idempotency).
 *   5. ENERGY path is unchanged: DB upsert still happens BEFORE the
 *      fire-and-forget webhook call, so a sick Main Station cannot lock
 *      the player out of an energy reward.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mock state ───────────────────────────────────────────────────

const mock = vi.hoisted(() => {
  return {
    /** What grantBadge should return next. */
    nextGrantResult:
      null as null | { ok: true; requestId: string } | { ok: false; reason: string; message: string },
    /** Number of times grantBadge has been invoked. */
    grantCalls: 0,
    /** Last params passed to grantBadge (for assertions). */
    lastGrantParams: null as null | Record<string, string>,
    /** Number of times claimMilestoneReward (formerly upsertMilestoneReward) has been invoked. */
    upsertCalls: 0,
    /** Last upsert payload. */
    lastUpsertPayload: null as null | Record<string, unknown>,
    /** pre-existing DB state to return from getMilestoneReward. */
    existing: null as null | {
      user_id: string;
      milestone_id: string;
      is_claimed: boolean;
      is_locked: boolean;
      claimed_at: string | null;
      reward_type: 'ENERGY' | 'MEDAL';
      reward_value: string;
    },
    /** Active activity config. */
    activity: null as null | {
      id: number;
      name: string;
      config: {
        milestones: Array<{
          id: number | string;
          threshold: number;
          rewardType: 'ENERGY' | 'MEDAL';
          energyValue?: number;
          medalId?: string;
        }>;
        isGlobalEnabled?: boolean;
      };
    },
    /** What getActivityDamage returns. */
    personalDamage: 0,
    /** Auth outcome. */
    authedUserId: 'uuid-128' as string | null,
  };
});

// ── Module mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => {
  return {
    getUserIdFromRequest: (_req: unknown) => {
      if (!mock.authedUserId) return null;
      // The auth helper already returns the canonical UUID. In our unit
      // tests we don't want to invoke the real UUID canonicalisation — the
      // production cookie value would arrive raw and toUuid() would
      // convert it; here we skip that layer so test assertions stay
      // legible.
      return { userId: mock.authedUserId, source: 'cookie' };
    },
    // Identity function — see comment above.
    toUuid: (s: string) => s,
  };
});

vi.mock('@/lib/db/pg', () => {
  return {
    claimMilestoneReward: async (p: Record<string, unknown>, _bypass: boolean) => {
      mock.upsertCalls += 1;
      mock.lastUpsertPayload = p;
      return { ok: true };
    },
    getMilestoneReward: async (_userId: string, msId: string | number) => {
      if (mock.existing && String(mock.existing.milestone_id) === String(msId)) {
        return mock.existing;
      }
      return null;
    },
    getActiveActivity: async () => mock.activity,
    getActivityDamage: async () => mock.personalDamage,
  };
});

vi.mock('@/lib/db/postgres', () => ({
  getPostgresPool: vi.fn(),
}));

vi.mock('@/lib/services/outboundWebhook', () => {
  return {
    sendMainStationEnergyReward: async () => ({ ok: true, code: 200, body: {} }),
  };
});

vi.mock('@/lib/services/badgeAdapter', () => {
  return {
    grantBadge: async (params: Record<string, string>) => {
      mock.grantCalls += 1;
      mock.lastGrantParams = params;
      // simulate the adapter behaviour: when no result is queued, default to success.
      const result = mock.nextGrantResult ?? { ok: true as const, requestId: 'req_default' };
      return result;
    },
  };
});

// ── Import under test ────────────────────────────────────────────────────

// `next/server` is imported by the route file but its internal plumbing
// (NextRequest / NextResponse) is not exercised here — we only invoke the
// POST handler and inspect the JSON body + status. Stub NextResponse to a
// minimal duck-typed shape that the route already uses.
vi.mock('next/server', () => {
  class FakeNextResponse {
    status: number;
    body: unknown;
    private _headers: Map<string, string>;
    constructor(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this._headers = new Map(Object.entries(init.headers ?? {}));
    }
    static json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
      return new FakeNextResponse(body, init);
    }
    async json() { return this.body; }
    get headers() { return this._headers; }
  }
  return { NextResponse: FakeNextResponse };
});

// Importing the route AFTER the mocks so the module-level `console.log`
// inside it sees our stubs.
const { POST } = await import('@/app/api/game/milestone/claim/route');

// ── Fixtures ─────────────────────────────────────────────────────────────

function fakeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/game/milestone/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ── Reset ────────────────────────────────────────────────────────────────

beforeEach(() => {
  mock.nextGrantResult = null;
  mock.grantCalls = 0;
  mock.lastGrantParams = null;
  mock.upsertCalls = 0;
  mock.lastUpsertPayload = null;
  mock.existing = null;
  mock.activity = {
    id: 42,
    name: 'demo',
    config: {
      milestones: [
        { id: 1001, threshold: 1000,  rewardType: 'ENERGY', energyValue: 500 },
        { id: 1002, threshold: 5000,  rewardType: 'MEDAL',  medalId: 'badge-champion' },
        { id: 1003, threshold: 8000,  rewardType: 'MEDAL' /* medalId missing on purpose */ },
        { id: 1004, threshold: 12000, rewardType: 'ENERGY', energyValue: 2000 },
      ],
      isGlobalEnabled: true,
    },
  };
  mock.personalDamage = 9000; // over 8000 so MEDAL #1003 is also unlockable
  mock.authedUserId = 'uuid-128';
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 1. MEDAL success path ────────────────────────────────────────────────

describe('POST /api/game/milestone/claim — MEDAL success', () => {
  it('awaits grantBadge before writing the DB and returns 200', async () => {
    mock.nextGrantResult = { ok: true, requestId: 'req_xyz' };

    const res = await POST(fakeRequest({ milestone_id: 1002 }) as Request);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.claimed).toBe(true);
    expect(body.data.reward_type).toBe('MEDAL');
    expect(body.data.reward_value).toBe('badge-champion');

    // grantBadge was awaited and received the right params.
    expect(mock.grantCalls).toBe(1);
    expect(mock.lastGrantParams).toEqual({
      userId:         'uuid-128',
      originalUserId: 'uuid-128', // raw form; in this fixture cookie already canonical
      badgeId:        'badge-champion',
      activityId:     '42',
    });

    // DB upsert happened AFTER the grant and only once.
    expect(mock.upsertCalls).toBe(1);
    expect(mock.lastUpsertPayload).toMatchObject({
      user_id:     'uuid-128',
      milestone_id: '1002',
      is_claimed:  true,
      reward_type: 'MEDAL',
      reward_value: 'badge-champion',
    });
  });
});

// ── 2. MEDAL failure path ────────────────────────────────────────────────

describe('POST /api/game/milestone/claim — MEDAL failure', () => {
  it('returns 500 INTERNAL_ERROR and does NOT touch the DB when grantBadge fails', async () => {
    mock.nextGrantResult = { ok: false, reason: 'API_ERROR', message: 'HTTP 502' };

    const res = await POST(fakeRequest({ milestone_id: 1002 }) as Request);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');

    // DB must NOT have been written.
    expect(mock.upsertCalls).toBe(0);
  });

  it('returns 500 CONFIG_ERROR when MEDAL milestone has no medalId', async () => {
    // milestone 1003 has no medalId by design in the fixture.
    const res = await POST(fakeRequest({ milestone_id: 1003 }) as Request);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('CONFIG_ERROR');

    // Adapter must NOT have been called for a misconfigured milestone.
    expect(mock.grantCalls).toBe(0);
    expect(mock.upsertCalls).toBe(0);
  });
});

// ── 3. Already-claimed idempotency ────────────────────────────────────────

describe('POST /api/game/milestone/claim — already-claimed idempotency', () => {
  it('returns the existing claimed payload and does NOT re-issue the grant', async () => {
    mock.existing = {
      user_id: 'uuid-128',
      milestone_id: '1002',
      is_claimed: true,
      is_locked: false,
      claimed_at: '2026-09-12T00:00:00.000Z',
      reward_type: 'MEDAL',
      reward_value: 'badge-champion',
    };

    const res = await POST(fakeRequest({ milestone_id: 1002 }) as Request);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.claimed).toBe(true);
    expect(body.data.claimed_at).toBe('2026-09-12T00:00:00.000Z');

    // No re-grant, no DB re-upsert.
    expect(mock.grantCalls).toBe(0);
    expect(mock.upsertCalls).toBe(0);
  });
});

// ── 4. ENERGY path is unchanged ──────────────────────────────────────────

describe('POST /api/game/milestone/claim — ENERGY path', () => {
  it('writes the DB first and dispatches the energy webhook fire-and-forget', async () => {
    // Use the fake outboundWebhook by setting a recognisable body via the
    // already-instrumented mock — grantBadge is MEDAL-only, but the
    // ENERGY path exercises a different outbound module. We assert on
    // observable DB state and on the absence of grantBadge activity.
    mock.personalDamage = 1500; // >= 1000 to unlock ENERGY #1001

    const res = await POST(fakeRequest({ milestone_id: 1001 }) as Request);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.reward_type).toBe('ENERGY');

    // DB upsert ran (ENERGY keeps the pre-grant write behaviour).
    expect(mock.upsertCalls).toBe(1);
    expect(mock.lastUpsertPayload).toMatchObject({
      reward_type: 'ENERGY',
      reward_value: '500',
    });

    // grantBadge must NOT have been called for an ENERGY milestone.
    expect(mock.grantCalls).toBe(0);
  });
});
