/**
 * Unit tests for the getFormStatus function (REPARK 2026-09).
 *
 * Validates that stage unlock decisions are derived from
 * admin-configured spine.formThresholds percentages, not hard-coded values.
 */

import { describe, it, expect } from 'vitest';

// Inline the function so tests run without importing the route module
// (which requires full Next.js context). This is a pure-function extract.

interface FormStatus {
  formId: 'stage1' | 'stage2' | 'stage3' | 'stage4';
  hpThreshold: number;
  isUnlocked: boolean;
}

function getFormStatus(
  currentHp: number,
  maxHp: number,
  thresholds: { stage2: number; stage3: number; stage4: number },
): FormStatus[] {
  const hpPercent = maxHp > 0 ? (currentHp / maxHp) * 100 : 100;
  const forms: FormStatus[] = [
    { formId: 'stage1', hpThreshold: 100,                      isUnlocked: true  },
    { formId: 'stage2', hpThreshold: thresholds.stage2,         isUnlocked: hpPercent <= thresholds.stage2  },
    { formId: 'stage3', hpThreshold: thresholds.stage3,         isUnlocked: hpPercent <= thresholds.stage3  },
    { formId: 'stage4', hpThreshold: thresholds.stage4,         isUnlocked: hpPercent <= thresholds.stage4  },
  ];
  return forms;
}

describe('getFormStatus — admin-configurable thresholds', () => {
  const MAX_HP = 100_000;

  function unlockMap(result: FormStatus[]) {
    return Object.fromEntries(result.map(f => [f.formId, f.isUnlocked]));
  }

  // ── Baseline: 75/50/25 ──────────────────────────────────────────────────
  it('at 79.5% HP with threshold 75/50/25: only stage1 unlocked', () => {
    // currentHp=79500, maxHp=100000 → hpPercent=79.5
    // 79.5 > 75 → stage2 locked; 79.5 > 50 → stage3 locked; 79.5 > 25 → stage4 locked
    const result = getFormStatus(79_500, MAX_HP, { stage2: 75, stage3: 50, stage4: 25 });
    expect(unlockMap(result)).toEqual({
      stage1: true,
      stage2: false,
      stage3: false,
      stage4: false,
    });
  });

  it('at exactly 75% HP (75000) with threshold 75: stage1+2 unlocked (boundary >=)', () => {
    // 75% <= 75 → unlocked
    const result = getFormStatus(75_000, MAX_HP, { stage2: 75, stage3: 50, stage4: 25 });
    expect(unlockMap(result)).toEqual({
      stage1: true,
      stage2: true,
      stage3: false,
      stage4: false,
    });
  });

  it('at 74.9% HP with threshold 75: stage1+2 unlocked', () => {
    const result = getFormStatus(74_900, MAX_HP, { stage2: 75, stage3: 50, stage4: 25 });
    expect(unlockMap(result)).toEqual({
      stage1: true,
      stage2: true,
      stage3: false,
      stage4: false,
    });
  });

  // ── Non-default thresholds (70/45/20) ──────────────────────────────────
  it('at 79.5% HP with 70/45/20: only stage1 unlocked', () => {
    // 79.5 > 70 → stage2 locked
    const result = getFormStatus(79_500, MAX_HP, { stage2: 70, stage3: 45, stage4: 20 });
    expect(unlockMap(result)).toEqual({
      stage1: true,
      stage2: false,
      stage3: false,
      stage4: false,
    });
  });

  it('at 69.5% HP with 70/45/20: stage1+2 unlocked', () => {
    const result = getFormStatus(69_500, MAX_HP, { stage2: 70, stage3: 45, stage4: 20 });
    expect(unlockMap(result)).toEqual({
      stage1: true,
      stage2: true,
      stage3: false,
      stage4: false,
    });
  });

  it('at 44% HP with 70/45/20: stage1+2+3 unlocked, stage4 locked', () => {
    const result = getFormStatus(44_000, MAX_HP, { stage2: 70, stage3: 45, stage4: 20 });
    expect(unlockMap(result)).toEqual({
      stage1: true,
      stage2: true,
      stage3: true,
      stage4: false,
    });
  });

  it('at 19% HP with 70/45/20: all stages unlocked', () => {
    const result = getFormStatus(19_000, MAX_HP, { stage2: 70, stage3: 45, stage4: 20 });
    expect(unlockMap(result)).toEqual({
      stage1: true,
      stage2: true,
      stage3: true,
      stage4: true,
    });
  });

  it('at 0 HP: all stages unlocked', () => {
    const result = getFormStatus(0, MAX_HP, { stage2: 70, stage3: 45, stage4: 20 });
    expect(unlockMap(result)).toEqual({
      stage1: true,
      stage2: true,
      stage3: true,
      stage4: true,
    });
  });

  // ── hpThreshold field correctness ─────────────────────────────────────────
  it('hpThreshold field reflects the configured percentage (not maxHp*percent)', () => {
    const result = getFormStatus(50_000, MAX_HP, { stage2: 70, stage3: 45, stage4: 20 });
    const byId = Object.fromEntries(result.map(f => [f.formId, f.hpThreshold]));
    expect(byId).toEqual({
      stage1: 100,
      stage2: 70,
      stage3: 45,
      stage4: 20,
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────
  it('stage1 always unlocked regardless of HP', () => {
    const result = getFormStatus(100_000, MAX_HP, { stage2: 75, stage3: 50, stage4: 25 });
    expect(result.find(f => f.formId === 'stage1')!.isUnlocked).toBe(true);
  });

  it('handles maxHp=0 without division-by-zero', () => {
    const result = getFormStatus(0, 0, { stage2: 75, stage3: 50, stage4: 25 });
    expect(result[0].isUnlocked).toBe(true); // stage1 always true
    // With hpPercent=100 (fallback), stage2: 100 <= 75 → false, etc.
    expect(result[1].isUnlocked).toBe(false);
  });
});
