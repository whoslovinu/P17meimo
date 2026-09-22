'use client';

/**
 * app/components/features/battle/MilestoneBar.tsx
 * V5.16-EN | Agent 2 [Aesthetic Engineer]
 *
 * Enhanced Milestone Reward Bar — High-Fidelity Visual System.
 *
 * Design tokens (REPARK Sovereign Protocol):
 *  - Obsidian Black: #030304
 *  - Aurora Purple: #9B5CFF
 *  - Neon Pink: #FF2D87
 *  - Gold: #FFD060
 *  - Cyan: #00D4FF
 *  - Green: #3DD68C
 *
 * Visual states:
 *  - Locked: grayscale(1) + opacity(0.4)
 *  - Claimable: Pulse/Glow animation on medal + gradient border glow
 *  - Claimed: permanent green glow + checkmark overlay
 *
 * Plasma Flow: animated gradient overlay on the progress fill.
 * Physics: spring-eased width transition (1.2s cubic-bezier(0.34, 1.56, 0.64, 1)).
 */

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Lock, Zap } from 'lucide-react';
import { toast } from '@/app/lib/toastStore';
import { fetchWithTimeout } from '@/app/lib/fetchWithTimeout';
import { spawnParticles, type ParticleType } from './ParticleEngine';

interface MilestoneReward {
  id: number;
  milestoneId: 75 | 50 | 25;
  threshold: number;
  rewardType: 'ENERGY' | 'MEDAL';
  rewardValue: string;
  rewardAmount?: number; // energy count
}

interface MilestoneBarProps {
  /** Current boss HP percentage (0-100) */
  hpPercent: number;
  /** Total damage dealt by this user */
  totalDamage: number;
  /** Boss max HP (for computing milestones) */
  maxHp: number;
  /** Current inventory — passed down from BattleLayout */
  inventory?: { item_hand: number; item_phallus: number };
  /** Called after successful claim to update parent inventory */
  onInventoryUpdate?: (inventory: { item_hand: number; item_phallus: number }) => void;
  /** Milestone definitions from activity config */
  milestones?: MilestoneReward[];
  /** Claimed milestone IDs from API */
  claimedIds?: Set<number>;
  /**
   * REPARK 7.0 (2026-09-15 round 4):
   *   Server-authoritative per-milestone unlock + claim state for THIS user.
   *   When the parent has fetched /api/battle/init and decides to honor the
   *   server's verdict (admin_bypass, is_locked etc.), the bar mirrors those
   *   flags exactly. Without this prop, the bar falls back to a pure
   *   `totalDamage >= threshold` test, which is the historical default and
   *   never produces the "已特殊解锁 / 管理员解锁后可领取" state when admin
   *   bypasses the threshold.
   *
   *   Keyed by milestone.milestoneId (the digit-only integer stored in DB).
   *   Missing keys fall back to the local damage-threshold test.
   */
  milestoneStatusOverride?: Record<number, { isUnlocked: boolean; isClaimed: boolean }>;
}

interface ClaimResponse {
  ok: boolean;
  data?: {
    milestone_id: number;
    claimed: boolean;
    claimed_at: string;
    reward_type: 'ENERGY' | 'MEDAL';
    reward_value: string;
  };
  error?: { code: string; message: string };
}

// ── Milestone config ────────────────────────────────────────────────────────────

function buildMilestones(maxHp: number, overrides?: MilestoneReward[]): MilestoneReward[] {
  if (overrides?.length) return overrides;
  const total = maxHp || 100000;
  return [
    {
      id: 1,
      milestoneId: 75,
      threshold: Math.floor(total * 0.25),
      rewardType: 'ENERGY',
      rewardValue: '500',
      rewardAmount: 500,
    },
    {
      id: 2,
      milestoneId: 50,
      threshold: Math.floor(total * 0.5),
      rewardType: 'MEDAL',
      rewardValue: '初级挑战者',
    },
    {
      id: 3,
      milestoneId: 25,
      threshold: Math.floor(total * 0.75),
      rewardType: 'ENERGY',
      rewardValue: '2000',
      rewardAmount: 2000,
    },
  ];
}

// ── Claim handler ──────────────────────────────────────────────────────────────

