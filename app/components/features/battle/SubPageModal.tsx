'use client';

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, Lock, Zap } from 'lucide-react';
import { toast } from '@/app/lib/toastStore';
import { fetchWithTimeout } from '@/app/lib/fetchWithTimeout';
import { useUserId } from '@/app/lib/useUserId';
import { spawnParticles, type ParticleType } from './ParticleEngine';
import { useRewardStore } from '@/lib/rewardStore';
import { AnimatePresence, motion } from 'framer-motion';
import { LeaderboardSheet } from './LeaderboardSheet';

// ════════════════════════════════════════════════════════════════════════════════
// SUB PAGE MODAL — Task & Reward Claim with Backend Integration
//
// Features:
// - Fetches task/reward state from backend
// - Optimistic UI updates on claim
// - Toast notifications for success/error
// - PRD Section 2.10: Idempotency checks on backend
// ════════════════════════════════════════════════════════════════════════════════

// P0 2026-08-19: Slim dark scrollbar — replaces the wide white native bar on
// iOS / desktop.  Applied to every `repark-scroll` container (Task list,
// Rules, etc.).  WebKit (Chrome/Safari) needs the `::-webkit-scrollbar*`
// pseudo-elements; Firefox honours the `scrollbar-width/color` shorthand.
const REPARK_SCROLLBAR_STYLE = `
  .repark-scroll {
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }
  .repark-scroll::-webkit-scrollbar {
    width: 4px;
    height: 4px;
  }
  .repark-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .repark-scroll::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 4px;
  }
  .repark-scroll::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
  .repark-scroll::-webkit-scrollbar-button {
    display: none !important;
  }
`;

// Milestone definition from activity config (game/init)
interface SubPageModalProps {
  page: 'task' | 'reward' | 'rules' | 'leaderboard';
  onClose: () => void;
  // Callback to notify parent of inventory changes
  onInventoryUpdate?: (inventory: { item_hand: number; item_phallus: number }) => void;
  // Callback to notify parent of task claim (for progress bar refresh)
  onTaskClaimed?: (taskType: 'daily_energy' | 'daily_recharge') => void;
  // Current inventory from parent
  currentInventory?: { item_hand: number; item_phallus: number };
  // Current task state from parent (includes targetThreshold from API)
  taskState?: {
    daily_energy: { currentProgress: number; targetThreshold: number; isClaimed: boolean; remainingAttempts: number; dailyLimit: number };
    daily_recharge: { currentProgress: number; targetThreshold: number; isClaimed: boolean; remainingAttempts: number; dailyLimit: number };
  };
  // FIX T-02: Dynamic task thresholds from /api/battle/init
  taskConfig?: { daily_energy: number; daily_recharge: number };
  // P0 2026-08-19: Explicit battle init data from BattleLayout — this is the
  // canonical source of truth for milestones and boss state. SubPageModal no
  // longer manages its own battleInit state; it receives it as a prop so there
  // is exactly one source of data (the parent's /api/battle/init result).
  //
  // REPARK 7.0 (2026-08-24): `server_total_damage` (global boss HP delta) was
  // REMOVED — `personal_damage` (this player's accumulated damage) is now the
  // reward unlock metric. Boss HP still lives in `boss.currentHp/maxHp` for
  // stage visuals.
  battleInit?: {
    personal_damage?: number;
    // REPARK 7.0 (2026-08-28) Batch B: admin-configured item display names
    // surface here so the rules text, claim toast, and task reward labels
    // reflect operator renames. Missing/empty falls back to legacy defaults
    // ("闪电符文" / "潮汐晶石") at the consumer.
    config?: { milestones?: unknown[]; items?: { propA?: { name?: string }; propB?: { name?: string } } };
    user?: { milestones?: unknown[]; inventory?: { total_damage_dealt?: number } };
    boss?: { currentHp?: number; maxHp?: number };
  } | null;
  /** Dynamic rules text from /api/battle/init */
  activityRules?: string;
}

interface Task {
  id: number;
  title: string;
  progress: number;
  target: number;
  reward: string;
  type: 'consume' | 'recharge';
  /** P0 2026-08-19: The raw API task_type string — 'daily_energy' or
   *  'daily_recharge'. Added to expose the correct value in error diagnostics
   *  and to prevent the 400 from task_type mismatches. */
  task_type: 'daily_energy' | 'daily_recharge';
  claimable: boolean;
  claimed: boolean;
  remainingAttempts: number;
  // P0 2026-07-30: daily claim limit from activity config (e.g. 5).
  // Renders the denominator of "今日剩余 X/Y 次" dynamically.
  dailyLimit: number;
}

interface Reward {
  id: number;
  milestoneId: number;
  damage: number;
  claimed: boolean;
  rewardType: 'gem' | 'badge';
  rewardValue: string;
  /** REPARK 7.0 (2026-09-13): Main Station badge display name resolved by
   *  the server (`/api/battle/init` attaches badgeName to MEDAL milestones).
   *  null when the upstream was unreachable or has no record for this id. */
  badgeName: string | null;
  unlocked: boolean;
  claimable: boolean;
  /** REPARK 7.0 (2026-09-18 round 2): admin-level lock — can NEVER be claimed
   *  regardless of damage or bypass. Displayed as "已锁定" in the UI. */
  locked: boolean;
}

interface UserStatusResponse {
  user_id: string;
  canonical_user_id?: string;
  inventory: { item_hand: number; item_phallus: number };
  daily_tasks: { daily_energy_consumed: number; daily_money_recharged: number };
  total_damage: number;
  has_unclaimed_milestone?: boolean;
}

interface TaskClaimResponse {
  ok: boolean;
  data?: {
    task_type: string;
    claimed: boolean;
    reward_item: string;
    inventory: { item_hand: number; item_phallus: number };
  };
  error?: { code: string; message: string };
}

