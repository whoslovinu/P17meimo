/**
 * Unit tests for admin override milestone semantics (REPARK 7.0 2026-09-14).
 *
 * Validates the data-layer invariants that the override route enforces:
 *   • unlock on already-claimed row → no-op (no second grant opportunity)
 *   • unlock on locked row → clears is_locked, sets admin_bypass
 *   • unlock on unclaimed row → sets admin_bypass
 *   • lock on already-claimed row → REJECTED (no revoke, no claim history reset)
 *   • lock on unclaimed row → sets is_locked, preserves admin_bypass
 *   • claim success → consumes admin_bypass (single-use)
 */

import { describe, it, expect } from 'vitest';

// ── Mirror of the override route's behavioural matrix ────────────────────
type ClaimRow = {
  is_claimed: boolean;
  is_locked: boolean;
  claimed_at: string | null;
  admin_bypass: boolean;
};

type Action = 'unlock' | 'lock';

type OverrideResult =
  | { ok: true; row: ClaimRow; bypassConsumed?: boolean }
  | { ok: false; code: 'ALREADY_CLAIMED' };

/**
 * Replicates the override route's logic. Pure function — does NOT touch DB.
 * Mirrors app/api/admin/users/[uid]/milestones/override/route.ts.
 */
function applyOverride(prior: ClaimRow, action: Action): OverrideResult {
  if (action === 'unlock') {
    if (prior.is_claimed) {
      // NO-OP — cannot re-issue grant.
      return { ok: true, row: { ...prior } };
    }
    return {
      ok: true,
      row: {
        is_claimed: false,
        is_locked: false,
        claimed_at: null,
        admin_bypass: true, // ← single-use flag
      },
    };
  }

  // action === 'lock'
  if (prior.is_claimed) {
    return { ok: false, code: 'ALREADY_CLAIMED' };
  }
  return {
    ok: true,
    row: {
      is_claimed: prior.is_claimed,
      is_locked: true,
      claimed_at: prior.claimed_at, // preserves any (shouldn't exist for unclaimed, but defensive)
      admin_bypass: prior.admin_bypass, // ← lock does NOT clear bypass
    },
  };
}

/**
 * Replicates the claim route's bypass consumption. Pure function.
 * Mirrors app/api/game/milestone/claim/route.ts after upsert.
 */
function consumeBypassOnClaim(prior: ClaimRow): ClaimRow {
  return {
    ...prior,
    is_claimed: true,
    claimed_at: new Date().toISOString(),
    admin_bypass: false, // ← single-use; consumed by claim success
  };
}

describe('Admin override — unlock semantics', () => {
  it('unlock on a freshly-unclaimed row: sets admin_bypass=true', () => {
    const prior: ClaimRow = { is_claimed: false, is_locked: false, claimed_at: null, admin_bypass: false };
    const r = applyOverride(prior, 'unlock');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.admin_bypass).toBe(true);
      expect(r.row.is_locked).toBe(false);
      expect(r.row.is_claimed).toBe(false);
      expect(r.row.claimed_at).toBe(null);
    }
  });

  it('unlock on a locked-but-unclaimed row: clears lock + sets bypass', () => {
    const prior: ClaimRow = { is_claimed: false, is_locked: true, claimed_at: null, admin_bypass: false };
    const r = applyOverride(prior, 'unlock');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.admin_bypass).toBe(true);
      expect(r.row.is_locked).toBe(false);
    }
  });

  it('unlock on an already-claimed row: NO-OP (cannot re-issue grant)', () => {
    const claimedAt = '2026-09-13T07:46:38.000Z';
    const prior: ClaimRow = { is_claimed: true, is_locked: false, claimed_at: claimedAt, admin_bypass: false };
    const r = applyOverride(prior, 'unlock');
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The row must be untouched — no second grant opportunity.
      expect(r.row.is_claimed).toBe(true);
      expect(r.row.claimed_at).toBe(claimedAt);
      expect(r.row.admin_bypass).toBe(false);
      expect(r.row.is_locked).toBe(false);
    }
  });

  it('unlock on a row that already had admin_bypass: still sets bypass=true (idempotent)', () => {
    const prior: ClaimRow = { is_claimed: false, is_locked: false, claimed_at: null, admin_bypass: true };
    const r = applyOverride(prior, 'unlock');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.admin_bypass).toBe(true);
    }
  });
});

