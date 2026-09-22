'use client';

import React, { useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useModalStore } from '@/app/lib/modalStore';
import { toast } from '@/app/lib/toastStore';

  // ── SpineViewer ref interface ──────────────────────────────────────────────────
interface _SpineViewerRef {
  triggerAttack: (damage?: number, weaponType?: 'a' | 'b') => Promise<void>;
  /** Returns true if an attack can be triggered (not locked). */
  canTrigger: () => boolean;
  forceResetAllModels: () => void;
}

// ── Props ────────────────────────────────────────────────────────────────────────
interface Inventory {
  item_hand: number;
  item_phallus: number;
}

interface WeaponBarProps {
  inventory: Inventory;
  isAttacking?: boolean;
  // V5.14-EN: spineViewerRef REMOVED — animation is now server-response-gated.
  // WeaponBar only handles click guard logic; all Spine/Particle/FloatingDamage
  // calls live in BattleLayout's handleAttack SUCCESS block.
  onAttack: (type: 'item_hand' | 'item_phallus') => Promise<void>;
  onInsufficient: () => void;
  /**
   * 2026-08-19 (Mobile Portrait 2-Column): the bottom action area now stacks
   * vertically per column. `split-left` renders ONLY the hand weapon button
   * (居中对齐于「每日任务」按钮下方); `split-right` renders ONLY the phallus
   * weapon button (居中对齐于「进度奖励」按钮下方). The historical
   * `center/left/right` modes remain available for desktop fallback.
   */
  layout?: 'left' | 'right' | 'center' | 'split-left' | 'split-right';
}

// ════════════════════════════════════════════════════════════════════════════════════════
// WeaponIcon — Static assets. NO window.__REPARK_ASSETS__.
//
// Paths from /public/ui/:
//   TOUCH  → /ui/icon_hand.png
//   THRUST → /ui/icon_thrust.png
//
// MANDATE: Jewel Design
//   - Container: 64px circle. bg-gradient-to-b from-purple-900/80 to-black. border: 2px solid #9333ea
//   - Centering: Wrap <img> in div with w-12 h-12 flex items-center justify-center
//   - Icon: object-fit: contain. filter: brightness(0) invert(1) drop-shadow(0 0 8px #ff00ff)
// ════════════════════════════════════════════════════════════════════════════════════════

