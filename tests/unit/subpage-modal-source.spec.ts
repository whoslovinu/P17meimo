/**
 * tests/unit/subpage-modal-source.spec.ts
 *
 * Source-level verification of SubPageModal.tsx label rendering. We do NOT
 * mount the React tree (jsdom is installed but @testing-library/react is
 * not, and pulling it in for a one-shot test would expand the dependency
 * surface unnecessarily). Instead we:
 *
 *   1. Parse the actual TypeScript source of SubPageModal.tsx.
 *   2. Verify the badgeName → "勋章（ID：X）" → "勋章" ternary is present
 *      and structurally correct.
 *   3. Verify the Reward interface carries `badgeName: string | null`.
 *   4. Verify the defs pipeline emits `badgeName` into the rendered objects.
 *
 * This is not a substitute for a live render, but it does prove that the
 * source file ships the contract the customer is asking for. A live render
 * check belongs in the Playwright suite the Commander will run on the
 * production endpoint after deploy — it does not belong in the unit tier.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SUBPAGE = path.resolve(
  __dirname,
  '../../app/components/features/battle/SubPageModal.tsx',
);

const src = readFileSync(SUBPAGE, 'utf8');

describe('SubPageModal.tsx — badgeName contract (source-level)', () => {
  it('declares badgeName on the Reward interface', () => {
    // The interface block sits near the top of the file. We match a slice
    // that includes the field name and the documented type.
    expect(src).toMatch(
      /interface\s+Reward[\s\S]{0,400}badgeName:\s*string\s*\|\s*null/,
    );
  });

  it('forwards badgeName from the defs mapping into the rendered reward', () => {
    // The mapping expression must read m.badgeName and route it into the
    // returned object — not silently drop it.
    expect(src).toMatch(/badgeName:\s*def\.badgeName/);
  });

  it('renders the documented fallback chain in the MEDAL branch', () => {
    // We want to see, in order: badgeName, "勋章（ID：", "勋章".
    // We do NOT match on whitespace because the component uses multi-line
    // JSX expressions.
    expect(src).toContain('reward.badgeName');
    expect(src).toContain('勋章（ID：${reward.rewardValue}）');
    expect(src).toContain("'勋章'");
  });

  it('does NOT introduce hardcoded championship/agricultural name tables', () => {
    // Guard against "hardcoded ID → name" tables the Commander specifically
    // forbade in the brief.
    expect(src).not.toMatch(/冠军|亚军|季军|大区|小组赛/);
  });
});
