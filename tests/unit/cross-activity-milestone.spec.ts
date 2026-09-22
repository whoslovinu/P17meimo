/**
 * Unit tests for cross-activity milestone ID conflict detection (REPARK 7.0 2026-09-14).
 *
 * Tests the normalizeMilestoneId function and the conflict-checking logic
 * without requiring a real database connection.
 */

import { describe, it, expect } from 'vitest';

// ── Pure-function extract of normalizeMilestoneId ──────────────────────────
function normalizeMilestoneId(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const stripped = s.replace(/^m/i, '');
  const n = Number(stripped);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.floor(n));
}

/**
 * Simulates the cross-activity conflict check logic.
 * Returns the conflicting activity if a duplicate is found, else null.
 */
function findConflict(
  currentId: number,
  currentMilestones: Array<{ id: unknown }>,
  otherActivities: Array<{
    id: number;
    name: string;
    milestones: Array<{ id: unknown }>;
  }>,
): { activityId: number; activityName: string; duplicateId: string } | null {
  const incoming = new Set<string>();
  for (const ms of currentMilestones) {
    const norm = normalizeMilestoneId(ms.id);
    if (norm) incoming.add(norm);
  }
  if (incoming.size === 0) return null;

  for (const act of otherActivities) {
    if (act.id === currentId) continue;
    for (const ms of act.milestones ?? []) {
      const norm = normalizeMilestoneId(ms.id);
      if (norm && incoming.has(norm)) {
        return { activityId: act.id, activityName: act.name, duplicateId: norm };
      }
    }
  }
  return null;
}

describe('normalizeMilestoneId', () => {
  it('strips m prefix from timestamp-style IDs', () => {
    expect(normalizeMilestoneId('m1789292914')).toBe('1789292914');
    expect(normalizeMilestoneId('M1789292914')).toBe('1789292914');
    expect(normalizeMilestoneId('m1234567890')).toBe('1234567890');
  });

  it('returns plain integers as-is', () => {
    expect(normalizeMilestoneId(1789292914)).toBe('1789292914');
    expect(normalizeMilestoneId(1001)).toBe('1001');
    expect(normalizeMilestoneId('75')).toBe('75');
  });

  it('handles null / undefined / empty', () => {
    expect(normalizeMilestoneId(null)).toBe(null);
    expect(normalizeMilestoneId(undefined)).toBe(null);
    expect(normalizeMilestoneId('')).toBe(null);
    expect(normalizeMilestoneId('   ')).toBe(null);
  });

  it('rejects negative numbers and zero', () => {
    expect(normalizeMilestoneId('-123')).toBe(null);
    expect(normalizeMilestoneId('m-123')).toBe(null);
    expect(normalizeMilestoneId(0)).toBe(null);
    expect(normalizeMilestoneId('0')).toBe(null);
  });
});

describe('findConflict — same ID in different activity', () => {
  it('detects collision: m1789292914 in act1 conflicts with m1789292914 in act2', () => {
    const conflict = findConflict(
      2, // current = activity 2
      [{ id: 'm1789292914' }, { id: 'm1001' }],
      [
        {
          id: 1,
          name: '魅魔来袭·二期',
          milestones: [{ id: 'm1789292914' }],
        },
      ],
    );
    expect(conflict).not.toBeNull();
    expect(conflict!.duplicateId).toBe('1789292914');
    expect(conflict!.activityId).toBe(1);
  });

  it('different IDs: no collision', () => {
    const conflict = findConflict(
      2,
      [{ id: 'm2000' }, { id: 'm2001' }],
      [
        {
          id: 1,
          name: '活动A',
          milestones: [{ id: 'm1789292914' }],
        },
      ],
    );
    expect(conflict).toBeNull();
  });

  it('ignores current activity (same ID is fine)', () => {
    const conflict = findConflict(
      1,
      [{ id: 'm1789292914' }],
      [{ id: 1, name: '活动A', milestones: [{ id: 'm1789292914' }] }],
    );
    expect(conflict).toBeNull();
  });

  it('handles plain integer collision across activities', () => {
    const conflict = findConflict(
      2,
      [{ id: 75 }],
      [{ id: 1, name: '活动A', milestones: [{ id: 75 }] }],
    );
    expect(conflict).not.toBeNull();
    expect(conflict!.duplicateId).toBe('75');
  });

  it('mixed "m" prefix vs plain integer: both normalise to same', () => {
    // "m75" normalises to "75"; "75" normalises to "75"
    const conflict = findConflict(
      2,
      [{ id: 'm75' }],
      [{ id: 1, name: '活动A', milestones: [{ id: 75 }] }],
    );
    expect(conflict).not.toBeNull();
  });

  it('empty milestone list: no conflict', () => {
    const conflict = findConflict(2, [], [{ id: 1, name: '活动A', milestones: [{ id: 'm1789292914' }] }]);
    expect(conflict).toBeNull();
  });

  it('activity with no milestones: no conflict', () => {
    const conflict = findConflict(
      2,
      [{ id: 'm1789292914' }],
      [{ id: 1, name: '活动A', milestones: [] }],
    );
    expect(conflict).toBeNull();
  });

  it('multiple activities checked: finds first collision', () => {
    const conflict = findConflict(
      3,
      [{ id: 'm9999' }],
      [
        { id: 1, name: '活动A', milestones: [{ id: 'm1111' }] },
        { id: 2, name: '活动B', milestones: [{ id: 'm9999' }] },
      ],
    );
    expect(conflict).not.toBeNull();
    expect(conflict!.activityId).toBe(2);
    expect(conflict!.activityName).toBe('活动B');
  });

  it('null IDs in milestones are skipped', () => {
    const conflict = findConflict(
      2,
      [{ id: null }, { id: 'm1789292914' }],
      [{ id: 1, name: '活动A', milestones: [{ id: 'm1789292914' }] }],
    );
    expect(conflict).not.toBeNull();
  });
});
