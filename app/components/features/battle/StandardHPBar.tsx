'use client';

import { motion, useSpring, useTransform } from 'framer-motion';
import { useEffect } from 'react';

// ── Props ────────────────────────────────────────────────────────────────────────
interface StandardHPBarProps {
  currentHp: number;
  maxHp: number;
  // REPARK 6.0 (2026-08-22): Tick markers for the ② ③ ④ stage breakpoints.
  // When the caller passes dynamic thresholds (driven by the admin's
  // activities.config.spine.formThresholds), the bar reflects operator edits
  // live. Falls back to the SSOT baseline when the prop is omitted — keeps
  // the component safe for legacy callers (BattleLayout was historically
  // hard-coded to [80, 50, 25] before this Spec; the new default mirrors the
  // activitiesPg.defaultConfig() spine baseline so the un-wired call site
  // matches what /api/battle/init would have sent).
  milestones?: Array<{ unlockThreshold: number; tag: string }>;
}

// ── Milestone Config ─────────────────────────────────────────────────────────────
// unlockThreshold values are raw percentages (0–100).
// Badge is GOLD when HP is AT or ABOVE the threshold (HP >= markerValue).
// REPARK 6.0 (2026-08-22): Renamed from MILESTONES → DEFAULT_MILESTONES so the
// caller-supplied `milestones` prop takes precedence. Defaults mirror the
// activitiesPg.defaultConfig().spine.formThresholds baseline so the un-wired
// call site (e.g. unit tests, parent callers that forget to pass the prop)
// behaves identically to the first init payload.
const DEFAULT_MILESTONES = [
  { unlockThreshold: 75, tag: '②' },
  { unlockThreshold: 50, tag: '③' },
  { unlockThreshold: 25, tag: '④' },
];

// ── Spring Config ────────────────────────────────────────────────────────────────
const HP_SPRING = { type: 'spring' as const, stiffness: 260, damping: 22, restDelta: 0.1 };

// ════════════════════════════════════════════════════════════════════════════════════════
// StandardHPBar — Linear Truth
//
// MATH: ONE single formula (NO SEGMENTS, NO STAGE CALCULATIONS)
//   width = (currentHp / maxHp) * 100   → percentage
//
// MILESTONES: Positioned at left:${unlockThreshold}% so bar hits milestone exactly at that HP.
// ════════════════════════════════════════════════════════════════════════════════════════