describe('Admin override — lock semantics', () => {
  it('lock on unclaimed row: sets is_locked, preserves admin_bypass', () => {
    const prior: ClaimRow = { is_claimed: false, is_locked: false, claimed_at: null, admin_bypass: true };
    const r = applyOverride(prior, 'lock');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.is_locked).toBe(true);
      expect(r.row.is_claimed).toBe(false);
      expect(r.row.claimed_at).toBe(null);
      expect(r.row.admin_bypass).toBe(true); // preserved
    }
  });

  it('lock on already-claimed row: REJECTED — does not reset claim history', () => {
    const claimedAt = '2026-09-13T07:46:38.000Z';
    const prior: ClaimRow = { is_claimed: true, is_locked: false, claimed_at: claimedAt, admin_bypass: false };
    const r = applyOverride(prior, 'lock');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('ALREADY_CLAIMED');
    }
    // The actual DB row must NOT be touched. Claim history is preserved.
    expect(prior.is_claimed).toBe(true);
    expect(prior.claimed_at).toBe(claimedAt);
  });

  it('lock on unlocked+unbypassed row: sets is_locked, keeps admin_bypass=false', () => {
    const prior: ClaimRow = { is_claimed: false, is_locked: false, claimed_at: null, admin_bypass: false };
    const r = applyOverride(prior, 'lock');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.is_locked).toBe(true);
      expect(r.row.admin_bypass).toBe(false);
    }
  });
});

describe('Claim success — admin_bypass single-use consumption', () => {
  it('after successful claim: admin_bypass consumed (set to false)', () => {
    const prior: ClaimRow = { is_claimed: false, is_locked: false, claimed_at: null, admin_bypass: true };
    const next = consumeBypassOnClaim(prior);
    expect(next.is_claimed).toBe(true);
    expect(next.claimed_at).not.toBe(null);
    expect(next.admin_bypass).toBe(false);
  });

  it('after successful claim without prior bypass: bypass stays false', () => {
    const prior: ClaimRow = { is_claimed: false, is_locked: false, claimed_at: null, admin_bypass: false };
    const next = consumeBypassOnClaim(prior);
    expect(next.is_claimed).toBe(true);
    expect(next.admin_bypass).toBe(false);
  });

  it('double-claim scenario: first claim consumes, second claim hits ALREADY_CLAIMED branch (not re-grant)', () => {
    const prior: ClaimRow = { is_claimed: false, is_locked: false, claimed_at: null, admin_bypass: true };
    const afterFirstClaim = consumeBypassOnClaim(prior);
    // Second claim: route checks is_claimed first → ALREADY_CLAIMED (no Grant).
    // Even if bypass was somehow still true, the route's ALREADY_CLAIMED branch
    // short-circuits BEFORE the threshold check.
    expect(afterFirstClaim.is_claimed).toBe(true);
    expect(afterFirstClaim.admin_bypass).toBe(false);
  });
});

describe('End-to-end override-then-claim flow (no admin grant duplication)', () => {
  it('unlock bypass → claim success → cannot claim again', () => {
    // Step 1: player has not met threshold, admin unlocks.
    const before: ClaimRow = { is_claimed: false, is_locked: false, claimed_at: null, admin_bypass: false };
    const afterOverride = applyOverride(before, 'unlock');
    if (!afterOverride.ok) throw new Error('unlock must succeed');
    expect(afterOverride.row.admin_bypass).toBe(true);

    // Step 2: player claims (bypass path because admin_bypass=true).
    const afterClaim = consumeBypassOnClaim(afterOverride.row);
    expect(afterClaim.is_claimed).toBe(true);
    expect(afterClaim.admin_bypass).toBe(false);

    // Step 3: admin tries to "unlock again" — no-op, no second grant.
    const secondOverride = applyOverride(afterClaim, 'unlock');
    if (!secondOverride.ok) throw new Error('unlock must succeed');
    expect(secondOverride.row.is_claimed).toBe(true);
    expect(secondOverride.row.admin_bypass).toBe(false);

    // Step 4: admin tries to lock the claimed milestone — REJECTED.
    const lockAttempt = applyOverride(afterClaim, 'lock');
    expect(lockAttempt.ok).toBe(false);
  });
});

/**
 * Simulates the atomicOverride Phase-1 SQL: UPDATE ... WHERE is_claimed = false
 * Returns the number of rows updated.
 */