function useMilestoneClaim(onInventoryUpdate?: (inv: { item_hand: number; item_phallus: number }) => void) {
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const handleClaim = useCallback(async (
    milestone: MilestoneReward,
    currentInventory: { item_hand: number; item_phallus: number }
  ) => {
    setLoadingId(milestone.id);

    try {
      const { data: json } = await fetchWithTimeout<ClaimResponse>(
        '/api/game/milestone/claim',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            milestone_id: milestone.milestoneId,
          }),
        },
      );

      if (json?.ok && json.data) {
        const { reward_type, reward_value } = json.data;
        const particleType: ParticleType = reward_type === 'ENERGY' ? 'gold' : 'blue';

        // Particle burst centered on the milestone badge
        spawnParticles(particleType, 50, 45);

        // Toast with reward name
        const rewardLabel = reward_type === 'ENERGY'
          ? `电量 +${reward_value}`
          : `获得勋章：${reward_value}`;
        toast.success(`🎉 领取成功！${rewardLabel}`, 4000);

        // Optimistic inventory update if energy reward
        if (reward_type === 'ENERGY' && onInventoryUpdate) {
          onInventoryUpdate({
            item_hand: currentInventory.item_hand + 1,
            item_phallus: currentInventory.item_phallus,
          });
        }

        // Return the claimed id so parent can update state
        return milestone.milestoneId;
      } else {
        const code = json?.error?.code ?? 'UNKNOWN';
        const msg = json?.error?.message ?? '领取失败';

        switch (code) {
          case 'ALREADY_CLAIMED':
            toast.warning('已领取', 3000);
            break;
          case 'THRESHOLD_NOT_MET':
            toast.warning('累计伤害未达标', 3000);
            break;
          case 'ACTIVITY_ENDED':
            toast.warning('活动已结束，无法领取', 3000);
            break;
          default:
            toast.error(msg, 4000);
        }
        return null;
      }
    } catch {
      toast.error('网络异常，请稍后重试', 4000);
      return null;
    } finally {
      setLoadingId(null);
    }
  }, [onInventoryUpdate]);

  return { handleClaim, loadingId };
}

// ── Milestone Badge ───────────────────────────────────────────────────────────

function MilestoneBadge({
  milestone,
  isUnlocked,
  isClaimed,
  isLoading,
  onClaim,
  currentInventory,
}: {
  milestone: MilestoneReward;
  isUnlocked: boolean;
  isClaimed: boolean;
  isLoading: boolean;
  onClaim: () => void;
  currentInventory: { item_hand: number; item_phallus: number };
}) {
  const isEnergy = milestone.rewardType === 'ENERGY';

  return (
    <motion.div
      layout
      className="relative flex flex-col items-center gap-1"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
    >
      {/* Badge circle */}
      <button
        onClick={onClaim}
        disabled={isClaimed || isLoading}
        className="relative w-12 h-12 rounded-full flex items-center justify-center transition-all"
        style={{
          // Claimed: permanent green glow
          background: isClaimed
            ? 'linear-gradient(135deg, #3DD68C, #10B981)'
            : isUnlocked
            ? 'linear-gradient(135deg, #9B5CFF, #FF2D87)'
            : 'rgba(255,255,255,0.06)',
          boxShadow: isClaimed
            ? '0 0 16px rgba(61,214,140,0.6), 0 0 32px rgba(61,214,140,0.2)'
            : isUnlocked
            ? '0 0 16px rgba(155,92,255,0.5)'
            : 'none',
          filter: !isUnlocked && !isClaimed ? 'grayscale(1)' : 'none',
          opacity: !isUnlocked && !isClaimed ? 0.4 : 1,
          cursor: isClaimed ? 'default' : isUnlocked ? 'pointer' : 'not-allowed',
          // Claimable pulse animation
          animation: isUnlocked && !isClaimed ? 'badgePulse 2s ease-in-out infinite' : 'none',
        }}
      >
        {/* Checkmark overlay for claimed */}
        {isClaimed ? (
          <CheckCircle size={22} className="text-white" />
        ) : !isUnlocked ? (
          <Lock size={18} className="text-white/30" />
        ) : (
          <span className="text-base">
            {isEnergy ? (
              <Zap size={20} className="text-amber-400" />
            ) : (
              <span className="text-lg">🏅</span>
            )}
          </span>
        )}

        {/* Pulse ring for claimable state */}
        {isUnlocked && !isClaimed && (
          <span
            className="absolute inset-0 rounded-full animate-ping opacity-30"
            style={{
              background: 'transparent',
              border: '2px solid rgba(155,92,255,0.6)',
            }}
          />
        )}
      </button>

      {/* HP % label */}
      <span
        className="text-[10px] font-bold"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          color: isClaimed ? '#3DD68C' : isUnlocked ? '#FFD060' : 'rgba(255,255,255,0.3)',
        }}
      >
        {milestone.milestoneId}%
      </span>

      {/* Reward label */}
      <span
        className="text-[9px] text-center leading-tight px-1"
        style={{
          color: isClaimed ? '#3DD68C' : isUnlocked ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)',
          maxWidth: '52px',
        }}
      >
        {milestone.rewardValue}
      </span>
    </motion.div>
  );
}

