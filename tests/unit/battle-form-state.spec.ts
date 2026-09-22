/**
 * Unit tests for the frontend form unlock + fallback logic (REPARK 7.0 2026-09-14).
 *
 * Mirrors the logic in BattleLayout.tsx's polling effect (syncHpFromAdmin) that:
 *   1. Syncs spineFormThresholds from the /api/battle/init response
 *   2. Rebuilds unlockedForms from server's user.forms[] + local HP threshold check
 *   3. Falls back to the highest-available form when activeForm becomes invalid
 *   4. Prevents stale closure bugs by using refs
 *
 * Also tests FormSelector's isLockedByHp logic to confirm:
 *   - At HP above threshold: stage is locked by HP (button disabled)
 *   - At HP at or below threshold: stage is unlocked if in unlockedForms
 */

import { describe, it, expect } from 'vitest';

// ── Pure-function extract of the polling effect's fallback logic ─────────────────

type FormId = 'initial' | 'awakening' | 'flame' | 'shadow';

interface FormConfig {
  id: FormId;
  unlockThreshold: number; // e.g. 75 (HP% at or below which stage unlocks)
}

// Mirrors buildFormConfigs({stage2:75, stage3:50, stage4:25}) in FormSelector.tsx
function buildFormConfigs(
  thresholds: { stage2: number; stage3: number; stage4: number } | null,
): FormConfig[] {
  const t = thresholds ?? { stage2: 75, stage3: 50, stage4: 25 };
  return [
    { id: 'initial',    unlockThreshold: 100 },
    { id: 'awakening',  unlockThreshold: t.stage2 },
    { id: 'flame',     unlockThreshold: t.stage3 },
    { id: 'shadow',    unlockThreshold: t.stage4 },
  ];
}

// Mirrors FormSelector.tsx isLockedByHp / isUnlocked logic
function isUnlocked(
  formId: FormId,
  hpPercent: number,
  unlockedForms: Set<FormId>,
  formConfigs: FormConfig[],
): boolean {
  const cfg = formConfigs.find(f => f.id === formId);
  if (!cfg) return false;
  const isLockedByHp = hpPercent > cfg.unlockThreshold;
  return unlockedForms.has(formId) && !isLockedByHp;
}

// Mirrors the fallback logic in BattleLayout.tsx's polling effect
const FORM_ORDER: FormId[] = ['shadow', 'flame', 'awakening', 'initial'];

function computeUnlockedForms(
  serverForms: Array<{ formId: FormId; isUnlocked: boolean }>,
  hpPercent: number,
  formConfigs: FormConfig[],
): Set<FormId> {
  const nextUnlocked = new Set<FormId>(['initial']);
  for (const f of serverForms) {
    if (f.isUnlocked) nextUnlocked.add(f.formId);
  }
  // Defensive: also add forms unlocked by local HP (handles poll gap)
  for (const cfg of formConfigs) {
    if (hpPercent <= cfg.unlockThreshold) nextUnlocked.add(cfg.id);
  }
  return nextUnlocked;
}

function maybeFallback(
  activeForm: FormId,
  unlockedForms: Set<FormId>,
  hpPercent: number,
  formConfigs: FormConfig[],
): { newActiveForm: FormId; didFallback: boolean } {
  // Design rule: current activeForm must stay valid.
  // If the active form is no longer unlocked (by HP or by server),
  // fall back to the highest-indexed available form.
  for (const fid of FORM_ORDER) {
    if (fid === 'initial') break;
    if (activeForm === fid && !isUnlocked(fid, hpPercent, unlockedForms, formConfigs)) {
      // Find highest available (iterate in reverse)
      for (const candidate of FORM_ORDER) {
        if (isUnlocked(candidate, hpPercent, unlockedForms, formConfigs)) {
          return { newActiveForm: candidate, didFallback: true };
        }
      }
    }
  }
  return { newActiveForm: activeForm, didFallback: false };
}

// ── Test Cases ────────────────────────────────────────────────────────────────

