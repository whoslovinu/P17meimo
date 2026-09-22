'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Scroll, Star, Zap } from 'lucide-react';
import {
  DEFAULT_BIO,
  DEFAULT_SKILLS,
  DEFAULT_STAGE_NAMES,
  DEFAULT_STAGE_COLORS,
  type CharacterBioItem,
  type CharacterProfileConfig,
  type CharacterSkillItem,
} from '@/app/lib/characterProfile';

interface CharacterIntroPanelProps {
  /** Current active stage index (0-based). Drives the stage badge. */
  activeStageIdx?: number;
  /**
   * Optional admin-authored character profile. When supplied, replaces the
   * module-level DEFAULT_* values for any field that is non-empty. When
   * omitted (or fields are empty), DEFAULT_* values are used.
   */
  profile?: CharacterProfileConfig;
}

function pickStageName(profile: CharacterProfileConfig | undefined, idx: number): string {
  const list = profile?.stageNames;
  if (Array.isArray(list) && idx >= 0 && idx < list.length) {
    const v = list[idx];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return DEFAULT_STAGE_NAMES[idx] ?? DEFAULT_STAGE_NAMES[0];
}

function pickStageColor(profile: CharacterProfileConfig | undefined, idx: number): string {
  const colors = profile?.stageColors;
  if (Array.isArray(colors) && idx >= 0 && idx < colors.length) {
    const cls = colors[idx]?.className;
    if (typeof cls === 'string' && cls.trim().length > 0) return cls;
  }
  return DEFAULT_STAGE_COLORS[idx] ?? DEFAULT_STAGE_COLORS[0];
}

function pickBio(profile: CharacterProfileConfig | undefined): CharacterBioItem[] {
  const list = profile?.bio;
  if (Array.isArray(list) && list.length > 0) {
    const filtered = list.filter(
      (b) => b && (typeof b.label === 'string' || typeof b.value === 'string'),
    ) as CharacterBioItem[];
    if (filtered.length > 0) return filtered;
  }
  return [...DEFAULT_BIO];
}

function pickSkills(profile: CharacterProfileConfig | undefined): CharacterSkillItem[] {
  const list = profile?.skills;
  if (Array.isArray(list) && list.length > 0) {
    const filtered = list.filter(
      (s) => s && (typeof s.name === 'string' || typeof s.desc === 'string'),
    ) as CharacterSkillItem[];
    if (filtered.length > 0) return filtered;
  }
  return [...DEFAULT_SKILLS];
}

// REPARK 6.0 — P0 stable drawer animation.
//
// Previous behavior toggled the entire body via `{!collapsed && <div>...</div>}`
// which caused a Layout Shift: when collapsed → expanded, the panel content
// was rendered from absolute zero to its natural height in a single frame,
// pushing the glass card and the bottom glow strip with it. The chevron
// also flipped between two different icons (ChevronUp / ChevronRight) with
// no rotational interpolation, producing a harsh discontinuity.
//
// This rewrite uses a two-track motion contract:
//   1. The outer card (border / shadow / bottom glow) is always mounted at
//      its final expanded shell height (`min-h-[460px]`) and just tweens
//      its width between 34px (collapsed) and the responsive clamp. No
//      vertical reflow: the bottom glow stays pinned.
//   2. The inner content is mounted inside an <AnimatePresence> wrapper
//      with an explicit `max-height: 0 → 460px` tween plus a short opacity
//      fade. Because the max-height is a fixed number, framer-motion
//      interpolates it linearly — no `height: 'auto'` tween, no layout
//      cost after the animation completes, no nested scrollbar growth.
//   3. The chevron is a single ChevronRight icon that rotates 0 → 180°
//      via `transition-transform duration-200`, so the icons don't swap
//      out — the same `>` glyph simply opens.
const EXPANDED_MAX_HEIGHT_PX = 460;

export function CharacterIntroPanel({ activeStageIdx = 0, profile }: CharacterIntroPanelProps) {
  const [collapsed, setCollapsed] = useState(true);

  const toggle = useCallback(() => {
    setCollapsed((v) => !v);
  }, []);

  // REPARK 6.0 (2026-08-14): use pickers to layer admin-authored values on top
  // of the hardcoded fallbacks. When `profile` is omitted or any sub-list is
  // empty, the panel still renders the day-one DEFAULT_* values.
  const stageNames  = Array.from({ length: 4 }, (_, i) => pickStageName(profile, i));
  const stageColors = Array.from({ length: 4 }, (_, i) => pickStageColor(profile, i));
  const bioRows     = pickBio(profile);
  const skillRows   = pickSkills(profile);

  const stageName  = stageNames[activeStageIdx] ?? stageNames[0];
  const badgeColor = stageColors[activeStageIdx] ?? stageColors[0];

  return (
    // FIX: Root div must be pointer-events:none so the panel does NOT blind the
    // PIXI WebGL canvas beneath it (z-10). Only the toggle button and panel
    // body should receive pointer events. Without this, the entire tall left-edge
    // area of this panel absorbs all clicks, making the character spine unreachable.
    <div
      className="fixed left-0 top-[52%] -translate-y-1/2 z-[90] pointer-events-none select-none"
      style={{ width: collapsed ? '34px' : 'clamp(160px, 20vw, 220px)' }}
    >
      <div
        className={`relative overflow-hidden pointer-events-auto ${collapsed ? 'rounded-r-xl' : 'rounded-r-2xl'}`}
        style={{
          // Card always reaches its target shell geometry.  When collapsed
          // we snap width to 34px; when expanded, the responsive clamp.
          width: collapsed ? '34px' : 'clamp(160px, 20vw, 220px)',
          // Height is stable: header (~32px) + content area (max-h-[460px])
          // + bottom glow reserves.  We pre-allocate the expanded height so
          // the card never "jumps" upward when content animates open.
          height: collapsed ? 'auto' : `${32 + EXPANDED_MAX_HEIGHT_PX + 8}px`,
          maxHeight: '75vh',
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderLeft: 'none',
          boxShadow: collapsed
            ? '0 0 18px rgba(155,92,255,0.12), inset 0 0 8px rgba(155,92,255,0.04)'
            : '0 0 24px rgba(155,92,255,0.15), inset 0 0 12px rgba(155,92,255,0.05)',
          transition: 'width 220ms cubic-bezier(0.16, 1, 0.3, 1), height 220ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 220ms ease',
        }}
      >
        {/* ── Header / collapsed tab ── */}
        <div
          className={`flex items-center justify-between ${collapsed ? 'px-1 py-3' : 'px-3 py-2 border-b border-white/10'}`}
          style={{ height: '32px' }}
        >
          {!collapsed && (
            <div className="flex items-center gap-1.5 min-w-0">
              <Scroll size={13} color="rgba(196,165,255,0.8)" className="shrink-0" />
              <span
                className="text-[10px] font-bold tracking-widest text-white/80 truncate"
                style={{ fontFamily: "'Geist', sans-serif", letterSpacing: '0.12em' }}
              >
                角色档案
              </span>
            </div>
          )}

          <button
            onClick={toggle}
            aria-label={collapsed ? '展开角色档案' : '收起角色档案'}
            className={`flex items-center justify-center rounded transition-all duration-200 hover:bg-white/10 ${collapsed ? 'w-7 h-12 mx-auto bg-white/5' : 'shrink-0 w-5 h-5'}`}
          >
            <ChevronRight
              size={collapsed ? 14 : 12}
              color="rgba(255,255,255,0.65)"
              style={{
                transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          </button>
        </div>

        {/* ── Collapsible Body — max-height tween (no `height: auto`) ── */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="character-intro-body"
              initial={{ maxHeight: 0, opacity: 0 }}
              animate={{ maxHeight: EXPANDED_MAX_HEIGHT_PX, opacity: 1 }}
              exit={{ maxHeight: 0, opacity: 0 }}
              transition={{
                maxHeight: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
                opacity: { duration: 0.18, ease: 'easeOut' },
              }}
              className="overflow-hidden"
            >
              <div
                className="px-3 py-3 space-y-3 overflow-y-auto"
                style={{ maxHeight: `${EXPANDED_MAX_HEIGHT_PX}px` }}
              >
                {/* Stage Badge */}
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`w-full rounded-lg bg-gradient-to-r px-2 py-1 text-center ${badgeColor}`}
                    style={{
                      border: '1px solid rgba(255,255,255,0.15)',
                      boxShadow: '0 0 10px rgba(155,92,255,0.25)',
                    }}
                  >
                    <span
                      className="text-[10px] font-bold text-white/90 tracking-wider"
                      style={{ letterSpacing: '0.1em' }}
                    >
                      {stageName}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Star
                        key={i}
                        size={7}
                        fill={i <= activeStageIdx ? '#FFD700' : 'transparent'}
                        color={i <= activeStageIdx ? '#FFD700' : 'rgba(255,255,255,0.15)'}
                      />
                    ))}
                  </div>
                </div>

                {/* Divider */}
                <div
                  className="h-px w-full"
                  style={{
                    background:
                      'linear-gradient(to right, transparent, rgba(155,92,255,0.4), transparent)',
                  }}
                />

                {/* Bio Slots */}
                <div className="space-y-1.5">
                  {bioRows.map((item, idx) => (
                    <div key={`${item.label}-${idx}`} className="flex items-start gap-1.5">
                      <span
                        className="text-[9px] text-white/30 shrink-0 pt-px leading-tight"
                        style={{ minWidth: '2.5em' }}
                      >
                        {item.label}
                      </span>
                      <span className="text-[9px] text-white/70 leading-tight">{item.value}</span>
                    </div>
                  ))}
                </div>

                {/* Divider */}
                <div
                  className="h-px w-full"
                  style={{
                    background:
                      'linear-gradient(to right, transparent, rgba(155,92,255,0.4), transparent)',
                  }}
                />

                {/* Skills */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1 mb-0.5">
                    <Zap size={9} color="rgba(255,100,150,0.7)" />
                    <span
                      className="text-[9px] font-semibold text-white/40 tracking-widest"
                      style={{ letterSpacing: '0.1em' }}
                    >
                      技能
                    </span>
                  </div>
                  {skillRows.map((skill, idx) => (
                    <div key={`${skill.name}-${idx}`} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1">
                        <div
                          className="w-0.5 h-0.5 rounded-full shrink-0"
                          style={{ background: 'rgba(255,45,135,0.6)' }}
                        />
                        <span className="text-[9px] font-semibold text-white/60 leading-tight">
                          {skill.name}
                        </span>
                      </div>
                      <p className="text-[8px] text-white/25 leading-snug pl-2">
                        {skill.desc}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Stage progress line */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] text-white/20">进化进度</span>
                    <span className="text-[8px] font-bold text-purple-400/70">
                      {Math.round(((activeStageIdx + 1) / 4) * 100)}%
                    </span>
                  </div>
                  <div
                    className="h-1 rounded-full overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.08)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.round(((activeStageIdx + 1) / 4) * 100)}%`,
                        background:
                          'linear-gradient(to right, #9333ea, #FF2D87)',
                        boxShadow: '0 0 6px rgba(155,92,255,0.5)',
                      }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Bottom glow accent — always mounted, never reflows. ── */}
        <div
          className="absolute bottom-0 left-0 right-0 h-px"
          style={{
            background:
              'linear-gradient(to right, transparent 0%, rgba(155,92,255,0.6) 50%, transparent 100%)',
          }}
        />
      </div>
    </div>
  );
}
