'use client';

/**
 * app/components/task/TaskSheet.tsx
 * V5.15-EN | Agent 1 [Cyber-Blacksmith]
 *
 * Daily Task Spring-Sheet — Framer Motion bottom-entry sheet.
 * Triggered by "每日任务" button on BattleLayout.
 *
 * Design tokens: Obsidian Black #030304, Gold→Pink gradient (consume), Blue→Purple (recharge).
 * Easing: cubic-bezier(0.34, 1.56, 0.64, 1) — Elastic spring.
 */

import { useCallback, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CalendarDays, Zap, TrendingUp } from 'lucide-react';
import { toast } from '@/app/lib/toastStore';
import { fetchWithTimeout } from '@/app/lib/fetchWithTimeout';

interface TaskState {
  daily_energy: { currentProgress: number; targetThreshold: number; isClaimed: boolean; remainingAttempts: number };
  daily_recharge: { currentProgress: number; targetThreshold: number; isClaimed: boolean; remainingAttempts: number };
}

interface TaskSheetProps {
  isOpen: boolean;
  onClose: () => void;
  taskState: TaskState;
  /** Called after a successful claim so parent can update its local copy */
  onInventoryUpdate?: (inventory: { item_hand: number; item_phallus: number }) => void;
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

// ── Spring physics config ───────────────────────────────────────────────────────

const SHEET_VARIANTS = {
  hidden: {
    y: '100%',
    opacity: 0,
  },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 35,
      // V5.15 spec: cubic-bezier(0.34, 1.56, 0.64, 1) — elastic overshoot
      ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number],
    },
  },
  exit: {
    y: '100%',
    opacity: 0,
    transition: {
      duration: 0.22,
      ease: [0.4, 0, 1, 1] as [number, number, number, number],
    },
  },
};

const BACKDROP_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

// ── Sub-components ──────────────────────────────────────────────────────────────