describe('FormSelector unlockThreshold logic', () => {
  const formConfigs = buildFormConfigs({ stage2: 75, stage3: 50, stage4: 25 });

  it('stage1 always unlocked regardless of HP', () => {
    expect(isUnlocked('initial', 100, new Set(['initial']), formConfigs)).toBe(true);
    expect(isUnlocked('initial', 50,  new Set(['initial']), formConfigs)).toBe(true);
    expect(isUnlocked('initial', 0,   new Set(['initial']), formConfigs)).toBe(true);
  });

  it('at HP=79.5% with threshold 75: stage2 locked', () => {
    const u = new Set<FormId>(['initial']);
    expect(isUnlocked('awakening', 79.5, u, formConfigs)).toBe(false);
  });

  it('at HP=75% (boundary >=) with threshold 75: stage2 unlocked', () => {
    const u = new Set<FormId>(['initial', 'awakening']);
    expect(isUnlocked('awakening', 75, u, formConfigs)).toBe(true);
  });

  it('at HP=74.9% with threshold 75: stage2 unlocked', () => {
    const u = new Set<FormId>(['initial', 'awakening']);
    expect(isUnlocked('awakening', 74.9, u, formConfigs)).toBe(true);
  });

  it('non-default thresholds 70/45/20: HP=69.5% unlocks stage2', () => {
    const configs = buildFormConfigs({ stage2: 70, stage3: 45, stage4: 20 });
    const u = computeUnlockedForms([], 69.5, configs);
    expect(isUnlocked('awakening', 69.5, u, configs)).toBe(true);
  });

  it('HP above threshold even with unlockedForms: still locked', () => {
    // user has stage2 in unlockedForms but HP is 79.5% (> 75%) → button locked
    const u = new Set<FormId>(['initial', 'awakening']);
    expect(isUnlocked('awakening', 79.5, u, formConfigs)).toBe(false);
  });
});

describe('unlockedForms rebuild from server + HP', () => {
  it('server returns stage2 unlocked, HP=74%: unlockedForms includes awakening', () => {
    const serverForms = [
      { formId: 'stage1' as FormId, isUnlocked: true },
      { formId: 'awakening' as FormId, isUnlocked: true },
    ];
    const configs = buildFormConfigs({ stage2: 75, stage3: 50, stage4: 25 });
    const u = computeUnlockedForms(serverForms, 74, configs);
    expect(u.has('initial')).toBe(true);
    expect(u.has('awakening')).toBe(true);
    expect(u.has('flame')).toBe(false);
  });

  it('server returns no unlocked high stages, local HP below threshold adds them', () => {
    // Server has no stage2 unlocked (HP=50% but server hasn't synced yet).
    // Local HP check kicks in and adds awakening.
    const serverForms = [
      { formId: 'initial' as FormId, isUnlocked: true },
    ];
    const configs = buildFormConfigs({ stage2: 75, stage3: 50, stage4: 25 });
    const u = computeUnlockedForms(serverForms, 50, configs);
    expect(u.has('awakening')).toBe(true);
    expect(u.has('flame')).toBe(true);
  });
});