// ── Plasma Flow Progress Bar ──────────────────────────────────────────────────

function PlasmaBar({ pct }: { pct: number }) {
  return (
    <div
      className="relative h-3 rounded-full overflow-hidden"
      style={{ background: 'rgba(255,255,255,0.08)' }}
    >
      {/* Base fill */}
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #FFD060 0%, #FF2D87 60%, #9B5CFF 100%)',
          transition: 'width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      />

      {/* Plasma overlay: animated gradient sweep */}
      <div
        className="absolute inset-0 rounded-full overflow-hidden"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 40%, transparent 60%)',
          animation: 'plasmaSweep 3s ease-in-out infinite',
          transition: 'width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
          width: `${pct}%`,
        }}
      />
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function MilestoneBar({
  hpPercent,
  totalDamage,
  maxHp,
  inventory = { item_hand: 0, item_phallus: 0 },
  onInventoryUpdate,
  milestones: propMilestones,
  claimedIds: propClaimedIds,
  milestoneStatusOverride,
}: MilestoneBarProps) {
  const milestones = buildMilestones(maxHp, propMilestones);
  const [claimedIds, setClaimedIds] = useState<Set<number>>(
    propClaimedIds ?? new Set<number>()
  );

  // Sync with prop changes
  useEffect(() => {
    if (propClaimedIds) setClaimedIds(propClaimedIds);
  }, [propClaimedIds]);

  const { handleClaim, loadingId } = useMilestoneClaim(onInventoryUpdate);

  // Damage progress as percentage toward the NEXT unlockable milestone
  const maxDamage = maxHp || 100000;
  const damagePct = Math.min(100, (totalDamage / maxDamage) * 100);

  return (
    <div
      className="w-full px-4 py-3 rounded-2xl"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(155,92,255,0.2)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🏆</span>
          <span className="text-xs font-semibold text-white/80">进度奖励</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-[11px]"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: '#FF2D87' }}
          >
            {totalDamage.toLocaleString()} / {maxDamage.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Plasma progress bar */}
      <div className="mb-4">
        <PlasmaBar pct={damagePct} />
      </div>

      {/* Milestone badges with connecting line */}
      <div className="relative flex items-end justify-between px-2">
        {/* Connecting line behind badges */}
        <div
          className="absolute top-6 left-6 right-6 h-0.5 rounded-full"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        />

        {milestones.map((m) => {
          const isClaimed = claimedIds.has(m.milestoneId);
          // REPARK 7.0 (2026-09-15 round 4):
          //   Prefer the server's verdict from /api/battle/init when the
          //   parent provides it. admin_bypass=true rows must be visually
          //   unlocked even though the player's damage is below the
          //   threshold — otherwise the player is told "累计伤害未达标"
          //   for a reward an admin already authorized them to claim.
          const override = milestoneStatusOverride?.[m.milestoneId];
          const isUnlocked = override?.isUnlocked ?? (totalDamage >= m.threshold);
          // isClaimed still comes from the local set so optimistic claim
          // updates immediately after POST /api/game/milestone/claim land.
          return (
            <MilestoneBadge
              key={m.id}
              milestone={m}
              isUnlocked={isUnlocked}
              isClaimed={isClaimed}
              isLoading={loadingId === m.id}
              onClaim={() => handleClaim(m, inventory)}
              currentInventory={inventory}
            />
          );
        })}
      </div>

      {/* CSS keyframes (global scope via style tag) */}
      <style>{`
        @keyframes badgePulse {
          0%, 100% { box-shadow: 0 0 16px rgba(155,92,255,0.5), 0 0 8px rgba(255,45,135,0.3); }
          50%       { box-shadow: 0 0 24px rgba(155,92,255,0.8), 0 0 16px rgba(255,45,135,0.5); }
        }
        @keyframes plasmaSweep {
          0%   { transform: translateX(-100%); opacity: 0; }
          30%  { opacity: 1; }
          70%  { opacity: 1; }
          100% { transform: translateX(200%); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ── Exported claim callback for external trigger ───────────────────────────────

/**
 * useMilestoneBar — hook for managing milestone claim state from parent components.
 * Returns a claim handler that can be called with a milestone id.
 */
export function useMilestoneBar(
  onInventoryUpdate?: (inv: { item_hand: number; item_phallus: number }) => void
) {
  return useMilestoneClaim(onInventoryUpdate);
}