function WeaponIcon({ type }: { type: 'hand' | 'dick' }) {
  const src = type === 'hand' ? '/ui/icon_hand.png' : '/ui/icon_thrust.png';
  return (
    <div className="w-12 h-12 flex items-center justify-center">
      <img
        src={src}
        alt={type === 'hand' ? 'touch' : 'thrust'}
        style={{
          width: '40px',
          height: '40px',
          objectFit: 'contain',
          filter: 'brightness(0) invert(1) drop-shadow(0 0 8px #ff00ff)',
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════
// WeaponBar
// ════════════════════════════════════════════════════════════════════════════════════════
export function WeaponBar({
  inventory,
  isAttacking = false,
  // V5.14-EN: spineViewerRef no longer accepted — animation is server-gated
  onAttack,
  onInsufficient,
  layout = 'center',
}: WeaponBarProps) {
  const modalPage = useModalStore((s) => s.page);
  const pointerLockRef = useRef(false);
  const isBlocked = modalPage !== null;

  const showLeft  = layout === 'left'  || layout === 'center' || layout === 'split-left';
  const showRight = layout === 'right' || layout === 'center' || layout === 'split-right';
  // Split layouts drop the centre spacer that centre-mode uses to separate
  // the two buttons; each split column renders exactly one weapon, centred.

  // ════════════════════════════════════════════════════════════════════════════════════
  // V5.14-EN: SEQUENTIAL ATTACK FLOW — ANTI-ASSET-STEALING
  //
  // MANDATE: Spine animation, particles, and floating damage MUST only fire AFTER
  // the server returns HTTP 200 with the confirmed damage value.
  //
  // VETO: REMOVE triggerAttack() from this click handler — it fires optimistically
  // before any server validation. The boss must never animate without server proof.
  //
  // ORDER (V5.14-EN):
  //   1. navigator.onLine — reject immediately if offline (no state changes)
  //   2. Check guards (blocked / empty / attacking) — synchronous, no delay
  //   3. Fire onAttack() fire-and-forget — handles optimistic state + server call
  //      → SUCCESS path in BattleLayout fires Spine + Particle + FloatingDamage
  //      → FAILURE path rolls back silently, ZERO animation commands issued
  //
  // The isAttacking lock is set by BattleLayout's handleAttack BEFORE the fetch,
  // so the button is disabled synchronously on the NEXT render.
  // ════════════════════════════════════════════════════════════════════════════════════
  const dispatchAttack = useCallback(
    (type: 'item_hand' | 'item_phallus') => {
      if (pointerLockRef.current) return;
      pointerLockRef.current = true;
      window.setTimeout(() => {
        pointerLockRef.current = false;
      }, 180);

      // V5.14-EN: Offline guard — reject immediately, no state mutation
      if (!navigator.onLine) {
        toast.warning('网络异常，请重试', 3000);
        return;
      }

      if (isBlocked) return;
      const current = type === 'item_hand' ? inventory.item_hand : inventory.item_phallus;
      if (current <= 0) { onInsufficient(); return; }
      if (isAttacking) return;

      // All animation logic (Spine, Particle, FloatingDamage) is STRICTLY
      // in the SUCCESS block of BattleLayout's handleAttack — NOT here.
      onAttack(type).catch((err) => {
        console.warn('[WeaponBar] onAttack rejected:', err);
      });
    },
    [isBlocked, inventory, isAttacking, onAttack, onInsufficient]
  );

  return (
    <div
      className="relative w-full flex pb-[env(safe-area-inset-bottom)]"
      style={{ pointerEvents: isBlocked ? ('none' as const) : ('auto' as const) }}
    >
      <div
        className={`relative z-[1000] w-full px-4 pt-2 pb-4 flex items-center flex-wrap gap-y-2 ${
          layout === 'left'  ? 'justify-start'
          : layout === 'right' ? 'justify-end'
          : 'justify-center'
        }`}
        style={{ pointerEvents: isBlocked ? ('none' as const) : ('auto' as const) }}
      >
        {showLeft && (
          <WeaponButton
            label="触碰"
            subLabel="闪电一击"
            Icon={<WeaponIcon type="hand" />}
            badge={inventory.item_hand}
            variant="pink"
            onPointerDown={() => dispatchAttack('item_hand')}
            disabled={isBlocked || isAttacking}
            isExhausted={inventory.item_hand <= 0}
          />
        )}

        {/* Split layouts (mobile portrait 2-column) drop the centre spacer;
            each column renders exactly one weapon button, centred. */}
        {layout === 'center' && <div style={{ width: '48px' }} />}

        {showRight && (
          <WeaponButton
            label="深入"
            subLabel="潮汐冲击"
            Icon={<WeaponIcon type="dick" />}
            badge={inventory.item_phallus}
            variant="blue"
            onPointerDown={() => dispatchAttack('item_phallus')}
            disabled={isBlocked || isAttacking}
            isExhausted={inventory.item_phallus <= 0}
          />
        )}
      </div>
    </div>
  );
}

// ── WeaponButton ────────────────────────────────────────────────────────────────
interface WeaponButtonProps {
  label: string;
  subLabel: string;
  Icon: React.ReactNode;
  badge: number;
  variant: 'pink' | 'blue';
  disabled: boolean;
  /**
   * P0 2026-08-19: True when the count of this weapon is 0. We DO NOT short-circuit
   * pointer events on this — the parent `dispatchAttack` already routes 0-count
   * clicks to `onInsufficient`, which toasts and opens the daily-task modal so
   * the player can refill. Disabling the button here would silently swallow
   * the click and trap users with no visible affordance.
   */
  isExhausted: boolean;
  onPointerDown: () => void;
}

// ════════════════════════════════════════════════════════════════════════════════════════
// WeaponButton — Jewel Design + Zero Latency
//
// MANDATE:
//   - Outer: 64px circle. bg-gradient-to-b from-purple-900/80 to-black. border: 2px solid #9333ea
//   - onPointerDown fires IMMEDIATELY when finger touches screen (SOLE trigger)
//   - whileTap: scale: 0.95 for instant tactile response
//   - NO isStage2, NO morphState checks
// ════════════════════════════════════════════════════════════════════════════════════════
function WeaponButton({ label, subLabel, Icon, badge, variant, disabled, isExhausted, onPointerDown }: WeaponButtonProps) {
  const colors = variant === 'pink'
    ? { primary: '#FF2D87', secondary: '#FF6B35', glow: 'rgba(168,85,247,0.75)', badge: 'linear-gradient(135deg, #FF2D87, #FF6B35)' }
    : { primary: '#60A5FA', secondary: '#9B5CFF', glow: 'rgba(168,85,247,0.75)', badge: 'linear-gradient(135deg, #60A5FA, #9B5CFF)' };

  // P0 2026-08-19: visually dim exhausted weapons but keep them clickable so
  // the tap can route to onInsufficient → opens "完成任务获取道具" modal.
  // `disabled` is the modal-block / attacking lock; `isExhausted` is 0-count
  // which is intentionally NOT routed through `disabled` to avoid swallowing
  // taps that should open the daily-task modal.
  const isVisuallyDisabled = disabled;
  const displayOpacity = isVisuallyDisabled ? 0.4 : isExhausted ? 0.55 : 1;
  const displayCursor = isVisuallyDisabled ? 'not-allowed' : isExhausted ? 'help' : 'pointer';

  return (
    <motion.button
      onPointerDown={isVisuallyDisabled ? undefined : onPointerDown}
      disabled={isVisuallyDisabled}
      whileTap={isVisuallyDisabled ? {} : { scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className="group relative flex flex-col items-center select-none shrink-0"
      style={{
        pointerEvents: isVisuallyDisabled ? 'none' : 'auto',
        zIndex: 2000,
        touchAction: 'manipulation',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: displayCursor,
        opacity: displayOpacity,
      }}
      aria-label={`${label} — ${subLabel}`}
      title={isExhausted && !isVisuallyDisabled ? '道具不足，点击前往领取' : undefined}
    >
      {/* Outer conic glow ring */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, transparent 0%, ${colors.primary} 30%, ${colors.secondary} 60%, ${colors.primary} 100%)`,
          filter: 'blur(12px)',
          transform: 'scale(1.6)',
          opacity: 0.4,
          transition: 'opacity 0.3s',
        }}
      />

      {/* JEWEL DESIGN: 64px circle */}
      <div
        className="relative flex items-center justify-center w-[64px] h-[64px] rounded-full"
        style={{
          background: 'linear-gradient(180deg, rgba(88,28,135,0.8) 0%, rgba(0,0,0,1) 100%)',
          border: '2px solid #9333ea',
          boxShadow: `0 0 20px ${colors.glow}, inset 0 0 10px rgba(168,85,247,0.15)`,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          transition: 'box-shadow 0.2s',
        }}
      >
        {/* Inner radial glow on hover */}
        <div
          className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100"
          style={{
            background: `radial-gradient(circle, ${colors.glow}20 0%, transparent 70%)`,
            transition: 'opacity 0.2s',
          }}
        />

        {/* Flash overlay on press */}
        <motion.div
          className="absolute inset-0 rounded-full bg-white"
          initial={{ opacity: 0 }}
          whileTap={isVisuallyDisabled ? {} : { opacity: 0.4 }}
          transition={{ duration: 0.1 }}
          style={{ pointerEvents: 'none' }}
        />

        {Icon}

        {/* Inventory badge */}
        <div
          className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 flex items-center justify-center rounded-full text-[8px] font-bold"
          style={{
            background: colors.badge,
            boxShadow: `0 0 8px ${colors.glow}`,
            color: 'white',
          }}
        >
          {badge}
        </div>
      </div>

      {/* Labels */}
      <div className="mt-2 text-center">
        <div
          className="text-[10px] font-medium tracking-wider"
          style={{ color: colors.primary, transition: 'color 0.2s' }}
        >
          {label}
        </div>
        <div className="text-[7px] text-white/25 mt-0.5">{subLabel}</div>
      </div>
    </motion.button>
  );
}
