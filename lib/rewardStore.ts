'use client';

/**
 * lib/rewardStore.ts — Activity-Scoped Personal Reward Claim State
 *
 * REPARK 7.0 (2026-08-24): Milestone rewards unlock from ACTIVITY-SCOPED
 * personal damage (`battleInit.personal_damage`, this player's damage in the
 * CURRENT activity), NOT the global all-time damage
 * (`user_inventory.total_damage_dealt`, which is the historical total across
 * every activity the player has ever played).
 *
 * Strict invariants:
 *   - `personalDamage` MUST be sourced from `battleInit.personal_damage`
 *     (top-level field returned by /api/battle/init).
 *   - NEVER call `setPersonalDamage(user_inventory.total_damage_dealt)` —
 *     that value is global / all-time and would incorrectly unlock milestones
 *     across unrelated activities.
 *   - Boss HP (maxHp - currentHp) is NEVER a reward gate; it remains
 *     authoritative only for stage / form visuals.
 *
 * Data flow:
 *   BattleLayout polls /api/battle/init
 *     → extracts `data.personal_damage` (activity-scoped) from the response
 *     → calls `rewardStore.setPersonalDamage(data.personal_damage)`
 *   rewardStore recomputes hasUnclaimed using:
 *     hasUnclaimed = defs.some(m => !claimedIds.has(m.id) && personalDamage >= m.threshold)
 *   Consumers (GameBannerCarousel, H5Banner, HomePageClient) read
 *   `rewardStore.hasUnclaimed` — this correctly reflects the player's
 *   CURRENT-ACTIVITY milestone state only.
 */

import { create } from 'zustand';

interface MilestoneDef {
  id: number;
  threshold: number; // personal damage value required to unlock this milestone
}

interface RewardState {
  hasUnclaimed: boolean;
  unclaimedCount: number;
  milestoneClaimedIds: Set<number>;
  milestoneDefs: MilestoneDef[];
  // REPARK 7.0 (2026-08-24): was serverTotalDamage (global boss HP delta);
  // now personalDamage (this player's accumulated damage). Boss HP is still
  // displayed elsewhere (HP bar / form unlock) but never gates rewards.
  personalDamage: number;
  setMilestoneClaimed: (milestoneId: number) => void;
  hydrateMilestones: (claimedIds: number[], defs: MilestoneDef[]) => void;
  setPersonalDamage: (damage: number) => void;
  markAllClaimed: () => void;
  decrementUnclaimed: () => void;
  hydrateFromServer: (initialCount: number) => void;
}

export const useRewardStore = create<RewardState>((set, get) => ({
  hasUnclaimed: false,
  unclaimedCount: 0,
  milestoneClaimedIds: new Set<number>(),
  milestoneDefs: [],
  personalDamage: 0,

  hydrateMilestones: (claimedIds, defs) => {
    const claimedSet = new Set(claimedIds);
    const hasReward = computeHasReward(claimedSet, defs, get().personalDamage);
    set({
      milestoneClaimedIds: claimedSet,
      milestoneDefs: defs,
      hasUnclaimed: hasReward || get().unclaimedCount > 0,
    });
  },

  setMilestoneClaimed: (milestoneId) => {
    const claimedSet = new Set(get().milestoneClaimedIds);
    claimedSet.add(milestoneId);
    const hasReward = computeHasReward(claimedSet, get().milestoneDefs, get().personalDamage);
    set({ milestoneClaimedIds: claimedSet, hasUnclaimed: hasReward || get().unclaimedCount > 0 });
  },

  setPersonalDamage: (damage) => {
    const hasReward = computeHasReward(get().milestoneClaimedIds, get().milestoneDefs, damage);
    set({
      personalDamage: damage,
      hasUnclaimed: hasReward || get().unclaimedCount > 0,
    });
  },

  hydrateFromServer: (initialCount) => {
    set({ unclaimedCount: initialCount, hasUnclaimed: initialCount > 0 || get().hasUnclaimed });
  },

  markAllClaimed: () => {
    set({
      hasUnclaimed: false,
      unclaimedCount: 0,
      milestoneClaimedIds: new Set(get().milestoneDefs.map((m) => m.id)),
    });
  },

  decrementUnclaimed: () => {
    const next = Math.max(0, get().unclaimedCount - 1);
    set({ unclaimedCount: next, hasUnclaimed: next > 0 || computeHasReward(get().milestoneClaimedIds, get().milestoneDefs, get().personalDamage) });
  },
}));

function computeHasReward(
  claimedIds: Set<number>,
  defs: MilestoneDef[],
  personalDamage: number
): boolean {
  if (!defs.length) return false;
  return defs.some((m) => !claimedIds.has(m.id) && personalDamage >= m.threshold);
}