// ── Reward Claim Response ────────────────────────────────────────────────────
interface RewardClaimResponse {
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

// ─── Bottom Sheet: Task + Reward ───────────────────────────────────────────────
function BottomSheetContent({
  page,
  onClose,
  tasks,
  rewards,
  damageToNext,
  isLoading,
  loadingTask,
  loadingReward,
  onClaimTask,
  onClaimReward,
  // P0 2026-07-30: server-driven boss state for the dynamic threshold text.
  bossState,
  // P0 2026-07-30: battleInit carries the full /api/battle/init payload
  // (config + user state + boss state) for the dual-damage header.
  battleInit,
  // P0 2026-07-30: nextMilestone drives the "距下一奖励" hint text.
  nextMilestone,
}: {
  page: 'task' | 'reward';
  onClose: () => void;
  tasks: Task[];
  rewards: Reward[];
  damageToNext: number;
  isLoading: boolean;
  loadingTask: string | null;
  loadingReward: number | null;
  onClaimTask: (type: 'daily_energy' | 'daily_recharge', id: string) => void;
  onClaimReward: (milestoneId: number) => void;
  bossState: { currentHp: number; maxHp: number } | null;
  battleInit?: {
    // REPARK 7.0 (2026-08-24): was server_total_damage (global boss HP delta).
    // Now personal_damage (this player's accumulated damage) — the new source
    // of truth for milestone unlock.
    personal_damage?: number;
    config?: { milestones?: unknown[] };
    user?: { milestones?: unknown[]; inventory?: { total_damage_dealt?: number } };
    boss?: { currentHp?: number; maxHp?: number };
  } | null;
  nextMilestone?: (
    | { kind: 'distance'; damage: number; unlocked: boolean; claimed: boolean; damageToNext: number }
    | { kind: 'claimable'; damage: number; unlocked: boolean; claimed: boolean; damageToNext: number }
    | { kind: 'all_done'; damage: number; unlocked: boolean; claimed: boolean; damageToNext: number }
    | { kind: 'all_locked_or_claimed'; damage: number; unlocked: boolean; claimed: boolean; damageToNext: number }
  ) | null;
}) {
  const isTask = page === 'task';

  // REPARK 7.0 (2026-08-24): ACTIVITY-SCOPED personal damage for the summary
  // header. Derived here from battleInit.personal_damage (the same source as
  // SubPageModalComponent uses for unlock logic) — NEVER fall back to the
  // global `user.inventory.total_damage_dealt`.
  const personalDamage =
    typeof battleInit?.personal_damage === 'number' ? battleInit.personal_damage : 0;

  return (
    <div
      className="relative w-full h-full rounded-t-3xl md:rounded-2xl overflow-hidden md:max-w-[500px] flex flex-col"
      style={{
        background: 'linear-gradient(180deg, rgba(20,10,40,0.98) 0%, rgba(10,5,25,0.99) 100%)',
        border: '1px solid rgba(155,92,255,0.3)',
        boxShadow: '0 0 60px rgba(155,92,255,0.3), 0 -20px 60px rgba(0,0,0,0.5)',
      }}
    >
        {/* Drag handle (mobile) */}
        <div className="h-1 w-12 bg-white/20 rounded-full mx-auto mt-3 md:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-lg">{isTask ? '📋' : '🎁'}</span>
            <div>
              <h2 className="text-base font-bold text-white">
                {isTask ? '每日任务' : '进度奖励'}
              </h2>
              {isTask && (
                <p className="text-[11px] text-white/40">
                  每日 00:00 重置 · 完成可获得攻击道具
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            title="关闭弹窗"
            aria-label="关闭弹窗"
            className="w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all"
          >
            <X size={18} className="text-white/80" />
          </button>
        </div>

        {/* Content — fills remaining height of the locked 540px shell.
            Opacity is always 1. When battleInit arrives, the reward list
            renders immediately without any fade/dim so the user sees the full
            content without any intermediate transparent state.

            REPARK 6.0 (2026-08-18) — fixed inverted condition:
            BEFORE: `(page === 'reward' && !battleInit) ? 0.35 : 1`
                     → reward page OPEN but data LOADING → content 35% visible
                     → content becomes opaque only AFTER data arrives  ← backwards
            AFTER:  always `opacity: 1` — data arrival causes no dimming */}
        <div
          className="repark-scroll flex-1 min-h-0 overflow-y-auto px-4 py-4"
          style={{ opacity: 1 }}
        >

          {/* TASK PAGE */}
          {isTask && (
            <div className="space-y-3">
              {tasks.map((task) => {
                const isLoadingThis = loadingTask === task.type;
                // P0 2026-08-01 FIX: 智能单位归一化 — 仅作用于充值任务，不影响消耗任务。
                //   - 目标阈值随时调整（已观察 88 元 / 8800 分两种配置），target > 100 一律视为分(cent)
                //   - progress 走 /api/user/status 已 centsToYuan(÷100) 转元，统一为元单位参与 percent 计算
                //   - 容错：NaN/undefined/null → 安全 fallback，不允许宽度 NaN 把进度条撑爆
                let displayProgress: number = task.progress;
                let displayTarget: number = task.target;
                let safePercent: number = Math.min(100, Math.max(0, (displayProgress / displayTarget) * 100));
                if (task.type === 'recharge') {
                  const rawProgress = Number(task.progress) || 0;
                  let rawTarget = Number(task.target) || 0;
                  // threshold > 100 → 配置单位为分(cents)，自动转元（yuan）
                  if (rawTarget > 100) {
                    rawTarget = rawTarget / 100;
                  }
                  const rawPercent = rawTarget > 0 ? (rawProgress / rawTarget) * 100 : 0;
                  safePercent = Math.min(100, Math.max(0, Number.isNaN(rawPercent) ? 0 : rawPercent));
                  displayProgress = rawProgress;
                  displayTarget = rawTarget;
                  console.warn(
                    `[Recharge Task Progress] Progress: ${rawProgress}元, Target: ${rawTarget}元, Percent: ${safePercent}%`
                  );
                }
                return (
                  <div
                    key={task.id}
                    className="p-4 rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            task.type === 'consume'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                              : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          }`}
                        >
                          {task.type === 'consume' ? '消耗任务' : '充值任务'}
                        </span>
                        <span className="text-[11px] text-white/40">
                          奖励：<strong className="text-white/70">{task.reward}</strong>
                        </span>
                      </div>
                    </div>

                    <h3 className="text-sm font-semibold text-white mb-3">{task.title}</h3>

                    {/* Progress bar — width 来自归一化百分比 (recharge) 或原始算法 (consume) */}
                    <div
                      className="h-2 rounded-full overflow-hidden mb-2"
                      style={{ background: 'rgba(255,255,255,0.1)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${safePercent}%`,
                          background: task.type === 'consume'
                            ? 'linear-gradient(90deg, #FFD060, #FF2D87)'
                            : 'linear-gradient(90deg, #00D4FF, #9B5CFF)',
                        }}
                      />
                    </div>

                    <div className="flex justify-between items-center mb-1">
                      <span
                        className="text-[11px] text-white/50"
                        style={{ fontFamily: "'JetBrains Mono', monospace" }}
                      >
                        {task.type === 'recharge'
                          ? `${displayProgress.toFixed(2)} / ${displayTarget} 元`
                          : `${task.progress} / ${task.target} ${task.type === 'consume' ? '电量' : '元'}`}
                      </span>
                      <span
                        className="text-[11px] text-white/40"
                        style={{ fontFamily: "'JetBrains Mono', monospace" }}
                      >
                        {/* P0 2026-07-30 FIX: denominator was hardcoded "/1 次". Now
                            uses the configured daily limit (5) from taskState, with
                            the numerator being remaining attempts from server state.
                            Backend currently tracks one claim per task per day, so
                            remainingAttempts is 0 (claimed) or 1 (not yet claimed).
                            The daily limit of 5 is the admin-configured upper bound. */}
                        今日剩余 {task.remainingAttempts}/{task.dailyLimit} 次
                      </span>
                    </div>

                    <button
                      onClick={() => onClaimTask(task.task_type, task.id.toString())}
                      disabled={!task.claimable || task.claimed || isLoadingThis}
                      className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all ${
                        task.claimed
                          ? 'bg-green-500/20 text-green-400 cursor-not-allowed'
                          : task.claimable
                          ? 'bg-gradient-to-r from-amber-500 to-pink-500 text-white hover:opacity-90 active:scale-[0.98]'
                          : 'bg-white/10 text-white/40 cursor-not-allowed'
                      }`}
                    >
                      {isLoadingThis ? '领取中…' : task.claimed ? '已领取' : task.claimable ? '领取' : '未完成'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* REWARD PAGE */}
          {!isTask && (
            <div className="space-y-3">
              {/* P0 2026-07-30 FIX: Show BOTH personal damage and global boss damage
                  side-by-side so the player understands their contribution vs server progress. */}
              {/* Summary */}
              <div
                className="flex items-center justify-between p-4 rounded-xl mb-4"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                {/* REPARK 7.0 (2026-08-24): Left side is the ACTIVITY-SCOPED
                    personal damage, sourced from battleInit.personal_damage
                    (computed at the top of SubPageModalComponent). We display
                    "本活动累计伤害" so the player understands the metric is
                    scoped to the current activity — not the all-time total. */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span>👤</span>
                    <span className="text-xs text-white/60">本活动累计伤害</span>
                  </div>
                  <p
                    className="text-xl font-bold text-white"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {personalDamage.toLocaleString()}
                    <span className="text-[11px] text-white/40 ml-1">点</span>
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5">
                    个人活动贡献（仅本活动）
                  </p>
                </div>

                {/* Divider */}
                <div
                  className="w-px h-12 mx-3"
                  style={{ background: 'rgba(255,255,255,0.1)' }}
                />

                {/* Right: global boss damage */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span>🌍</span>
                    <span className="text-xs text-white/60">全服 BOSS 累计承受伤害</span>
                  </div>
                  <p
                    className="text-xl font-bold"
                    style={{ fontFamily: "'JetBrains Mono', monospace", color: '#FF2D87' }}
                  >
                    {(bossState ? Math.max(0, bossState.maxHp - bossState.currentHp) : 0).toLocaleString()}
                    <span className="text-[11px] text-white/40 ml-1">点</span>
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5">
                    全服玩家共同推进
                  </p>
                </div>
              </div>

              {/* Gap to next milestone hint — four-case classification (REPARK 7.0 2026-09-19). */}
              <div
                className="flex items-center justify-between px-4 py-2 rounded-lg"
                style={{ background: 'rgba(255,45,135,0.08)', border: '1px solid rgba(255,45,135,0.2)' }}
              >
                {nextMilestone ? (
                  (nextMilestone.kind === 'distance') ? (
                    <>
                      <span className="text-[11px] text-white/60">
                        距下一奖励{' '}
                        <span style={{ color: '#FF2D87', fontFamily: "'JetBrains Mono', monospace" }}>
                          {nextMilestone.damageToNext.toLocaleString()}
                        </span>{' '}
                        点个人伤害
                      </span>
                      <span className="text-[11px] text-white/40">
                        {nextMilestone.unlocked
                          ? nextMilestone.claimed
                            ? '已领取'
                            : '可领取'
                          : `需 ${nextMilestone.damage.toLocaleString()} 点伤害解锁`}
                      </span>
                    </>
                  ) : (nextMilestone.kind === 'claimable') ? (
                    <>
                      <span className="text-[11px] text-amber-300/90">
                        有奖励可领取
                      </span>
                      <span
                        className="text-[11px] text-white/40"
                        style={{ fontFamily: "'JetBrains Mono', monospace" }}
                      >
                        本活动累计伤害 {personalDamage.toLocaleString()} 点
                      </span>
                    </>
                  ) : (nextMilestone.kind === 'all_done') ? (
                    <span className="text-[11px] text-green-400/80">
                      全部进度奖励已达成
                    </span>
                  ) : (
                    <span className="text-[11px] text-white/50">
                      所有奖励已锁定 · 请联系管理员
                    </span>
                  )
                ) : (
                  <span className="text-[11px] text-white/50">
                    所有奖励已锁定 · 请联系管理员
                  </span>
                )}
              </div>

              {/* Reward items */}
              {rewards.map((reward) => {
                const isClaimed = reward.claimed;
                const isUnlocked = reward.unlocked;
                const isClaimable = reward.claimable;
                const isLoadingThis = loadingReward === reward.milestoneId;

                return (
                  <div
                    key={reward.id}
                    className="flex items-center gap-3 p-3 rounded-xl"
                    style={{
                      background: isClaimed ? 'rgba(61,214,140,0.05)' : 'rgba(255,255,255,0.03)',
                      border: isClaimed ? '1px solid rgba(61,214,140,0.2)' : '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        background: isClaimed
                          ? 'linear-gradient(135deg, #3DD68C, #10B981)'
                          : reward.locked
                          ? 'rgba(156,163,175,0.15)'
                          : isUnlocked
                          ? 'linear-gradient(135deg, #9B5CFF, #FF2D87)'
                          : 'rgba(255,255,255,0.1)',
                        boxShadow: isClaimed
                          ? '0 0 12px rgba(61,214,140,0.4)'
                          : reward.locked
                          ? '0 0 12px rgba(156,163,175,0.2)'
                          : isUnlocked
                          ? '0 0 12px rgba(155,92,255,0.4)'
                          : 'none',
                      }}
                    >
                      {isClaimed ? (
                        <CheckCircle size={16} className="text-white" />
                      ) : (
                        <Lock size={14} className={isUnlocked && !reward.locked ? 'text-white/80' : 'text-white/30'} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/90">
                        {/* REPARK 7.0 (2026-08-24): Milestone threshold is
                            compared against ACTIVITY-SCOPED personal damage
                            (this player's damage in the CURRENT activity).
                            Copy "本活动累计伤害" makes the scope explicit so
                            the player doesn't confuse it with global boss HP
                            or all-time totals. */}
                        本活动累计伤害达到{' '}
                        <strong style={{ color: '#FFD060' }}>
                          {reward.damage.toLocaleString()}
                        </strong>{' '}
                        点即可领取
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {reward.rewardType === 'gem' ? (
                          <>
                            <Zap size={14} className="text-amber-400" />
                            <span className="text-[11px] text-white/60">+{reward.rewardValue} 电量</span>
                          </>
                        ) : (
                          <>
                            <div
                              className="w-6 h-6 rounded flex items-center justify-center"
                              style={{
                                background: 'linear-gradient(135deg, #9B5CFF, #FF2D87)',
                                border: '1px solid rgba(155,92,255,0.3)',
                              }}
                            >
                              🏅
                            </div>
                            {/* REPARK 7.0 (2026-09-13): prefer the server-resolved
                                Main Station badge name when available; otherwise
                                show "勋章（ID：X）" if we have a numeric id; fall
                                back to the generic "勋章" label. Applies to both
                                待领取 and 已领取 states. */}
                            <span className="text-[11px] text-purple-300 font-medium">
                              {reward.badgeName
                                ? reward.badgeName
                                : reward.rewardValue
                                  ? `勋章（ID：${reward.rewardValue}）`
                                  : '勋章'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => onClaimReward(reward.milestoneId)}
                      disabled={!isClaimable || isLoadingThis}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all flex-shrink-0 ${
                        isClaimed
                          ? 'bg-green-500/20 text-green-400'
                          : reward.locked
                          ? 'bg-gray-500/20 text-gray-400 cursor-not-allowed'
                          : isClaimable
                          ? 'bg-gradient-to-r from-amber-500 to-pink-500 text-white hover:opacity-90'
                          : 'bg-white/10 text-white/40 cursor-not-allowed'
                      }`}
                    >
                      {isLoadingThis ? '领取中…' : isClaimed ? '已领取' : reward.locked ? '已锁定' : isClaimable ? '领取' : '未达标'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
  );
}

// ─── Rules Modal ───────────────────────────────────────────────────────────────
// REPARK 7.0 (2026-08-28) Batch B: Accept the resolved item display names
// (with legacy fallback already applied at the parent) so the static fallback
// block in this modal reflects operator renames without duplicating the
// fallback logic here.
function RulesModalContent({
  onClose,
  rules,
  propADisplayName,
  propBDisplayName,
}: {
  onClose: () => void;
  rules?: string;
  propADisplayName: string;
  propBDisplayName: string;
}) {
  // Parse rules into sections by splitting on section headers
  const sections = rules
    ? rules.split('\n\n').filter(s => s.trim())
    : null;

  return (
    <div
      className="relative w-full max-w-md rounded-2xl overflow-hidden pointer-events-auto"
      style={{
        background: 'linear-gradient(180deg, rgba(20,10,40,0.98) 0%, rgba(10,5,25,0.99) 100%)',
        border: '1px solid rgba(155,92,255,0.3)',
        boxShadow: '0 0 60px rgba(155,92,255,0.3)',
      }}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="text-lg">📜</span>
            <h2 className="text-base font-bold text-white">活动规则</h2>
          </div>
          <button
            onClick={onClose}
            title="关闭弹窗"
            aria-label="关闭弹窗"
            className="w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all"
          >
            <X size={18} className="text-white/80" />
          </button>
        </div>

        {/* Content */}
        <div className="repark-scroll overflow-y-auto px-4 py-4 space-y-4" style={{ maxHeight: 'calc(80vh - 80px)' }}>
          {sections ? (
            // Dynamic rules rendering
            sections.map((section, index) => {
              const lines = section.split('\n').filter(l => l.trim());
              const title = lines[0].replace(/^【|】$/g, '').replace(/\u25CF$/, '');
              const content = lines.slice(1);

              return (
                <div
                  key={index}
                  className="p-4 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <h3 className="text-sm font-bold text-purple-400 mb-2 flex items-center gap-2">
                    {title.startsWith('活动时间') && '📅'}
                    {title.startsWith('活动玩法') && '🎮'}
                    {title.startsWith('奖励说明') && '🎁'}
                    {title.startsWith('道具说明') && '⚡'}
                    {title}
                  </h3>
                  <ul className="space-y-2 text-xs text-white/60">
                    {content.map((line, lineIndex) => (
                      <li key={lineIndex} className="flex items-start gap-2">
                        <span className="text-purple-400">•</span>
                        <span>{line.replace(/^•\s*/, '')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          ) : (
            // Fallback static rules
            <>
              <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h3 className="text-sm font-bold text-purple-400 mb-2 flex items-center gap-2">📅 活动时间</h3>
                <p className="text-xs text-white/60">活动期间有效（以官方公告时间为准）</p>
              </div>

              <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h3 className="text-sm font-bold text-pink-400 mb-2 flex items-center gap-2">🎮 活动玩法</h3>
                <ul className="space-y-2 text-xs text-white/60">
                  <li className="flex items-start gap-2"><span className="text-purple-400">•</span><span>完成每日任务，获得攻击道具</span></li>
                  <li className="flex items-start gap-2"><span className="text-purple-400">•</span><span>使用道具攻击 BOSS，保底 1 点伤害</span></li>
                  <li className="flex items-start gap-2"><span className="text-purple-400">•</span><span>全服共享血条，全体玩家一起挑战 BOSS</span></li>
                  <li className="flex items-start gap-2"><span className="text-purple-400">•</span><span>BOSS 血量到达阶段节点，解锁新形态</span></li>
                </ul>
              </div>

              <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h3 className="text-sm font-bold text-amber-400 mb-2 flex items-center gap-2">🎁 奖励说明</h3>
                <ul className="space-y-2 text-xs text-white/60">
                  <li className="flex items-start gap-2"><span className="text-amber-400">•</span><span>全服玩家累计对 BOSS 造成伤害达到指定阈值时，可领取阶段奖励</span></li>
                  <li className="flex items-start gap-2"><span className="text-amber-400">•</span><span>每个里程碑仅可领取一次</span></li>
                </ul>
              </div>

              <div className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h3 className="text-sm font-bold text-cyan-400 mb-2 flex items-center gap-2">⚡ 道具说明</h3>
                <ul className="space-y-2 text-xs text-white/60">
                  <li className="flex items-start gap-2"><span className="text-cyan-400">•</span><span>{propADisplayName}：完成单日消耗电量任务获得</span></li>
                  <li className="flex items-start gap-2"><span className="text-cyan-400">•</span><span>{propBDisplayName}：完成单日充值金额任务获得</span></li>
                  <li className="flex items-start gap-2"><span className="text-cyan-400">•</span><span>活动结束后道具清零，不予补偿</span></li>
                </ul>
              </div>
            </>
          )}
        </div>
    </div>
  );
}

// ─── Leaderboard Modal ───────────────────────────────────────────────────────────
function LeaderboardModalContent({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="relative w-full rounded-t-3xl md:rounded-2xl md:max-w-[500px] flex flex-col pointer-events-auto overflow-hidden"
      style={{
        maxHeight: '75vh',
        height: '75vh',
        background: 'linear-gradient(180deg, rgba(12,6,28,0.99) 0%, rgba(3,3,4,1) 100%)',
        border: '1px solid rgba(255,215,0,0.2)',
        boxShadow: '0 -8px 60px rgba(255,215,0,0.08), 0 -2px 20px rgba(0,0,0,0.6)',
      }}
    >
      {/* Drag handle */}
      <div className="flex justify-center pt-3 pb-1 shrink-0">
        <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.15)' }} />
      </div>
      <LeaderboardSheet isOpen={true} onClose={onClose} />
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────

function SubPageModalComponent({
  page,
  onClose,
  onInventoryUpdate,
  onTaskClaimed,
  currentInventory = { item_hand: 0, item_phallus: 0 },
  taskState,
  taskConfig,
  battleInit,
  activityRules,
}: SubPageModalProps) {
  // FIX v1.7: mounted guard — prevents SSR/hydration flash and ensures the
  // portal root is available before we attempt to createPortal.
  // NOTE: do NOT move this into the page useEffect below; it must fire ONCE
  // on first render (not on page changes) to gate the entire portal render.
  const [mounted, setMounted] = useState(false);

  // REPARK 6.0 — P0 2026-07-25 — surface what UID we're calling the backend with.
  const subPageUserId = useUserId();
  useEffect(() => {
    setMounted(true);
    console.log(`[SubPageModal] MOUNT page=${page}`);
    console.log('[REPARK FRONTEND DEBUG] (SubPageModal) cookie=', JSON.stringify(document.cookie || '(empty)'));
    console.log('[REPARK FRONTEND DEBUG] (SubPageModal) userId=', subPageUserId);
    // P0 2026-08-19: Inject the global slim-scrollbar stylesheet once on
    // mount.  We append a <style> tag to <head> with a stable id so we can
    // detect re-mounts and avoid duplicate insertions.
    if (typeof document !== 'undefined' && !document.getElementById('repark-scrollbar-style')) {
      const tag = document.createElement('style');
      tag.id = 'repark-scrollbar-style';
      tag.appendChild(document.createTextNode(REPARK_SCROLLBAR_STYLE));
      document.head.appendChild(tag);
    }
    return () => {
      console.log(`[SubPageModal] UNMOUNT page=${page}`);
      setMounted(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — one-time lifecycle

  const [isLoading, setIsLoading] = useState(false);
  const [loadingTask, setLoadingTask] = useState<string | null>(null);
  const [loadingReward, setLoadingReward] = useState<number | null>(null);
  const [userStatus, setUserStatus] = useState<UserStatusResponse | null>(null);

  // P0 2026-08-22 REPARK — Optimistic State Lock (flicker fix)
  //
  // Problem: handleClaimReward's `finally` block clears `loadingReward` the
  // instant the network response lands, but `refetchStatus()` is async
  // (200ms+ round-trip). In that gap, the rendered Reward array still has
  // `claimable=true` because `apiStatus.isClaimed` hasn't updated yet, so the
  // button briefly reverts to the orange "领取" state — users can spam-click
  // before the red "已领取" style arrives.
  //
  // Fix: an *immediate* in-component `Set<number>` of locally-claimed IDs.
  // We add the targetId on success before refetchStatus fires, and the render
  // layer merges it with `apiStatus.isClaimed`. The button stays locked in
  // "已领取" state from the moment the API succeeds until the next render
  // observes the server-truth `apiStatus.isClaimed=true` (which is idempotent).
  // Refetch eventually converges the Set + apiStatus, then the Set keeps the
  // answer "yes" until the next remount.
  const [locallyClaimedIds, setLocallyClaimedIds] = useState<Set<number>>(
    () => new Set(),
  );

  // REPARK 7.0 (2026-08-24): Milestones are ACTIVITY-SCOPED personal damage
  // rewards. `personal_damage` from /api/battle/init is the ONLY authoritative
  // source — the previous fallback to `user.inventory.total_damage_dealt`
  // (global / all-time across every activity) is REMOVED because it would
  // falsely unlock milestones from prior activities.
  //
  // When `personal_damage` is missing from the payload, the player is treated
  // as having 0 activity damage — the modal renders the locks as locked,
  // which is the safe default.
  const bossState = battleInit?.boss;
  // ACTIVITY-SCOPED personal damage (this player's damage in the CURRENT
  // activity only) — used for milestone unlock and the summary header.
  // NEVER fall back to user.inventory.total_damage_dealt — that is global.
  const personalDamage =
    typeof battleInit?.personal_damage === 'number' ? battleInit.personal_damage : 0;

  // REPARK 7.0 (2026-09-14): Build a milestoneId → badgeName lookup from the
  // same milestones that drive the rendered list. Used by handleClaimReward so
  // the success toast shows the real badge name instead of just the medal ID.
  // Map is keyed by normalised integer id (strips "m" prefix from legacy ids).
  const badgeNameById = useMemo(() => {
    const raw = battleInit?.config?.milestones as Array<Record<string, unknown>> | undefined;
    if (!raw || !Array.isArray(raw)) return new Map<number, string | null>();
    const map = new Map<number, string | null>();
    for (const m of raw) {
      const idRaw = m.id;
      const idStr = String(idRaw ?? '');
      const idNum = Number(idStr.replace(/\D/g, ''));
      if (!Number.isFinite(idNum)) continue;
      const rawName = m.badgeName;
      const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : null;
      map.set(idNum, name);
    }
    return map;
  }, [battleInit?.config?.milestones]);

  // REPARK 7.0 (2026-08-28) Batch B: Resolve admin-configured item display names
  // with the legacy "闪电符文" / "潮汐晶石" fallback. The pattern is intentionally
  // `configuredName?.trim() || legacyDefault` so:
  //   - Empty / whitespace-only name → legacy default renders unchanged.
  //   - Undefined / missing from payload → legacy default renders unchanged.
  //   - Valid configured name → propagates to all 5 H5 label sites below.
  // We never invent a new default at the consumer — the spec's "fallback to
  // existing legacy/default display name" is satisfied by `|| 'legacy'`.
  const propADisplayName =
    (battleInit?.config?.items?.propA?.name ?? '').trim() || '闪电符文';
  const propBDisplayName =
    (battleInit?.config?.items?.propB?.name ?? '').trim() || '潮汐晶石';

  // P0 2026-08-19: Refresh /api/user/status only (battleInit comes from parent props).
  // Called after a successful task/reward claim to sync inventory and task progress.
  const refetchStatus = useCallback(async () => {
    try {
      let explicitUid: string | null = null;
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        explicitUid = params.get('uid') ?? params.get('userId');
      }
      const effectiveUid = explicitUid || subPageUserId;
      const statusUrl = effectiveUid
        ? `/api/user/status?userId=${encodeURIComponent(effectiveUid)}`
        : '/api/user/status';
      const { data } = await fetchWithTimeout<{ ok: boolean; data?: unknown }>(statusUrl);
      if (data) {
        setUserStatus(data as any);
      }
    } catch (err) {
      console.warn('[SubPageModal] refetchStatus failed:', err);
    }
  }, [subPageUserId]);

  // ── Task Claim Handler ───────────────────────────────────────────────────
  // P0 2026-08-19: taskType is now the canonical API value
  // ('daily_energy' | 'daily_recharge') — no internal mapping needed.
  const handleClaimTask = useCallback(async (taskType: 'daily_energy' | 'daily_recharge', _buttonId: string) => {
    setLoadingTask(taskType);
    setIsLoading(true);

    try {
      const { data: json } = await fetchWithTimeout<TaskClaimResponse>(
        '/api/battle/task-claim',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            task_type: taskType
          }),
        },
      );

      if (json?.ok && json.data) {
        // Success
        // REPARK 7.0 (2026-08-28) Batch B: Surface the admin-configured item
        // name (with legacy fallback) instead of hardcoding "闪电符文" / "潮汐晶石".
        const rewardItem = json.data.reward_item === 'item_hand' ? propADisplayName : propBDisplayName;
        toast.success(`道具已发放：${rewardItem} ×1`, 3000);

        // P0 2026-08-02 FIX: do NOT mark this task as "claimed" locally. With
        // multi-claim enabled, `claimed` is only true when remaining_attempts
        // hits 0 (server-side). Forcing it to true here was the root cause of
        // the button getting stuck on "已领取" after the first successful
        // claim. The button derives `claimed` from `remainingAttempts` on the
        // next render, which is refreshed via `refetchStatus()` below.

        // Update inventory via callback
        if (json.data.inventory && onInventoryUpdate) {
          onInventoryUpdate(json.data.inventory);
        }

        // Notify parent to refresh task state (progress bar)
        if (onTaskClaimed) {
          onTaskClaimed(taskType);
        }

        // Refresh user status
        await refetchStatus();
      } else {
        // Handle specific errors
        const code = json?.error?.code ?? 'UNKNOWN';
        const message = json?.error?.message ?? '领取失败';

        if (code === 'ALREADY_CLAIMED') {
          toast.warning('已领取', 3000);
          // P0 2026-08-02: removed stale setTaskClaimed(true) — the next
          // refetchStatus() will sync the real remainingAttempts.
        } else if (code === 'PROGRESS_NOT_MET') {
          toast.warning('任务进度未达成', 3000);
        } else {
          toast.error(message, 4000);
        }
      }
    } catch (err) {
      console.error('[SubPageModal] Task claim error:', err);
      // P0 2026-08-19: When the server rejects the claim with a 400/409, it returns
      // a JSON body { ok: false, error: { code, message } }.  The fetchWithTimeout
      // wrapper throws FetchError on non-2xx with the body captured in bodyPreview.
      // Parse it so we show the real server rejection reason instead of a generic toast.
      let errorMsg = '网络异常，请重试';
      if (err && typeof err === 'object' && 'payload' in err) {
        const fe = err as { payload?: { kind?: string; status?: number; bodyPreview?: string; cause?: string } };
        const preview = fe.payload?.bodyPreview ?? '';
        if (preview.startsWith('{')) {
          try {
            const parsed = JSON.parse(preview);
            if (parsed?.error?.message) {
              errorMsg = `[${fe.payload?.status ?? '?'}] ${parsed.error.message}`;
            }
          } catch { /* keep fallback */ }
        }
      }
      toast.error(errorMsg, 4000);
    } finally {
      setLoadingTask(null);
      setIsLoading(false);
    }
  }, [refetchStatus, onInventoryUpdate]);

  // ── Reward Claim Handler (V5.16-EN) ───────────────────────────────────────
  // Uses /api/game/milestone/claim with particle burst + rewardStore sync.
  //
  // P0 2026-08-22 REPARK: defensive id extraction.
  // - reward.milestoneId is the canonical field, but older battleInit payloads
  //   may not populate it; fall back to reward.id / milestone_id / milestoneId.
  // - If the value is a "m"-prefixed string like "m1001", strip the prefix so
  //   the backend (which expects the integer form) does not reject the payload
  //   as INVALID_MILESTONE_ID.
  // - If the value is NaN / undefined / empty, short-circuit BEFORE the fetch
  //   and toast a clear error instead of triggering a server-side 400.
  const handleClaimReward = useCallback(async (milestoneId: number | string) => {
    // P0 2026-08-22 REPARK: normalise id so "m1001" → 1001 and 1001 stays 1001.
    // The backend rejects NaN / undefined / empty with HTTP 400 INVALID_MILESTONE_ID.
    const normalised = (() => {
      if (milestoneId === null || milestoneId === undefined || milestoneId === '') return null;
      if (typeof milestoneId === 'number' && Number.isFinite(milestoneId)) return milestoneId;
      const m = String(milestoneId).match(/\d+/);
      return m && m[0] ? Number(m[0]) : null;
    })();
    if (normalised === null || !Number.isFinite(normalised)) {
      console.error('[SubPageModal] handleClaimReward: invalid milestoneId', {
        milestoneId, normalised,
      });
      toast.error('奖励编号无效，请刷新页面后重试', 4000);
      return;
    }
    const targetId: number = normalised;
    setLoadingReward(targetId);
    setIsLoading(true);

    try {
      const { data: json } = await fetchWithTimeout<RewardClaimResponse>(
        '/api/game/milestone/claim',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            milestone_id: targetId,
          }),
        },
      );

      if (json?.ok && json.data) {
        const { reward_type, reward_value } = json.data;

        // Particle burst: gold for ENERGY, blue for MEDAL
        const particleType: ParticleType = reward_type === 'ENERGY' ? 'gold' : 'blue';
        spawnParticles(particleType, 50, 45);

        // Reward label — prefer real badge name from server, fall back to medal ID
        // REPARK 7.0 (2026-09-14): badgeNameById is keyed by normalised integer id.
        const badgeName = badgeNameById.get(targetId);
        const rewardLabel = reward_type === 'ENERGY'
          ? '电量 +' + reward_value
          : badgeName != null
            ? '勋章：' + badgeName
            : reward_value
              ? '勋章（ID：' + reward_value + '）'
              : '勋章';

        // P0 2026-08-22 REPARK — Optimistic State Lock:
        // Lock the local Set FIRST, before any await/refresh, so the next
        // render that fires from `setLoadingReward(null)` in `finally`
        // already sees this ID as claimed. The flicker window is closed.
        setLocallyClaimedIds((prev) => {
          if (prev.has(targetId)) return prev;
          const next = new Set(prev);
          next.add(targetId);
          return next;
        });

        toast.success('领取成功！' + rewardLabel, 3500);

        // Update rewardStore: mark milestone as claimed (drives red-dot badge)
        useRewardStore.getState().setMilestoneClaimed(targetId);

        // Background refresh — failure is non-fatal because the local lock
        // keeps the button in "已领取" state until next mount.
        refetchStatus().catch((err) => {
          console.warn('[SubPageModal] refetchStatus failed (lock still active):', err);
        });
      } else {
        const code = json?.error?.code ?? 'UNKNOWN';
        const message = json?.error?.message ?? '领取失败';

        if (code === 'ALREADY_CLAIMED') {
          toast.warning('已领取', 3000);
          // Mark as claimed in store so red dot disappears
          useRewardStore.getState().setMilestoneClaimed(targetId);
          // ALSO lock locally — the server has told us this id is claimed.
          setLocallyClaimedIds((prev) => {
            if (prev.has(targetId)) return prev;
            const next = new Set(prev);
            next.add(targetId);
            return next;
          });
        } else if (code === 'THRESHOLD_NOT_MET') {
          toast.warning('个人累计伤害未达标', 3000);
        } else if (code === 'ACTIVITY_ENDED') {
          toast.warning('活动已结束', 3000);
        } else {
          toast.error(message, 4000);
        }
      }
    } catch (err) {
      console.error('[SubPageModal] Reward claim error:', err);
      toast.error('网络异常，请重试', 4000);
    } finally {
      setLoadingReward(null);
      setIsLoading(false);
    }
  }, [refetchStatus]);

  // ── Compute task list ───────────────────────────────────────────────────
  // FIX T-02: Thresholds come from API (taskConfig + taskState.targetThreshold).
  // The API enforces the authoritative threshold; this just renders it.
  const consumeThreshold = taskState?.daily_energy?.targetThreshold ?? taskConfig?.daily_energy ?? 100;

  const tasks: Task[] = (() => {
    // P0 2026-07-26 FIX: Drop priority to userStatus (real backend data) and
    // IGNORE taskState's zero (it was masking the real progress via ?? 0 fallback).
    const dailyTasks: UserStatusResponse['daily_tasks'] = userStatus?.daily_tasks ?? { daily_energy_consumed: 0, daily_money_recharged: 0 };
    const consumeProgress = taskState?.daily_energy?.currentProgress
      ?? dailyTasks.daily_energy_consumed
      ?? 0;
    // P0 2026-08-19: /api/battle/init now returns recharge threshold in 元 (yuan)
    // directly — no /100 conversion needed. Use as-is.
    const rechargeProgress = Number(taskState?.daily_recharge?.currentProgress ?? dailyTasks.daily_money_recharged ?? 0) || 0;
    const rawRechargeThreshold = Number(taskState?.daily_recharge?.targetThreshold ?? taskConfig?.daily_recharge ?? 100) || 100;
    // No /100 split: API already returns yuan. Guard against absurd values (> 1e6 = misconfigured cents).
    const rechargeThresholdYuan = rawRechargeThreshold > 1_000_000
      ? Math.round(rawRechargeThreshold / 100)
      : rawRechargeThreshold;

    const consumeRemaining = taskState?.daily_energy?.remainingAttempts ?? 1;
    const rechargeRemaining = taskState?.daily_recharge?.remainingAttempts ?? 1;
    // P0 2026-07-30: daily claim limits from activity config (e.g. 5).
    // Used as the denominator of "今日剩余 X/Y 次".
    const consumeLimit = taskState?.daily_energy?.dailyLimit ?? 5;
    const rechargeLimit = taskState?.daily_recharge?.dailyLimit ?? 5;

    return [
      {
        id: 1,
        title: `单日消耗 ${consumeThreshold} 电量`,
        progress: consumeProgress,
        target: consumeThreshold,
        // REPARK 7.0 (2026-08-28) Batch B: Render admin-configured item name
        // (with legacy fallback) so operator renames propagate to H5 player.
        reward: `${propADisplayName} ×1`,
        type: 'consume',
        task_type: 'daily_energy',
        claimable: consumeProgress >= consumeThreshold,
        // P0 2026-08-02 FIX: `claimed` is the strict "all-attempts-exhausted" flag
        // — true only when remainingAttempts has reached 0. We previously OR'd
        // in a sticky local `taskClaimed` state that was force-set to `true`
        // on the first successful claim, which caused the button to render as
        // "已领取" until the daily limit was reached, blocking multi-claim.
        // Source of truth is now `consumeRemaining` (derived from server-side
        // claimed_count via /api/battle/init).
        claimed: consumeRemaining === 0,
        remainingAttempts: consumeRemaining,
        dailyLimit: consumeLimit,
      },
      {
        id: 2,
        title: `单日充值满 ${rechargeThresholdYuan} 元`,
        progress: rechargeProgress,
        target: rechargeThresholdYuan,
        // REPARK 7.0 (2026-08-28) Batch B: see comment above for propA.
        reward: `${propBDisplayName} ×1`,
        type: 'recharge',
        task_type: 'daily_recharge',
        claimable: rechargeProgress >= rechargeThresholdYuan,
        // P0 2026-08-02 FIX: see daily_energy above — derive `claimed` from
        // `rechargeRemaining === 0` instead of the sticky local state.
        claimed: rechargeRemaining === 0,
        remainingAttempts: rechargeRemaining,
        dailyLimit: rechargeLimit,
      },
    ];
  })();

  // ── Damage / Reward derivation (hoisted BEFORE rewards.map to avoid TDZ) ──
// REPARK 7.0 (2026-08-24): Personal damage (`personalDamage`, computed from
// battleInit earlier) is now the source of truth for milestone unlock. The
// previous `totalBossDamage` (server-wide boss HP delta) is no longer used.

  // ── Compute reward list (P0 2026-07-30 — fully dynamic + P0 2026-08-19 fallback) ──
  // Source of truth for the rendered reward cards:
  //   • Definitions (id, threshold, rewardType, rewardValue)  ← battleInit.config.milestones
  //   • Unlock/claim status                                 ← battleInit.user.milestones
  //
  // REPARK 7.0 (2026-08-24): The server now computes `isUnlocked` against the
  // PLAYER's personal accumulated damage (user_inventory.total_damage_dealt),
  // NOT the global boss HP delta. We do NOT re-derive `unlocked` client-side;
  // we trust the server's `isUnlocked` flag. If the API hasn't loaded yet we
  // treat the milestone as locked.
  //
  // NEVER silently fall back to hardcoded constants — an empty array [] means
  // the admin intentionally cleared milestones; we honour that.
  // rawDefs may be null (no data yet), undefined (key absent), or an array (even []).
  // Null/undefined → use empty array (show nothing until data arrives).
  const rawDefs = battleInit?.config?.milestones;
  const sourceDefs: ReadonlyArray<unknown> = rawDefs ?? [];
  const apiStatus = battleInit?.user?.milestones;

  // Forward-compat field shim: accept both legacy (rewardType/energyValue)
  // and future-proof (reward_type/reward_amount/damage_threshold) payloads.
  const defs: Array<{
    id: number;
    threshold: number;
    rewardType: 'ENERGY' | 'MEDAL';
    rewardValue: string;
    badgeName: string | null;
  }> = (sourceDefs as any[]).map((m) => {
    // P0 2026-08-22 REPARK: Admin may declare milestone ids as "m1001" (string
    // with prefix) while `apiStatus` and the claim handler expect integers.
    // Number("m1001") === NaN silently propagates into `def.id`, breaking
    // apiStatus.find(Number(s.id) === def.id) and yielding NaN milestoneId in
    // the rendered Reward. Strip the prefix via regex before Number() so the
    // rendered milestoneId is always a real integer (1001, 1002, …).
    const idMatch = String(m.id ?? '').match(/\d+/);
    const id = idMatch ? Number(idMatch[0]) : 0;
    const threshold = Number(m.threshold ?? m.damage_threshold ?? 0);
    const rawRewardType = m.rewardType ?? m.reward_type ?? m.type;
    const rewardType: 'ENERGY' | 'MEDAL' =
      rawRewardType === 'ENERGY' || rawRewardType === 'MEDAL' ||
      rawRewardType === 'gem'   || rawRewardType === 'badge' ||
      rawRewardType === 'energy' || rawRewardType === 'medal'
        ? (rawRewardType === 'gem' || rawRewardType === 'energy' ? 'ENERGY' :
           rawRewardType === 'badge' || rawRewardType === 'medal' ? 'MEDAL' : rawRewardType)
        : 'ENERGY';
    const energyValue = m.energyValue ?? m.reward_amount ?? m.amount;
    const medalId = m.medalId ?? m.badge_name ?? m.badgeId ?? m.reward_value;
    const rewardValue =
      rewardType === 'ENERGY' && energyValue != null
        ? String(energyValue)
        : (medalId != null ? String(medalId) : '');
    // REPARK 7.0 (2026-09-13): badgeName is server-resolved and may be a real
    // name, an empty string, or null. We normalise null→null here so the
    // consumer can rely on `null === "no name from server"`.
    const rawBadgeName = m.badgeName;
    const badgeName =
      typeof rawBadgeName === 'string' && rawBadgeName.length > 0
        ? rawBadgeName
        : null;
    return { id, threshold, rewardType, rewardValue, badgeName };
  });

  // REPARK 7.0 (2026-08-24): derive unlock state from PERSONAL damage stored
  // in the reward store. The backend computes isUnlocked against the player's
  // accumulated damage (user_inventory.total_damage_dealt), NOT global boss
  // HP. When battleInit.user.milestones is absent (e.g. API not yet loaded)
  // we fall back to the store value; if both are unavailable we treat the
  // milestone as locked.
  const personalDamageFromStore = useRewardStore((s) => s.personalDamage);

  const rewards: Reward[] = defs.map((def) => {
    const status = apiStatus?.find((s: any) => Number(s.id) === def.id) as
      | { id: number; threshold: number; isUnlocked: boolean; isClaimed: boolean; hasUnclaimedReward: boolean; isLocked: boolean }
      | undefined;
    // REPARK 7.0 (2026-09-15 round 7):
    //   Trust the server's `isUnlocked` flag. The server (init/getMilestoneStatus)
    //   already combines personal damage + admin_bypass + is_locked and is the
    //   authoritative source for unlock state. We previously overrode it with
    //   `personalDamageFromStore >= def.threshold` here, which silently ignored
    //   admin special-unlocks for unmet thresholds — Commander reported the
    //   special-unlocked row stayed "未达标" with the button disabled even when
    //   the admin panel already showed "已特殊解锁".
    //
    //   Threshold=0 guard removed: an admin that defines a milestone with
    //   threshold=0 is asking us to keep it always-unlocked — we already
    //   honour that via server `isUnlocked`, no client fall-back required.
    const isUnlocked = status?.isUnlocked ?? false;
    // REPARK 7.0 (2026-09-18 round 2): surface the server's isLocked field
    // so the UI can render "已锁定" independently from "未达标".
    const isLocked = status?.isLocked ?? false;
    // P0 2026-08-22 REPARK — Optimistic State Lock merge:
    // A milestone is considered claimed if EITHER the server-truth status
    // says so OR the local lock Set contains it. The latter covers the
    // 200ms window between API response and refetchStatus() converging.
    const serverClaimed = status?.isClaimed ?? false;
    const isClaimed = serverClaimed || locallyClaimedIds.has(def.id);
    // claimable when there is an unclaimed reward AND the local lock has
    // not already recorded this id as claimed (the latter is authoritative
    // because it reflects the moment the network call returned 200).
    const isClaimable = !isClaimed && !isLocked && (status?.hasUnclaimedReward ?? (isUnlocked && !isClaimed));

    return {
      id: def.id,
      milestoneId: def.id,
      damage: def.threshold,
      rewardType: def.rewardType === 'ENERGY' ? 'gem' : 'badge',
      rewardValue: def.rewardValue,
      // REPARK 7.0 (2026-09-13): badgeName is sourced from the server-resolved
      // payload; ENERGY milestones always pass null through here.
      badgeName: def.badgeName,
      unlocked: isUnlocked,
      claimed: isClaimed,
      claimable: isClaimable,
      locked: isLocked,
    };
  });

  // REPARK 7.0 (2026-09-18 round 2): Fix "距下一奖励" algorithm.
  // Semantic rule: classify the reward roster into four mutually-exclusive
  // headline states so the top hint never lies about outstanding rewards.
  //
  //   Case A  next-higher threshold that is NOT yet unlocked and NOT locked
  //          → "距下一奖励 X 点个人伤害"
  //   Case B  all thresholds passed; at least one !claimed && !locked && unlocked
  //          → "有奖励可领取"
  //   Case C  all thresholds passed AND every non-locked milestone is claimed
  //          → "全部进度奖励已达成"
  //   Case D  every unpassed threshold (and every reached threshold) is locked
  //          → no actionable progress; surface a calm locked-state copy.
  //
  // The "next threshold" search EXCLUDES locked milestones — a locked milestone
  // can never be reached, so it must not occupy the headline. We still list
  // locked cards inside the reward grid for visibility.
  const eligibleForDistance = rewards
    .filter(r => !r.locked && r.damage > personalDamage)
    .sort((a, b) => a.damage - b.damage);
  const nextThresholdReward = eligibleForDistance[0] ?? null;
  const damageToNext = nextThresholdReward
    ? nextThresholdReward.damage - personalDamage
    : 0;

  // Headline copy + meta based on the four-case classification.
  const nextMilestoneHint = (() => {
    if (nextThresholdReward) {
      // Case A: there's a higher, reachable threshold that we haven't passed yet.
      return {
        kind: 'distance' as const,
        damage: nextThresholdReward.damage,
        unlocked: nextThresholdReward.unlocked,
        claimed: nextThresholdReward.claimed,
        damageToNext,
      };
    }
    // No higher threshold is reachable. Inspect the reached milestones for
    // unclaimed-but-unlocked reward cards (Case B) vs everything claimed (Case C)
    // vs everything locked (Case D).
    const unclaimedClaimable = rewards.find(
      r => !r.locked && r.unlocked && !r.claimed,
    );
    if (unclaimedClaimable) {
      return {
        kind: 'claimable' as const,
        damage: unclaimedClaimable.damage,
        unlocked: unclaimedClaimable.unlocked,
        claimed: unclaimedClaimable.claimed,
        damageToNext: 0,
      };
    }
    // No unclaimed rewards outstanding. Decide between Case C (all claimed, no
    // locked milestones) and Case D (only locked milestones remain, so the
    // player can't progress them). If every reward is claimed (no locked row),
    // we declare "全部进度奖励已达成". A roster that mixes claimed + locked
    // WITHOUT any non-locked row is Case D — show the locked copy instead of
    // falsely declaring "全部已达成".
    const hasAnyNonLocked = rewards.some(r => !r.locked);
    const anyUnlockedNonClaimed = rewards.some(r => r.unlocked && !r.claimed);
    if (!anyUnlockedNonClaimed && rewards.length > 0 && rewards.every(r => r.claimed || r.locked)) {
      if (hasAnyNonLocked) {
        // Some rows are non-locked AND all are claimed → Case C (real "全部达成")
        return {
          kind: 'all_done' as const,
          damage: 0,
          unlocked: false,
          claimed: true,
          damageToNext: 0,
        };
      }
      // Every remaining row is locked → Case D
      return {
        kind: 'all_locked_or_claimed' as const,
        damage: 0,
        unlocked: false,
        claimed: true,
        damageToNext: 0,
      };
    }
    return {
      kind: 'all_done' as const,
      damage: 0,
      unlocked: false,
      claimed: true,
      damageToNext: 0,
    };
  })();

  if (!mounted) return null;

  // Render directly in the React tree (no portal) so AnimatePresence in
  // BattleLayout correctly tracks mount/unmount and fires initial/exit animations.
  //
  // NOTE: outer wrapper uses a plain <div>, NOT motion.div.  framer-motion
  // automatically injects transform3d on motion.div elements (for GPU compositing),
  // which creates a NEW stacking context.  When that happens, position:fixed
  // on the inner element is re-parented to that new stacking context and its
  // z-index is calculated relative to it — completely breaking the z-order vs
  // SpineViewer (z-10, in the root stacking context).  Using a plain div avoids
  // this so the inner motion.div's fixed positioning is always relative to the
  // viewport and z-index is relative to the root stacking context.
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="fixed inset-0 z-[10000] flex items-end md:items-center justify-center pointer-events-auto"
      style={{
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* Click backdrop to close */}
      <div
        className="absolute inset-0"
        onClick={onClose}
      />

      {page === 'leaderboard' ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="overflow-hidden"
          style={{
            width: '92vw',
            maxWidth: '448px',          // max-w-md
            height: '540px',
            maxHeight: '85vh',
          }}
        >
          <LeaderboardModalContent onClose={onClose} />
        </motion.div>
      ) : page === 'rules' ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="overflow-hidden"
          style={{
            width: '92vw',
            maxWidth: '448px',
            height: '540px',
            maxHeight: '85vh',
          }}
        >
          <RulesModalContent
            onClose={onClose}
            rules={activityRules}
            propADisplayName={propADisplayName}
            propBDisplayName={propBDisplayName}
          />
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="overflow-hidden"
          style={{
            width: '92vw',
            maxWidth: '448px',
            height: '540px',
            maxHeight: '85vh',
          }}
        >
          {/* Modal shell always mounted at fixed dimensions so the panel
              never reflows when data lands.  We render the full
              BottomSheetContent (header + body) immediately; when data
              hasn't arrived yet the inner content area is wrapped in a
              soft opacity fade so the user sees a graceful "filling in"
              instead of a structural swap. */}
          <BottomSheetContent
            page={page as 'task' | 'reward'}
            onClose={onClose}
            tasks={tasks}
            rewards={rewards}
            damageToNext={damageToNext}
            isLoading={isLoading}
            loadingTask={loadingTask}
            loadingReward={loadingReward}
            onClaimTask={handleClaimTask}
            onClaimReward={handleClaimReward}
            bossState={
              bossState && typeof bossState.maxHp === 'number' && typeof bossState.currentHp === 'number'
                ? { maxHp: bossState.maxHp, currentHp: bossState.currentHp }
                : null
            }
            battleInit={battleInit}
            nextMilestone={nextMilestoneHint}
          />
        </motion.div>
      )}
    </motion.div>
  );
}

// ── React.memo: prevent re-render when parent (BattleLayout) re-renders on
// every 3 s polling tick / 1 s activity-status tick. The portal DOM lives in
// document.body, so React treats this component's render differently from
// inline components — without memo, every parent tick rebuilds the portal tree
// and resets framer-motion animation state (visible flicker loop).
const MemoizedSubPageModal = React.memo(SubPageModalComponent);
export const SubPageModal = MemoizedSubPageModal as React.FC<SubPageModalProps>;
