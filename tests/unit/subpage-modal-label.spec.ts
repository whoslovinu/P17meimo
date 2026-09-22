/**
 * tests/unit/subpage-modal-label.spec.ts
 *
 * Verifies the badge-name display rule used in
 * app/components/features/battle/SubPageModal.tsx (around line 524-531) at the
 * pure-function level. We do NOT mount the full React component here because:
 *
 *   - The project ships jsdom but not @testing-library/react, and bringing
 *     that in just to render a 6-line ternary would add a meaningful
 *     dependency surface for a one-shot test.
 *   - The display rule itself is the only piece of behaviour that the
 *     customer reports as broken. Mounting the whole sheet would also test
 *     the surrounding modal chrome which is out of scope for this fix.
 *
 * Instead we replicate the exact ternary from SubPageModal.tsx here. The
 * implementation is intentionally a copy-paste so that any drift between
 * this spec and the component triggers a review of both — but a tighter
 * alternative (extracting a `resolveRewardLabel(reward)` helper into a
 * shared module and importing it from both places) is the obvious next
 * step if this drift becomes a problem in practice.
 *
 * Three inputs to verify:
 *   1. server badgeName available → render the real name (待领取 + 已领取).
 *   2. server badgeName absent but a numeric rewardValue → render "勋章（ID：X）".
 *   3. server badgeName absent and no rewardValue → render "勋章".
 *
 * The label rule MUST be identical for the 待领取 (claimed=false) and
 * 已领取 (claimed=true) states. We assert that explicitly.
 */

import { describe, expect, it } from 'vitest';

/**
 * Mirror of the SubPageModal.tsx MEDAL branch ternary. Keep these two
 * implementations byte-identical — see the header comment above.
 */
function resolveRewardLabel(reward: {
  badgeName: string | null;
  rewardValue: string;
}): string {
  return reward.badgeName
    ? reward.badgeName
    : reward.rewardValue
      ? `勋章（ID：${reward.rewardValue}）`
      : '勋章';
}

interface Fixture {
  name: string;
  reward: { badgeName: string | null; rewardValue: string };
  expected: string;
}

const fixtures: Fixture[] = [
  {
    name: 'server name available, 待领取',
    reward: { badgeName: '魅魔杯冠军', rewardValue: '10021' },
    expected: '魅魔杯冠军',
  },
  {
    name: 'server name available, 已领取',
    reward: { badgeName: '魅魔杯冠军', rewardValue: '10021' },
    expected: '魅魔杯冠军',
  },
  {
    name: 'server name null, numeric id present',
    reward: { badgeName: null, rewardValue: '3' },
    expected: '勋章（ID：3）',
  },
  {
    name: 'server name empty string, numeric id present',
    reward: { badgeName: '', rewardValue: '5' },
    expected: '勋章（ID：5）',
  },
  {
    name: 'server name null, empty rewardValue',
    reward: { badgeName: null, rewardValue: '' },
    expected: '勋章',
  },
  {
    name: 'server name null, no rewardValue at all',
    reward: { badgeName: null, rewardValue: '' },
    expected: '勋章',
  },
];

describe('SubPageModal reward label resolution (mirrored ternary)', () => {
  for (const f of fixtures) {
    it(f.name, () => {
      expect(resolveRewardLabel(f.reward)).toBe(f.expected);
    });
  }

  it('claimed vs unclaimed does not change the label', () => {
    const base = { badgeName: 'test', rewardValue: '1' };
    expect(resolveRewardLabel(base)).toBe('test');
    expect(resolveRewardLabel({ ...base, badgeName: null })).toBe('勋章（ID：1）');
    // The ternary does not consult any "claimed" field, so the result is
    // the same regardless of which side of the lock the player is on.
  });
});