function TaskCard({
  title,
  description,
  progress,
  target,
  reward,
  type,
  claimable,
  claimed,
  isLoading,
  onClaim,
}: {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  reward: string;
  type: 'consume' | 'recharge';
  claimable: boolean;
  claimed: boolean;
  isLoading: boolean;
  onClaim: () => void;
}) {
  const isConsume = type === 'consume';
  const pct = Math.min(100, (progress / target) * 100);

  return (
    <motion.div
      layout
      className="rounded-2xl p-4"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${isConsume ? 'rgba(255,208,96,0.15)' : 'rgba(0,212,255,0.15)'}`,
      }}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{
              background: isConsume
                ? 'rgba(255,208,96,0.15)'
                : 'rgba(0,212,255,0.15)',
            }}
          >
            {isConsume ? (
              <Zap size={14} className="text-amber-400" />
            ) : (
              <TrendingUp size={14} className="text-cyan-400" />
            )}
          </div>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: isConsume
                ? 'rgba(255,45,135,0.15)'
                : 'rgba(155,92,255,0.15)',
              color: isConsume ? '#FF2D87' : '#9B5CFF',
              border: `1px solid ${isConsume ? 'rgba(255,45,135,0.25)' : 'rgba(155,92,255,0.25)'}`,
            }}
          >
            {isConsume ? '消耗任务' : '充值任务'}
          </span>
        </div>
        <span
          className="text-[10px] text-white/40"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          剩余 {1 - (1 - 1)}/1 次
        </span>
      </div>

      {/* Title + description */}
      <h3 className="text-sm font-bold text-white mb-1">{title}</h3>
      <p className="text-[11px] text-white/40 mb-3">{description}</p>

      {/* Gradient progress bar */}
      <div
        className="h-2.5 rounded-full overflow-hidden mb-2"
        style={{ background: 'rgba(255,255,255,0.08)' }}
      >
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
          style={{
            background: isConsume
              ? 'linear-gradient(90deg, #FFD060, #FF2D87)'
              : 'linear-gradient(90deg, #00D4FF, #9B5CFF)',
          }}
        />
      </div>

      {/* Progress text */}
      <div className="flex justify-between items-center mb-3">
        <span
          className="text-[11px] text-white/50"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {progress} / {target} {isConsume ? '电量' : '元'}
        </span>
        <span className="text-[11px] text-white/40">
          奖励：<strong className="text-white/70">{reward}</strong>
        </span>
      </div>

      {/* Claim button */}
      <button
        onClick={onClaim}
        disabled={!claimable || claimed || isLoading}
        className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.97] ${
          claimed
            ? 'cursor-not-allowed'
            : claimable
            ? 'cursor-pointer'
            : 'cursor-not-allowed'
        }`}
        style={{
          background: claimed
            ? 'rgba(61,214,140,0.12)'
            : claimable
            ? 'linear-gradient(135deg, #FFD060, #FF2D87)'
            : 'rgba(255,255,255,0.06)',
          color: claimed ? '#3DD68C' : claimable ? '#fff' : 'rgba(255,255,255,0.3)',
          border: claimed
            ? '1px solid rgba(61,214,140,0.2)'
            : claimable
            ? '1px solid rgba(255,208,96,0.3)'
            : '1px solid rgba(255,255,255,0.06)',
          boxShadow: claimable && !claimed
            ? '0 4px 20px rgba(255,45,135,0.25)'
            : 'none',
        }}
      >
        {isLoading ? '领取中…' : claimed ? '已领取' : claimable ? '立即领取' : '未完成'}
      </button>
    </motion.div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

export function TaskSheet({
  isOpen,
  onClose,
  taskState,
  onInventoryUpdate,
}: TaskSheetProps) {
  const [loadingTask, setLoadingTask] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Establish portal mount guard
  const [portalReady, setPortalReady] = useState(false);

  // FIX T-03: Sync claimed state from taskState to prevent stale button after close+reopen.
  // Also mirrors the fix in SubPageModal.tsx.
  const [claimed, setClaimed] = useState({
    daily_energy: taskState?.daily_energy?.isClaimed ?? false,
    daily_recharge: taskState?.daily_recharge?.isClaimed ?? false,
  });

  useEffect(() => {
    if (taskState?.daily_energy?.isClaimed !== undefined) {
      setClaimed(prev => ({ ...prev, daily_energy: taskState.daily_energy!.isClaimed }));
    }
    if (taskState?.daily_recharge?.isClaimed !== undefined) {
      setClaimed(prev => ({ ...prev, daily_recharge: taskState.daily_recharge!.isClaimed }));
    }
  }, [taskState?.daily_energy?.isClaimed, taskState?.daily_recharge?.isClaimed]);

  // Use effect for DOM side-effects only
  if (typeof document !== 'undefined' && !mounted) {
    setMounted(true);
    setPortalReady(true);
  }

  // ── Claim handler (mirrors SubPageModal logic) ──────────────────────────────
  const handleClaim = useCallback(
    async (taskType: 'consume' | 'recharge') => {
      const apiType = taskType === 'consume' ? 'daily_energy' : 'daily_recharge';
      setLoadingTask(taskType);

      try {
        const { data: json } = await fetchWithTimeout<TaskClaimResponse>(
          '/api/battle/task-claim',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              task_type: apiType,
            }),
          },
        );

        if (json?.ok && json.data) {
          const rewardName = json.data.reward_item === 'item_hand' ? '闪电符文' : '潮汐晶石';
          toast.success(`道具已发放：${rewardName} ×1`, 3000);
          if (json.data.inventory && onInventoryUpdate) {
            onInventoryUpdate(json.data.inventory);
          }
        } else {
          const code = json?.error?.code ?? 'UNKNOWN';
          switch (code) {
            case 'ALREADY_CLAIMED':
              toast.warning('已领取', 3000);
              break;
            case 'PROGRESS_NOT_MET':
              toast.warning('任务进度未达成', 3000);
              break;
            default:
              toast.error(json?.error?.message ?? '领取失败', 4000);
          }
        }
      } catch {
        toast.error('网络异常，请重试', 4000);
      } finally {
        setLoadingTask(null);
      }
    },
    [onInventoryUpdate]
  );

  // ── Derive task data from prop state ──────────────────────────────────────
  const energy = taskState?.daily_energy;
  const recharge = taskState?.daily_recharge;

  const consumeThreshold = energy?.targetThreshold ?? 100;
  const rechargeThreshold = recharge?.targetThreshold ?? 100;

  const consumeClaimable =
    (energy?.currentProgress ?? 0) >= consumeThreshold && !claimed.daily_energy;
  const rechargeClaimable =
    (recharge?.currentProgress ?? 0) >= rechargeThreshold && !claimed.daily_recharge;

  if (!mounted || !portalReady) return null;

  const portalRoot = typeof document !== 'undefined' ? document.getElementById('modal-portal') : null;
  if (!portalRoot) {
    console.error('[TaskSheet] modal-portal element not found');
    return null;
  }

  const content = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-[9998]"
            style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
            variants={BACKDROP_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
          />

          {/* Sheet panel */}
          <motion.div
            key="sheet"
            className="fixed bottom-0 left-0 right-0 z-[9999] flex flex-col items-center"
            variants={SHEET_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div
              className="w-full max-w-[500px] rounded-t-3xl overflow-hidden"
              style={{
                background: 'linear-gradient(180deg, rgba(12,6,28,0.99) 0%, rgba(3,3,4,1) 100%)',
                borderTop: '1px solid rgba(155,92,255,0.25)',
                borderLeft: '1px solid rgba(155,92,255,0.1)',
                borderRight: '1px solid rgba(155,92,255,0.1)',
                boxShadow: '0 -8px 60px rgba(155,92,255,0.15), 0 -2px 20px rgba(0,0,0,0.6)',
              }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1">
                <div
                  className="w-10 h-1 rounded-full"
                  style={{ background: 'rgba(255,255,255,0.15)' }}
                />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <CalendarDays size={18} className="text-purple-400" />
                  <div>
                    <h2 className="text-sm font-bold text-white">每日任务</h2>
                    <p className="text-[10px] text-white/35">
                      每日 00:00 重置（UTC+8）
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <X size={15} className="text-white/60" />
                </button>
              </div>

              {/* Task cards */}
              <div className="overflow-y-auto px-4 py-4 space-y-3" style={{ maxHeight: '60vh' }}>
                {/* Consume task */}
                <TaskCard
                  id="consume"
                  title={`单日消耗 ${consumeThreshold} 电量`}
                  description={`每消耗 ${consumeThreshold} 电量即可领取 1 把闪电之刃`}
                  progress={energy?.currentProgress ?? 0}
                  target={consumeThreshold}
                  reward="闪电符文 ×1"
                  type="consume"
                  claimable={consumeClaimable}
                  claimed={claimed.daily_energy}
                  isLoading={loadingTask === 'consume'}
                  onClaim={() => handleClaim('consume')}
                />

                {/* Recharge task */}
                <TaskCard
                  id="recharge"
                  title={`单日充值满 ${rechargeThreshold} 元`}
                  description={`每充值满 ${rechargeThreshold} 元即可领取 1 颗潮汐晶石`}
                  progress={recharge?.currentProgress ?? 0}
                  target={rechargeThreshold}
                  reward="潮汐晶石 ×1"
                  type="recharge"
                  claimable={rechargeClaimable}
                  claimed={claimed.daily_recharge}
                  isLoading={loadingTask === 'recharge'}
                  onClaim={() => handleClaim('recharge')}
                />
              </div>

              {/* Footer hint */}
              <div className="px-5 pb-5 pt-1">
                <p className="text-center text-[10px] text-white/20">
                  完成条件后点击「立即领取」领取奖励
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(content, portalRoot);
}