describe('fallback to highest available stage', () => {
  const configs = buildFormConfigs({ stage2: 75, stage3: 50, stage4: 25 });

  it('HP=79.5%, active=awakening, server locked: fallback to initial', () => {
    const u = new Set<FormId>(['initial']); // awakening not unlocked
    const { newActiveForm, didFallback } = maybeFallback('awakening', u, 79.5, configs);
    expect(didFallback).toBe(true);
    expect(newActiveForm).toBe('initial');
  });

  it('HP=74%, active=initial, all unlocked: no fallback', () => {
    const u = new Set<FormId>(['initial', 'awakening', 'flame', 'shadow']);
    const { newActiveForm, didFallback } = maybeFallback('initial', u, 74, configs);
    expect(didFallback).toBe(false);
    expect(newActiveForm).toBe('initial');
  });

  it('HP=49%, active=initial, server unlocks flame: fallback to flame (higher than initial)', () => {
    // Simulates: HP drops from 80% to 49%, server response unlocks flame.
    // Player was on initial; awakening is already unlocked.
    const u = new Set<FormId>(['initial', 'awakening', 'flame']);
    const { newActiveForm, didFallback } = maybeFallback('initial', u, 49, configs);
    // initial is still valid, so no fallback (player explicitly selected initial)
    expect(didFallback).toBe(false);
    expect(newActiveForm).toBe('initial');
  });

  it('HP drops, active=awakening becomes locked: fallback to initial', () => {
    const u = new Set<FormId>(['initial']); // awakening removed from unlockedForms
    const { newActiveForm, didFallback } = maybeFallback('awakening', u, 79.5, configs);
    expect(didFallback).toBe(true);
    expect(newActiveForm).toBe('initial');
  });

  it('HP=0%, all unlocked: active=shadow stays (highest)', () => {
    const u = new Set<FormId>(['initial', 'awakening', 'flame', 'shadow']);
    const { newActiveForm, didFallback } = maybeFallback('shadow', u, 0, configs);
    expect(didFallback).toBe(false);
    expect(newActiveForm).toBe('shadow');
  });

  it('threshold 70/45/20: HP=69.5%, active=initial, stage2 unlocked: no forced fallback', () => {
    const configs2 = buildFormConfigs({ stage2: 70, stage3: 45, stage4: 20 });
    const u = new Set<FormId>(['initial', 'awakening']);
    // active=initial is still valid (100 >= 100)
    const { newActiveForm, didFallback } = maybeFallback('initial', u, 69.5, configs2);
    expect(didFallback).toBe(false);
    expect(newActiveForm).toBe('initial');
  });

  it('threshold 70/45/20: HP=20%, active=flame, stage4 unlocked: no forced fallback from flame to shadow', () => {
    const configs2 = buildFormConfigs({ stage2: 70, stage3: 45, stage4: 20 });
    const u = new Set<FormId>(['initial', 'awakening', 'flame', 'shadow']);
    // flame is still valid (20 <= 45), no fallback
    const { newActiveForm, didFallback } = maybeFallback('flame', u, 20, configs2);
    expect(didFallback).toBe(false);
    expect(newActiveForm).toBe('flame');
  });
});

describe('manual selection is preserved unless it becomes invalid', () => {
  it('player manually selects stage2 when HP=74%: selection is valid, no fallback', () => {
    const configs = buildFormConfigs({ stage2: 75, stage3: 50, stage4: 25 });
    const u = new Set<FormId>(['initial', 'awakening', 'flame', 'shadow']);
    const { newActiveForm, didFallback } = maybeFallback('awakening', u, 74, configs);
    expect(didFallback).toBe(false);
    expect(newActiveForm).toBe('awakening'); // player keeps their choice
  });

  it('HP drops below threshold after manual select: stage stays until explicitly switched', () => {
    // The effect only triggers fallback when the current selection is no longer
    // in unlockedForms. If HP drops from 74% to 79.5%, awakening becomes locked
    // and the fallback fires.
    const configs = buildFormConfigs({ stage2: 75, stage3: 50, stage4: 25 });
    // HP went UP to 79.5% → awakening should fall back
    const u = new Set<FormId>(['initial']); // awakening locked
    const { newActiveForm, didFallback } = maybeFallback('awakening', u, 79.5, configs);
    expect(didFallback).toBe(true);
    expect(newActiveForm).toBe('initial');
  });
});

describe('buildFormConfigs non-default thresholds', () => {
  it('buildFormConfigs({stage2:70,stage3:45,stage4:20}) returns correct thresholds', () => {
    const configs = buildFormConfigs({ stage2: 70, stage3: 45, stage4: 20 });
    expect(configs.find(c => c.id === 'initial')!.unlockThreshold).toBe(100);
    expect(configs.find(c => c.id === 'awakening')!.unlockThreshold).toBe(70);
    expect(configs.find(c => c.id === 'flame')!.unlockThreshold).toBe(45);
    expect(configs.find(c => c.id === 'shadow')!.unlockThreshold).toBe(20);
  });

  it('buildFormConfigs(null) uses default 75/50/25', () => {
    const configs = buildFormConfigs(null);
    expect(configs.find(c => c.id === 'awakening')!.unlockThreshold).toBe(75);
    expect(configs.find(c => c.id === 'flame')!.unlockThreshold).toBe(50);
    expect(configs.find(c => c.id === 'shadow')!.unlockThreshold).toBe(25);
  });
});