export function StandardHPBar({
  currentHp,
  maxHp,
  milestones,
}: StandardHPBarProps) {
  // ── REPARK 6.0 (2026-08-22): Use the caller-supplied milestones prop when
  // present, otherwise fall back to the SSOT baseline. We always coerce to
  // a non-empty array so the milestone overlay never disappears mid-render.
  const activeMilestones =
    Array.isArray(milestones) && milestones.length > 0
      ? milestones
      : DEFAULT_MILESTONES;

  // ── ONE LINEAR FORMULA ───────────────────────────────────────────────────────
  const widthPct = maxHp > 0
    ? Math.max(0, Math.min(100, (currentHp / maxHp) * 100))
    : 100;

  // ── Spring ──────────────────────────────────────────────────────────────────
  const percentSpring = useSpring(widthPct, HP_SPRING);
  useEffect(() => { percentSpring.set(widthPct); }, [widthPct, percentSpring]);

  // ── Convert MotionValue to percentage string for CSS ───────────────────────
  const widthString = useTransform(percentSpring, (val) => `${val}%`);

  // ── Stage ────────────────────────────────────────────────────────────────────
  const stageLabel = widthPct >= 80 ? '形态 I'   :
                     widthPct >= 50 ? '形态 II'  :
                     widthPct >= 25 ? '形态 III' : '最终形态';

  const stageColor = widthPct >= 80 ? '#00D4FF'  :
                      widthPct >= 50 ? '#9B5CFF'  :
                      widthPct >= 25 ? '#FF2D87'  : '#FF6B35';

  return (
    <div className="relative w-full flex flex-col">

      {/* ── Stage label + HP numbers ── */}
      <div className="flex justify-between items-end mb-1 px-1">
        <span
          className="text-cyan-400 font-black italic tracking-tighter text-[10px] sm:text-xs"
          style={{ textShadow: '0 0 12px rgba(34,211,238,0.8), 0 0 24px rgba(34,211,238,0.4), 0 0 4px rgba(0,0,0,0.9)' }}
        >
          {stageLabel}
        </span>
        <span
          className="text-[10px] sm:text-xs"
          style={{
            fontFamily: "'JetBrains Mono', 'Courier New', monospace",
            fontWeight: 700,
            color: 'rgba(255,255,255,0.9)',
            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          }}
        >
          {Math.round(currentHp).toLocaleString()} / {maxHp.toLocaleString()}{' '}
          <span style={{ color: stageColor }}>({Math.round(widthPct)}%)</span>
        </span>
      </div>

      {/* ── Outer: h-3 sm:h-4 — FLATTENED, slimmer profile ── */}
      <div
        className="h-3 sm:h-4 w-full relative bg-black/60 rounded-full border border-white/10 overflow-hidden"
        style={{
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.8), inset 0 -1px 2px rgba(255,255,255,0.05)',
        }}
      >
        {/* ── Ghost bar (subtle backdrop) ── */}
        <div
          className="absolute top-0 left-0 h-full bg-white/5 rounded-full"
          style={{ width: '100%' }}
        />

        {/* ── Active fill: Tactical gradient with cyan accent ── */}
        <motion.div
          className="absolute top-0 left-0 h-full rounded-full"
          style={{
            width: widthString,
            background: 'linear-gradient(90deg, #030a0d 0%, #0d4a3a 20%, #00D4FF 60%, #00f5d4 80%, #00D4FF 100%)',
            boxShadow: '0 0 16px rgba(0,212,255,0.5), 0 0 32px rgba(0,245,212,0.25), inset 0 1px 0 rgba(255,255,255,0.4)',
          }}
        />

        {/* ── Shimmer sweep animation ── */}
        <div
          className="absolute top-0 h-full rounded-full overflow-hidden opacity-[0.08]"
          style={{
            width: '30%',
            left: '-30%',
            animation: 'hpShimmer 2.5s ease-in-out infinite',
            pointerEvents: 'none',
          }}
        >
          <div
            className="w-full h-full"
            style={{
              background: 'linear-gradient(105deg, transparent 15%, rgba(255,255,255,1) 45%, rgba(255,255,255,0.6) 52%, transparent 80%)',
            }}
          />
        </div>

        {/* ── Milestone overlay: absolute inset-0 (NOT clipped by overflow) ── */}
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 5 }}>
          {activeMilestones.map((milestone) => {
            const isUnlocked = widthPct >= milestone.unlockThreshold;
            return (
              <div
                key={milestone.unlockThreshold}
                className="absolute top-0 bottom-0 -translate-x-1/2"
                style={{
                  left: `${milestone.unlockThreshold}%`,
                }}
              >
                <div
                  className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2"
                  style={{
                    background: 'rgba(255,255,255,0.35)',
                  }}
                />

                <motion.div
                  animate={{
                    backgroundColor: isUnlocked ? '#fde047' : 'rgba(4,2,10,0.7)',
                    borderColor: isUnlocked ? '#a16207' : 'rgba(255,255,255,0.1)',
                    boxShadow: isUnlocked
                      ? '0 0 8px rgba(253,224,71,0.9), inset 0 1px 0 rgba(255,255,255,0.5)'
                      : 'inset 0 0 6px rgba(0,0,0,0.7)',
                    scale: isUnlocked ? 1.1 : 1,
                  }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="absolute left-1/2 top-1/2 flex h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border"
                  style={{
                    fontFamily: "'Cinzel', serif",
                    fontSize: '7px',
                    fontWeight: 700,
                    color: isUnlocked ? '#451a03' : 'rgba(255,255,255,0.15)',
                    zIndex: 10,
                    userSelect: 'none',
                    backdropFilter: 'blur(4px)',
                    WebkitBackdropFilter: 'blur(4px)',
                  }}
                >
                  {milestone.tag}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes hpShimmer {
          0%    { transform: translateX(0%); }
          45%   { transform: translateX(530%); }
          45.01%{ transform: translateX(-30%); }
          100%  { transform: translateX(-30%); }
        }
      `}</style>
    </div>
  );
}