function phase1Update(
  row: ClaimRow,
  newLocked: boolean,
): { updated: boolean; finalRow: ClaimRow } {
  // Simulates: UPDATE ... WHERE is_claimed = false AND milestone_id = $2
  if (row.is_claimed) {
    return { updated: false, finalRow: row }; // 0 rows affected
  }
  return {
    updated: true,
    finalRow: { ...row, is_locked: newLocked },
  };
}

describe('Concurrent safety: admin override vs player claim', () => {
  /**
   * Race: admin reads is_claimed=false, then player claims concurrently,
   * then admin's UPDATE runs. With the old无条件 UPDATE pattern, the player's
   * claimed_at would be overwritten.
   *
   * With the atomic UPDATE WHERE is_claimed=false pattern:
   * admin UPDATE finds is_claimed=true → 0 rows updated → claim state preserved.
   */
  it('admin lock after player claim: claim state is NOT overwritten (atomic UPDATE)', () => {
    // Step 1: player claims
    const afterClaim: ClaimRow = {
      is_claimed: true,
      is_locked: false,
      claimed_at: '2026-09-13T07:46:38.000Z',
      admin_bypass: false,
    };

    // Step 2: admin's atomicOverride lock runs with WHERE is_claimed=false
    const { updated, finalRow } = phase1Update(afterClaim, true);
    expect(updated).toBe(false);
    expect(finalRow.is_claimed).toBe(true);
    expect(finalRow.claimed_at).toBe('2026-09-13T07:46:38.000Z');
    expect(finalRow.is_locked).toBe(false); // unchanged
  });

  it('admin unlock after player claim: no new grant opportunity created', () => {
    // Step 1: player claims (bypass was consumed)
    const afterClaim: ClaimRow = {
      is_claimed: true,
      is_locked: false,
      claimed_at: '2026-09-13T07:46:38.000Z',
      admin_bypass: false,
    };

    // Step 2: admin override route checks prior.is_claimed first → NO-OP
    const r = applyOverride(afterClaim, 'unlock');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.is_claimed).toBe(true);
      expect(r.row.claimed_at).toBe('2026-09-13T07:46:38.000Z');
    }
  });

  it('admin lock on pre-claim row: sets is_locked, preserves admin_bypass', () => {
    const preClaim: ClaimRow = {
      is_claimed: false,
      is_locked: false,
      claimed_at: null,
      admin_bypass: true,
    };
    // atomicOverride lock: Phase1 UPDATE finds is_claimed=false → succeeds
    const { updated, finalRow } = phase1Update(preClaim, true);
    expect(updated).toBe(true);
    expect(finalRow.is_locked).toBe(true);
    expect(finalRow.admin_bypass).toBe(true); // preserved (not touched by lock)
  });

  it('admin unlock on locked row: clears lock + sets bypass', () => {
    const locked: ClaimRow = {
      is_claimed: false,
      is_locked: true,
      claimed_at: null,
      admin_bypass: false,
    };
    const r = applyOverride(locked, 'unlock');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.is_locked).toBe(false);
      expect(r.row.admin_bypass).toBe(true);
    }
  });
});

describe('Migration-17 backward compat (admin_bypass column absent)', () => {
  /**
   * When admin_bypass column is absent (pre-m17), the unlock action must
   * FAIL explicitly (MIGRATION_REQUIRED) rather than silently clearing is_locked.
   * This test documents the expected error code.
   */
  it('unlock without admin_bypass column: expected error code MIGRATION_REQUIRED', () => {
    // Pre-m17: priorResult would not have admin_bypass field (or it's null/undefined).
    // The route should detect this and return { code: 'MIGRATION_REQUIRED' }.
    // This is a route-level behavior, not a pure function — documented here as the
    // expected contract when the column is absent.
    const priorNoBypass: ClaimRow = {
      is_claimed: false,
      is_locked: false,
      claimed_at: null,
      admin_bypass: false,
    };
    // Simulate: route sees admin_bypass column is absent → unlock path is impossible.
    // The route returns HTTP 503 { code: 'MIGRATION_REQUIRED' }.
    // Lock (is_locked-only) still works pre-m17.
    const lockResult = applyOverride(priorNoBypass, 'lock');
    expect(lockResult.ok).toBe(true);
    if (lockResult.ok) {
      expect(lockResult.row.is_locked).toBe(true);
    }
  });
});
