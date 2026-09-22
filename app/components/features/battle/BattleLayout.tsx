'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { CalendarDays, Trophy } from 'lucide-react';
import { SpineViewer } from './SpineViewer';
import type { SpineViewerRef } from './SpineViewer';
import { CharacterIntroPanel } from './CharacterIntroPanel';
import { SubPageModal } from './SubPageModal';
import { StandardHPBar } from './StandardHPBar';
import { LoadingScreen } from './LoadingScreen';
import { shipBattleTrace, flushBattleTrace, getBattleTraceSessionId } from './battleTraceShipper';
import { TopNav } from './TopNav';
import { FormSelectorWithLock, FormId, buildFormConfigs, type FormConfig } from './FormSelector';
import { WeaponBar } from './WeaponBar';
import { ToastContainer } from '@/app/components/ui/ToastContainer';
import { FloatingDamageLayer, spawnFloatingDamage } from './FloatingDamage';

// ════════════════════════════════════════════════════════════════════════════════
//  🎛️  UI LAYOUT CONFIG (Commander's UI Dashboard)
// ════════════════════════════════════════════════════════════════════════════════
//  Edit these values to retune the layout — pure CSS, no WebGL impact.
//  ┌──────────────────────────────────────────────────────────────────────────┐
//  │  HP_BAR_TOP            (currently: 90)    → HP bar Y offset (px)     │
//  │  HP_BAR_SCALE          (currently: 1)     → HP bar physical size mul  │
//  │  LOGO_TOP              (currently: 50)    → Top-left "形态 I" Y offset │
//  │  FORM_SELECTOR_RIGHT   (currently: 8)     → Form selector right inset  │
//  └──────────────────────────────────────────────────────────────────────────┘
const UI_CONFIG = {
  HP_BAR_TOP: 60,
  HP_BAR_SCALE: 1,
  LOGO_TOP: 50,
  FORM_SELECTOR_RIGHT: 8,
} as const;
import { ParticleLayer, spawnParticles } from './ParticleEngine';
import { openModal, closeModal, useModalStore } from '@/app/lib/modalStore';
import { toast } from '@/app/lib/toastStore';
import { useRewardStore } from '@/lib/rewardStore';
import { ActivityEndPage } from './ActivityEndPage';
import { AnimatePresence } from 'framer-motion';
import { getAuthHeader, useUserId } from '@/app/lib/useUserId';
import { fetchWithTimeout, humanizeFetchError, FetchError } from '@/app/lib/fetchWithTimeout';
import { AudioManager } from '@/app/lib/audio/AudioManager';
import { env } from '@/lib/env';
import { BGMController } from './BGMController';
import { useAudioStore } from '@/app/lib/audioStore';
import type { ActivityStatus } from './types';

// ── FormId Schema Bridge ───────────────────────────────────────────────────
// P0 2026-09-19: Server /api/battle/init emits formId as "stage1".."stage4".
// Client FormId type is "initial"|"awakening"|"flame"|"shadow".  These two
// schemas never overlapped — unlockedForms.add(serverFormId) always missed every
// Set.has(clientFormId) lookup in FormSelector.
//
// Single authoritative mapping (fail-closed on unknown server IDs):
function serverFormIdToClientFormId(serverId: string): FormId | null {
  switch (serverId) {
    case 'stage1': return 'initial';
    case 'stage2': return 'awakening';
    case 'stage3': return 'flame';
    case 'stage4': return 'shadow';
    default:
      // Fail-closed: never silently unlock an unknown form.
      // Log once so operators can audit unexpected server IDs.
      console.warn('[BattleLayout] Unknown server formId received:', serverId);
      return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// BATTLE LAYOUT — Phase 3: Frontend-Backend Integration
//
// Single Source of Truth Flow:
//   1. Mount -> fetch /api/battle/init -> hydrate all state from REAL backend
//   2. Attack -> optimistic update -> real fetch -> success/rollback
//   3. serverHp never mutated optimistically; only via API response
//   4. unconfirmedDamage tracks pending attacks awaiting server confirmation
//   5. displayedHp = Math.max(0, serverHp - unconfirmedDamage)
// ════════════════════════════════════════════════════════════════════════════════

// ── API Response Types ───────────────────────────────────────────────────────────
interface ApiBossState {
  currentHp: number;
  maxHp: number;
  version: number;
  lastUpdatedAt: string;
}

interface ApiInventory {
  item_hand_count: number;
  item_phallus_count: number;
  total_damage_dealt: number;
}

interface ApiTaskStatus {
  currentProgress: number;
  targetThreshold: number;
  remainingAttempts: number;
  isClaimed: boolean;
  hasUnclaimedReward: boolean;
  // P0 2026-07-30: daily claim limit from activity config (e.g. 5).
  dailyLimit: number;
}

interface ApiMilestone {
  id: number;
  hpThreshold: number;
  isUnlocked: boolean;
  isClaimed: boolean;
  hasUnclaimedReward: boolean;
}

interface ApiForm {
  formId: FormId;
  hpThreshold: number;
  isUnlocked: boolean;
}

interface BattleInitData {
  boss: ApiBossState;
  user: {
    inventory: ApiInventory;
    tasks: {
      daily_energy: ApiTaskStatus;
      daily_recharge: ApiTaskStatus;
    };
    milestones: ApiMilestone[];
    forms: ApiForm[];
  };
  config: {
    activityEnabled: boolean;
    activityName: string;
    startTime: string;
    endTime: string;
    attackDamageMin: number;
    attackDamageMax: number;
    rules: string;
    milestones: Array<{ id: number; hp_threshold: number; name: string; emoji: string }>;
    // REPARK 6.0 (2026-08-22): Admin-configured spine form thresholds surfaced
    // by /api/battle/init. Drives the ② ③ ④ tick markers on StandardHPBar so
    // changes in /admin/activities/[id]/config (Spine section) propagate live.
    // Optional for back-compat with older payloads; BattleLayout falls back to
    // 75/50/25 if absent.
    spine?: {
      formThresholds: { stage2: number; stage3: number; stage4: number };
    };
    // REPARK 6.0 (2026-08-14): admin-configured character profile. Empty when
    // the activity hasn't authored one — CharacterIntroPanel handles fallback.
    character_profile?: {
      characterName?: string;
      stageNames?: string[];
      bio?: Array<{ label: string; value: string }>;
      skills?: Array<{ name: string; desc: string }>;
    };
  };
  /** FIX T-02: Dynamic task thresholds from API */
  taskConfig: {
    daily_energy: number;
    daily_recharge: number;
  };
}

interface AttackResponse {
  ok: boolean;
  data?: {
    item_type: 'item_hand' | 'item_phallus';
    actual_damage: number;
    new_hp: number;
    total_damage: number;
    return_code: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

// ── Props ───────────────────────────────────────────────────────────────────────
interface GameSpineConfig {
  spineBaseUrl:    string;
  formThresholds: { stage2: number; stage3: number; stage4: number };
}

interface GameMilestone {
  id:         string;
  threshold:  number;
  rewardType: 'ENERGY' | 'MEDAL';
  energyValue?: number;
  medalId?:   string;
}

interface GameItemsConfig {
  propA: { name: string; rows: Array<{ minDamage: number; maxDamage: number; probability: number }>; taskThreshold: number; dailyLimit: number };
  propB: { name: string; rows: Array<{ minDamage: number; maxDamage: number; probability: number }>; taskThreshold: number; dailyLimit: number };
}

const BATTLE_UI_TUNING = {
  topNav: {
    // Mobile: relaxed to 14vh so countdown badge + 4 controls don't crush together.
    // Desktop: tighter 10vh since wide screens have plenty of horizontal breathing room.
    containerHeight: 'h-[14vh] sm:h-[10vh]',
    minHeight: 'min-h-[56px]',
    paddingTop: 'pt-1 sm:pt-1',
    paddingBottom: 'pb-0.5 sm:pb-0.5',
  },
  hpSection: {
    // Mobile: extra top margin to clear the (now taller) top nav badge row.
    paddingTop: 'pt-3 sm:pt-1',
    desktopPaddingTop: 'sm:pt-1',
    // Mobile: -translate-y reduced from -translate-y-7 so HP bar doesn't slam into the top nav.
    translateY: '-translate-y-2 sm:-translate-y-7',
    desktopTranslateY: 'sm:-translate-y-10',
  },
} as const;

interface BattleLayoutProps {
  initialHp?: { current: number; max: number };
  initialInventory?: { item_hand: number; item_phallus: number };
  /** Spine config from /api/game/init */
  spineConfig?: GameSpineConfig | null;
  /** Item damage config from /api/game/init (for reference/debug) */
  gameItems?: GameItemsConfig | null;
  /** Milestone definitions from /api/game/init */
  gameMilestones?: GameMilestone[] | null;
}

interface ActivityGateConfig {
  activityEnabled: boolean;
  startTime?: string;
  endTime?: string;
}

function getClientServerNow(serverOffsetMs: number): number {
  return Date.now() + serverOffsetMs;
}

// ── BreathingRedDot ─────────────────────────────────────────────────────────────
// P0 2026-08-19: 红点呼吸发光闪烁动效 (Red Dot Breathing Pulse)
//   • 闲置状态 (active=false) → 30% opacity, no animation
//   • 可领取状态 (active=true)  → 双层结构:
//       - 外层 animate-ping 半透明扩散圈 (Tailwind 内置动画)
//       - 内层 solid dot + box-shadow 外发光 + scale 呼吸 (dotBreath keyframes)
// `phaseOffset` 让左右两个红点交错闪烁，避免同步呼吸导致的视觉单调。
function BreathingRedDot({
  color,
  glow,
  active,
  phaseOffset = 0,
}: {
  color: string;
  glow: string;
  active: boolean;
  phaseOffset?: number;
}) {
  return (
    <div
      className="relative w-2 h-2"
      aria-hidden="true"
    >
      {/* Outer ping ring — only when active. Sized at 200% so the ping wave
          clearly extends past the inner dot without clipping the parent box. */}
      {active && (
        <span
          className="absolute animate-ping rounded-full"
          style={{
            background: color,
            opacity: 0.6,
            top: '-75%',
            left: '-75%',
            width: '250%',
            height: '250%',
          }}
        />
      )}
      {/* Inner solid dot — always rendered. Glow + breath when active. */}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: color,
          boxShadow: active ? `0 0 8px ${glow}` : 'none',
          animation: active
            ? `dotBreath 1s ease-in-out infinite ${phaseOffset}s`
            : 'none',
          opacity: active ? 1 : 0.3,
        }}
      />
    </div>
  );
}

function deriveActivityStatus(config: ActivityGateConfig, serverOffsetMs: number, hasFatalError: boolean, isReadyForLiveView: boolean): ActivityStatus {
  if (hasFatalError) return 'ERROR';
  if (!config.activityEnabled) return 'ENDED';

  const now = getClientServerNow(serverOffsetMs);
  const startTs = config.startTime ? new Date(config.startTime).getTime() : null;
  const endTs = config.endTime ? new Date(config.endTime).getTime() : null;

  if (startTs && now < startTs) return 'NOT_STARTED';
  if (endTs && now >= endTs) return 'ENDED';
  if (!isReadyForLiveView) return 'LOADING';
  return 'LIVE';
}

function useActivityState(params: {
  gateConfig: ActivityGateConfig;
  hasFatalError: boolean;
  isReadyForLiveView: boolean;
  isMounted: boolean;
}) {
  const { gateConfig, hasFatalError, isReadyForLiveView, isMounted } = params;
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [hasResolvedServerTime, setHasResolvedServerTime] = useState(false);
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>('LOADING');

  // ── AudioContext Force-Wake ───────────────────────────────────────────────────
  // Browsers (especially Edge) block Web Audio until first user interaction.
  // This effect registers a ONE-TIME listener on pointerdown that:
  //   1. Resumes Howler.ctx if suspended
  //   2. Sets isAudioContextReady = true so the UI honestly reflects audio state
  // It fires once, then removes itself — zero ongoing cost.
  useEffect(() => {
    const handleFirstInteraction = () => {
      if (typeof window !== 'undefined' && (window as any).Howler) {
        const ctx = (window as any).Howler.ctx;
        if (ctx) {
          if (ctx.state === 'suspended') {
            ctx.resume().then(() => {
              useAudioStore.getState().setAudioContextReady(true);
            }).catch(() => {
              // Already running or context was closed — still mark as ready
              useAudioStore.getState().setAudioContextReady(true);
            });
          } else {
            // Context already running (e.g., no autoplay block)
            useAudioStore.getState().setAudioContextReady(true);
          }
        } else {
          // No ctx available — treat as ready so audio attempts don't silently fail
          useAudioStore.getState().setAudioContextReady(true);
        }
      } else {
        // Howler not loaded yet — mark ready anyway; BGMController will handle it
        useAudioStore.getState().setAudioContextReady(true);
      }
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown',    handleFirstInteraction);
    };
    window.addEventListener('pointerdown', handleFirstInteraction);
    window.addEventListener('keydown',    handleFirstInteraction);
    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown',    handleFirstInteraction);
    };
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    const controller = new AbortController();
    let cancelled = false;
    const t0 = Date.now();

    fetchWithTimeout('/api/time', { signal: controller.signal })
      .then((result) => {
        if (cancelled) return;
        const data = result.data as { serverTime?: number } | null;
        const serverTime = data?.serverTime;
        if (typeof serverTime !== 'number' || !Number.isFinite(serverTime)) {
          setServerOffsetMs(0);
          setHasResolvedServerTime(true);
          return;
        }
        const roundTrip = Date.now() - t0;
        setServerOffsetMs(serverTime - (t0 + roundTrip / 2));
        setHasResolvedServerTime(true);
      })
      .catch(() => {
        if (cancelled) return;
        setServerOffsetMs(0);
        setHasResolvedServerTime(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isMounted]);

  useEffect(() => {
    if (!isMounted || !hasResolvedServerTime) return;

    const update = () => {
      setActivityStatus(
        deriveActivityStatus(gateConfig, serverOffsetMs, hasFatalError, isReadyForLiveView)
      );
    };

    update();
    const intervalId = window.setInterval(update, 1000);
    return () => window.clearInterval(intervalId);
  }, [gateConfig, hasFatalError, hasResolvedServerTime, isMounted, isReadyForLiveView, serverOffsetMs]);

  return { activityStatus, serverOffsetMs, hasResolvedServerTime };
}

// ── Component ──────────────────────────────────────────────────────────────────
// Loading Google Fonts — Cinzel for Roman numeral badges
if (typeof document !== 'undefined') {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap';
  document.head.appendChild(link);
}

export function BattleLayout({
  initialHp = { current: 100000, max: 100000 },
  initialInventory = { item_hand: 0, item_phallus: 0 },
  spineConfig,
  gameMilestones,
}: BattleLayoutProps) {
  // ── SSR-Safe: isMounted state (prevents hydration mismatch) ──────────────────
  const [isMounted, setIsMounted] = useState(false);

  // ── TC-LD-05: Instant-Sync State ──────────────────────────────────────────────
  // Set to true on mount if battle_assets_primed=true.
  // When true, the heavy LoadingScreen is skipped and a minimal sync UI is shown.
  const [isInstantSync, setIsInstantSync] = useState(false);

  // ── HP State ──────────────────────────────────────────────────────────────
  const [serverHp, setServerHp] = useState(initialHp);
  const [unconfirmedDamage, setUnconfirmedDamage] = useState(0);

  // ── Inventory State ────────────────────────────────────────────────────────
  const [inventory, setInventory] = useState(initialInventory);

  // ── Battle Init State (P0 2026-08-19) ─────────────────────────────────────
  // Holds the full /api/battle/init payload so it can be forwarded to
  // SubPageModal.  Hydrated by the initial poll (init call).
  const [battleInit, setBattleInit] = useState<{
    // REPARK 7.0 (2026-08-24): was server_total_damage (global boss HP delta).
    // Now personal_damage (this player's accumulated damage) — the new source
    // of truth for milestone unlock.
    personal_damage?: number;
    config?: { milestones?: unknown[] };
    user?: { milestones?: unknown[]; inventory?: { total_damage_dealt?: number } };
    boss?: { currentHp?: number; maxHp?: number };
  } | null>(null);

  // ════════════════════════════════════════════════════════════════════════════
  // REPARK 6.0 — P0 2026-07-25 — Frontend UID extraction & debug logging
  //
  // The Commander reported that even though the backend now echoes the original
  // business ID in `user_id`, the page still shows the two attack buttons as
  // DISABLED. The most likely root cause is that the client side of this page
  // does NOT receive the same UID the backend will resolve — either the cookie
  // is missing on this tab, or the URL query param is ignored, so the API call
  // hits `00000000-…` (the DEV fallback) instead of `11111111-…`.
  //
  // Resolution ladder (first non-empty wins):
  //   1. `?uid=` / `?userId=` query param on the current URL — Commander QA.
  //   2. Main Station cookie (`useUserId()` reads `env.authCookieName()`).
  //
  // We log every step loudly so the Commander can paste console output back.
  // ════════════════════════════════════════════════════════════════════════════
  const [urlUserId, setUrlUserId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('uid') ?? params.get('userId');
    const next = fromQuery && fromQuery.length > 0 ? fromQuery : null;
    setUrlUserId(next);
    // ── REPARK FRONTEND DEBUG — page mount + UID extraction ────────────────────
    console.log('==============================================');
    console.log('[REPARK FRONTEND DEBUG] 页面初始化 (BattleLayout mounted)');
    console.log('[REPARK FRONTEND DEBUG] 当前 URL:', window.location.href);
    console.log('[REPARK FRONTEND DEBUG] window.location.search:', window.location.search);
    console.log('[REPARK FRONTEND DEBUG] 当前完整 Cookie 字符串:', JSON.stringify(document.cookie || '(empty)'));
    console.log('[REPARK FRONTEND DEBUG] 从 URL ?uid/?userId 提取到的值:', next);
    console.log('==============================================');
  }, []);
  const clientUserId = useUserId();
  const effectiveUserId = urlUserId ?? clientUserId ?? null;
  const buildInitUrl = useCallback(() => {
    const u = effectiveUserId
      ? `/api/battle/init?userId=${encodeURIComponent(effectiveUserId)}`
      : '/api/battle/init';
    // ── REPARK API FETCH — outbound URL ─────────────────────────────────────────
    console.log(
      `[REPARK API FETCH] 发起请求: ${u}` +
        `  (source=${urlUserId ? 'urlQuery' : clientUserId ? 'cookie' : 'none'})`
    );
    return u;
  }, [effectiveUserId, urlUserId, clientUserId]);

  // ── Total Damage State (累计伤害) ────────────────────────────────────────
  const [totalDamage, setTotalDamage] = useState(0);

  // ── Activity Rules State ─────────────────────────────────────────────
  const [activityRules, setActivityRules] = useState('');
  const [activityGateConfig, setActivityGateConfig] = useState<ActivityGateConfig>({
    activityEnabled: true,
    startTime: undefined,
    endTime: undefined,
  });

  // REPARK 6.0 (2026-08-14): Admin-configured character profile (stage names
  // / bio / skills). Optional — CharacterIntroPanel falls back to defaults
  // when this is null or any sub-list is empty.
  const [characterProfile, setCharacterProfile] = useState<
    NonNullable<BattleInitData['config']['character_profile']> | null
  >(null);

  // REPARK 6.0 (2026-08-22): Spine form thresholds from /api/battle/init —
  // single source of truth for the StandardHPBar tick markers (② ③ ④). We
  // hydrate this from the init payload so changes in the admin form take
  // effect on the next page load. Default fallback mirrors the SSOT baseline
  // in activitiesPg.defaultConfig() (75/50/25).
  const [spineFormThresholds, setSpineFormThresholds] = useState<{
    stage2: number;
    stage3: number;
    stage4: number;
  }>({ stage2: 75, stage3: 50, stage4: 25 });

  // ── Task Red-Dot State ────────────────────────────────────────────────────
  const [taskRedDots, setTaskRedDots] = useState<{
    daily_energy: { currentProgress: number; targetThreshold: number; isClaimed: boolean; remainingAttempts: number; dailyLimit: number };
    daily_recharge: { currentProgress: number; targetThreshold: number; isClaimed: boolean; remainingAttempts: number; dailyLimit: number };
  }>({
    daily_energy: { currentProgress: 0, targetThreshold: 100, isClaimed: false, remainingAttempts: 1, dailyLimit: 5 },
    daily_recharge: { currentProgress: 0, targetThreshold: 100, isClaimed: false, remainingAttempts: 1, dailyLimit: 5 },
  });

  // P0 2026-08-19: Milestone reward state — mirrors `data.user.milestones`
  // returned by /api/battle/init. The server already computes `isUnlocked`
  // against the GLOBAL boss damage (maxHp - currentHp) and resolves claim
  // status from the DB, so we ONLY trust those flags here.  We never derive
  // `claimable` client-side from personal damage.
  const [milestones, setMilestones] = useState<ApiMilestone[]>([]);
  const hasClaimableRewards = milestones.some(
    (m) => m.isUnlocked && !m.isClaimed
  );
  // P0 2026-08-19: 「每日任务」红点判定 — 仅在进度 100% 且尚未领取
  // (`isClaimed=false`) 且仍有余次 (`remainingAttempts > 0`) 时点亮。
  // 注意: `isClaimed` 字段语义是「本轮是否已领」, 在多 claim 模型下需要
  // 结合 remainingAttempts(剩余可领次数) 判断是否仍可领。
  const hasClaimableTasks =
    (taskRedDots.daily_energy.currentProgress >= 100 &&
      !taskRedDots.daily_energy.isClaimed &&
      taskRedDots.daily_energy.remainingAttempts > 0) ||
    (taskRedDots.daily_recharge.currentProgress >= 100 &&
      !taskRedDots.daily_recharge.isClaimed &&
      taskRedDots.daily_recharge.remainingAttempts > 0);

  // FIX T-02: Dynamic task thresholds from /api/battle/init
  const [taskConfig, setTaskConfig] = useState<{ daily_energy: number; daily_recharge: number }>({
    daily_energy: 100,
    daily_recharge: 100,
  });

  // ── Attack Guard (TC-BT-09 anti-spam) ───────────────────────────────────
  const [isAttacking, setIsAttacking] = useState(false);

  // ── CHARACTER_INTERACTION_VOICE_LOCK: Standby-voice lock ───────────────────
  // Set to true the moment the user taps a character spine. Stays true
  // for the entire duration of the stage-specific Standby voice clip,
  // then resets. Combined with isAttacking on the WeaponBar so the
  // two attack buttons are fully disabled while the character is talking.
  const [isStandbyPlaying, setIsStandbyPlaying] = useState(false);
  // Defensive ref — prevents reentrant taps from racing the voice call
  // (e.g. user mashes the character while the line is still loading).
  const standbyLockRef = useRef(false);

  // P0 FIX 2026-08-30: Guard ref for the loading timeout latch.
  // Keeps the latest isCurrentModelRendered/isSpineLoaded state accessible to
  // handleLoadingTimeout without adding them to useCallback deps (which would
  // recreate the callback and risk losing the onTimeout wire from LoadingScreen).
  const loadingTimedOutGuardRef = useRef(false);

  // ── Loading Screen ────────────────────────────────────────────────────────
  const [hasSpineError, setHasSpineError] = useState(false);
  // TC-LD-05/06: Spine Stage 1 assets must load before dismissing LoadingScreen
  const [isSpineLoaded, setIsSpineLoaded] = useState(false);
  // TC-LD-02: All 4 stages must load before entering battle (REPARK v7.0)
  const [isStage2Loaded, setIsStage2Loaded] = useState(false);
  const [isStage3Loaded, setIsStage3Loaded] = useState(false);
  const [isStage4Loaded, setIsStage4Loaded] = useState(false);
  // P0 2026-08-20: isCurrentModelRendered — true only after WebGL has physically
  // drawn the first frame of the current active stage to the canvas.
  // This is the ONLY signal that guarantees the user sees a complete rendered
  // character — not just assets in memory or a skeleton without textures.
  const [isCurrentModelRendered, setIsCurrentModelRendered] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);
  // P0 2026-08-26: Set to true when Stage 1 character definitively failed to mount.
  // Passed to LoadingScreen to show "角色资源加载失败" instead of generic timeout.
  const [isStage1Failed, setIsStage1Failed] = useState(false);
  // P0 2026-08-26: BATTLE MINIMUM READY FIX
  // Previously: `isAssetLoaded = isSpineLoaded && isStage2Loaded && isStage3Loaded && isStage4Loaded`
  // This required ALL 4 stages before entering — too strict for first-screen experience.
  // Now: Stage 2/3/4 are background preloads only. Battle enters when:
  //   1. battleInit — backend battle state ready
  //   2. isSpineLoaded — Stage 1 Character truly mounted (onLoaded fires only after characterSpine await)
  //   3. isCurrentModelRendered — WebGL first frame confirmed (gated on characterSpine !== null)
  // Stage 2/3/4 load in parallel background and never block entry.
  const isAssetLoaded = isSpineLoaded;
  // isReadyForLiveView: STRICT DUAL GATE — no bypasses allowed.
  // Must have BOTH backend data AND a real rendered canvas frame with a non-null character.
  const isReadyForLiveView = Boolean(battleInit && isCurrentModelRendered);

  // P0 FALLBACK VISIBILITY FIX: Show the battle visual (SpineViewer container) when
  // EITHER the real model is ready (isReadyForLiveView) OR a fallback is active
  // (hasSpineError / loadingTimedOut). This separates fallback silhouette visibility
  // from the isReadyForLiveView gate — the silhouette must be visible when fallback
  // is active even if the real model has not yet rendered.
  // Normal loading: LoadingScreen covers the scene wrapper, so this is safe.
  // Real model ready: canvas shows real Spine model normally.
  // Fatal/timeout fallback: wrapper visible → silhouette visible → user sees fallback.
  const shouldShowBattleVisual = isReadyForLiveView || hasSpineError || loadingTimedOut;

  // ── P0 2026-08-20: Loading Gate Diagnostic Log
  // P0 FIX 2026-08-30: Keep loadingTimedOutGuardRef current so handleLoadingTimeout
  // can read fresh state without needing it in the useCallback deps (which would
  // recreate the callback and risk losing the wired onTimeout reference).
  useEffect(() => {
    loadingTimedOutGuardRef.current = Boolean(isCurrentModelRendered || isSpineLoaded);
    console.log('[TRACE][BattleLayout] render-state', {
      ts: Date.now(),
      battleInit: Boolean(battleInit),
      isSpineLoaded,
      isStage2Loaded,
      isStage3Loaded,
      isStage4Loaded,
      isAssetLoaded,
      isCurrentModelRendered,
      isReadyForLiveView,
      activityStatus,
    });
    shipBattleTrace('[BattleLayout] render-state', {
      battleInit: Boolean(battleInit),
      isSpineLoaded,
      isStage2Loaded,
      isStage3Loaded,
      isStage4Loaded,
      isAssetLoaded,
      isCurrentModelRendered,
      isReadyForLiveView,
    });
  }, [battleInit, isCurrentModelRendered, isReadyForLiveView, isSpineLoaded, isStage2Loaded, isStage3Loaded, isStage4Loaded, isAssetLoaded]);

  // ── TASK 4: Read-only Canvas DOM probe (fires after LoadingScreen dismiss) ──
  // Probes the Spine canvas DOM every 100ms once isReadyForLiveView flips true.
  // Logs each distinct (exists, width, height, opacity, display, visibility)
  // state change exactly once — no per-frame spam.
  useEffect(() => {
    if (!isReadyForLiveView) return;
    let lastKey = '';
    const probe = () => {
      try {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        const target = canvases.find((c) => {
          const w = c.width; const h = c.height;
          return w > 0 && h > 0;
        }) ?? canvases[0] ?? null;
        if (!target) {
          const k = 'no-canvas';
          if (k !== lastKey) {
            console.log('[TRACE][BattleLayout] canvas-dom', { ts: Date.now(), exists: false });
            shipBattleTrace('[BattleLayout] canvas-dom', {
              battleInit: Boolean(battleInit),
              isSpineLoaded,
              isStage2Loaded,
              isStage3Loaded,
              isStage4Loaded,
              isAssetLoaded,
              isCurrentModelRendered,
              isReadyForLiveView,
            }, true);
            lastKey = k;
          }
          return;
        }
        const cs = window.getComputedStyle(target);
        const k = `${target.width}x${target.height}|${cs.opacity}|${cs.display}|${cs.visibility}`;
        if (k !== lastKey) {
          console.log('[TRACE][BattleLayout] canvas-dom', {
            ts: Date.now(),
            exists: true,
            width: target.width,
            height: target.height,
            clientWidth: target.clientWidth,
            clientHeight: target.clientHeight,
            opacity: cs.opacity,
            display: cs.display,
            visibility: cs.visibility,
          });
          shipBattleTrace('[BattleLayout] canvas-dom', {
            battleInit: Boolean(battleInit),
            isSpineLoaded,
            isStage2Loaded,
            isStage3Loaded,
            isStage4Loaded,
            isAssetLoaded,
            isCurrentModelRendered,
            isReadyForLiveView,
          }, true);
          lastKey = k;
        }
      } catch { /* noop */ }
    };
    probe();
    const id = setInterval(probe, 100);
    return () => clearInterval(id);
  }, [isReadyForLiveView]);

  const { activityStatus, serverOffsetMs } = useActivityState({
    gateConfig: activityGateConfig,
    hasFatalError: hasSpineError || loadingTimedOut,
    isReadyForLiveView,
    isMounted,
  });

  const isActivityEnded = activityStatus === 'ENDED';
  const isActivityLive = activityStatus === 'LIVE';

  // ── Battle Trace Shipper: session bootstrap + pagehide flush ───────────────
  // Per Commander 2026-08-26: generate battleTraceSessionId at /battle mount,
  // emit a bootstrap event, and force-flush the diag queue on pagehide so the
  // tail of the timeline survives tab close.
  useEffect(() => {
    if (!isMounted) return;
    const sid = getBattleTraceSessionId();
    try {
      fetch('/api/diag/client-log', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          origin: 'battle-trace-bootstrap',
          events: [{
            ts: Date.now(),
            level: 'info',
            msg: JSON.stringify({
              event: 'session-bootstrap',
              pathname: window.location.pathname,
              visibilityState: document.visibilityState,
              isForceLoad: window.location.search.includes('force_load=1'),
            }),
          }],
        }),
      }).catch(() => undefined);
    } catch { /* noop */ }
    const onPageHide = () => { flushBattleTrace(); };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, [isMounted]);

  // ── TC-LD-05: Session Caching — ONLY set after Spine assets have actually loaded ───
  //
  // Logic:
  //   • First visit:  battle_assets_primed is NOT set → isInstantSync=false → LoadingScreen shows
  //                  Spine loads → handleSpineLoaded sets primed=true
  //   • Subsequent:   battle_assets_primed IS set → isInstantSync=true → light sync UI shows briefly
  //                  Spine loads immediately (cached) → handleSpineLoaded fires → done
  //
  // Dev Debug: Add ?force_load=1 to URL to bypass cache and force full loading sequence
  useEffect(() => {
    setIsMounted(true);

    const isForceLoad = window.location.search.includes('force_load=1');

    if (isForceLoad) {
      sessionStorage.removeItem('battle_assets_primed');
      return;
    }

    const wasPrimed = sessionStorage.getItem('battle_assets_primed') === 'true';
    if (wasPrimed) {
      setIsInstantSync(true);
    }
  }, []);

  const handleLoadingComplete = useCallback((error?: boolean) => {
    if (error) {
      setHasSpineError(true);
      return;
    }
  }, []);

  const handleSpineLoaded = useCallback(() => {
    setIsSpineLoaded(true);
  }, []);

  const handleStage2Loaded = useCallback(() => {
    sessionStorage.setItem('battle_assets_primed', 'true');
    setIsStage2Loaded(true);
  }, []);

  const handleStage3Loaded = useCallback(() => {
    setIsStage3Loaded(true);
  }, []);

  const handleStage4Loaded = useCallback(() => {
    setIsStage4Loaded(true);
  }, []);

  const handleLoadingTimeout = useCallback(() => {
    // P0 2026-08-26 FINAL: Timeout is a generic slow-load signal.
    // Only set loadingTimedOut — the error copy is controlled by
    // isStage1Failed, which is only set to true by handleFatalSpineError
    // (confirmed Stage 1 character mount failure or render failure).
    // A plain 15s watchdog timeout is NOT a character failure.
    // P0 FIX 2026-08-30: Do NOT set the latch if the real model has already
    // rendered OR the character spine has loaded. The guard ref is kept current
    // by the render-state trace effect below. This prevents the latch from firing
    // when the 15s watchdog races with a just-completed first render.
    if (loadingTimedOutGuardRef.current) {
      console.log('[BattleLayout] handleLoadingTimeout BLOCKED — model already rendering (guard ref)');
      return;
    }
    console.log('[BattleLayout] handleLoadingTimeout — setting loadingTimedOut=true (watchdog fired after 15s)');
    setLoadingTimedOut(true);
  }, []);

  const handleFatalSpineError = useCallback(() => {
    // P0 2026-08-26 FINAL: Confirmed Stage 1 character failure — mark both
    // so LoadingScreen shows "角色资源加载失败" (not generic timeout copy).
    setHasSpineError(true);
    setIsStage1Failed(true);
  }, []);

  // P0 2026-08-25: fires once when SpineViewer reports first completed WebGL render.
  // Logs the definitive signal so browser console proves the gate is real.
  const handleCurrentModelRendered = useCallback(() => {
    console.log('[TRACE][BattleLayout] first-visible-frame-ready', { ts: Date.now() });
    shipBattleTrace('[BattleLayout] first-visible-frame-ready', {
      battleInit: Boolean(battleInit),
      isSpineLoaded,
      isStage2Loaded,
      isStage3Loaded,
      isStage4Loaded,
      isAssetLoaded,
      isCurrentModelRendered: true,
      isReadyForLiveView: Boolean(battleInit),
    });
    console.log('[BattleLayout] first visible frame ready');
    setIsCurrentModelRendered(true);
    // P0 FIX 2026-08-30: loadingTimedOut is a one-way latch — it was set by the 15s
    // watchdog when loading was slow, but the model IS now visible. Clear the latch so
    // the RESOURCE FALLBACK banner does not persist over a real successful render.
    setLoadingTimedOut(false);
  }, [battleInit, isSpineLoaded, isStage2Loaded, isStage3Loaded, isStage4Loaded, isAssetLoaded]);

  const handleForceEnter = useCallback(() => {
    // P0 2026-08-25: Guard — do not force-enter if the canvas has never rendered.
    // The user may click "仍然进入" during the timeout screen even when the WebGL
    // canvas is still blank (e.g. GPU freeze, afterrender never fired). Forcing past
    // this point bypasses the isCurrentModelRendered gate and drops the user into
    // an empty battle — the exact P0 symptom we just fixed.
    // Only allow force-entry if at least one frame has completed rendering.
    if (!isCurrentModelRendered) {
      console.warn('[BattleLayout] handleForceEnter BLOCKED — canvas has no confirmed render. Will not bypass LoadingGate.');
      return;
    }
    sessionStorage.setItem('battle_assets_primed', 'true');
    setHasSpineError(true);
  }, [isCurrentModelRendered]);

  // ── Dynamic back navigation (REPARK 6.0 — backUrl / returnUrl support) ────────
  // Reads ?backUrl= or ?returnUrl= from the current URL, validates the protocol
  // (only http: / https:), and navigates there. Falls back to the Main Station
  // home URL (env.mainStationHomeUrl()) when no custom URL is provided or when
  // validation fails. Completely replaces hardcoded window.location.href = '/'.
  const handleBackNavigation = useCallback(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const customUrl = params.get('backUrl') ?? params.get('returnUrl');

    if (customUrl) {
      try {
        const parsed = new URL(customUrl, window.location.href);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          window.location.href = parsed.href;
          return;
        }
      } catch {
        // Invalid URL — fall through to safe default
      }
    }

    window.location.href = env.mainStationHomeUrl();
  }, []);

  // ── Form State (TC-BT-15: unlockedForms grows monotonically) ───────────────
  const [unlockedForms, setUnlockedForms] = useState<Set<FormId>>(
    new Set<FormId>(['initial'])
  );
  const [activeForm, setActiveForm] = useState<FormId>('initial');
  // TASK 3: Tracks the live spine stage index (0–3) for CharacterIntroPanel
  const [activeStageIdx, setActiveStageIdx] = useState<number>(0);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const isMountedRef = useRef(true);
  const modalTriggerLockRef = useRef(false);
  const lastAttackTimeRef = useRef(0);
  const pendingAttacksRef = useRef<Map<string, { itemType: 'item_hand' | 'item_phallus'; damage: number }>>(new Map());
  // ── P0 2026-07-28: One-shot guard for activity-ended toast stacking.
  // Set to true after the first attack attempt post-expiry so subsequent taps
  // are silent (no repeated '活动已结束' toasts). Reset on activity restart.
  const activityEndedToastShownRef = useRef(false);
  // ── A1/A2: SpineViewer ref — used to call forceResetAllModels on form switch.
  // This physically "heals" any frozen model (S1 or S2) when the user switches forms.
  const spineViewerRef = useRef<SpineViewerRef | null>(null);
  // ── A1/A2: Force-reset models on form switch ────────────────────────────────
  // FIX T4: Removed `isAttacking` from dependency array.
  // The effect should ONLY respond to activeForm changes — isAttacking is read-only.
  // Adding it caused the effect to re-run on every attack, which is unnecessary.
  const prevActiveFormRef = useRef<FormId>(activeForm);
  const activeFormRef = useRef<FormId>(activeForm);
  useEffect(() => {
    prevActiveFormRef.current = activeForm;
    activeFormRef.current = activeForm;
  }, [activeForm]);
  useEffect(() => {
    if (prevActiveFormRef.current !== activeForm) {
      prevActiveFormRef.current = activeForm;
      // ── A1/A2: Force-reset both models on form switch ────────────────────────
      // This heals any frozen model (S1 or S2) so switching back to it later
      // shows it fully alive, not stuck mid-animation.
      spineViewerRef.current?.forceResetAllModels();
      console.log(`🔓 [BattleLayout] Form switched — releasing attack lock`);
      // Release the attack lock if it's held — switching forms cancels the animation
      if (isAttacking) setIsAttacking(false);
    }
  }, [activeForm]);


  // ── Computed ─────────────────────────────────────────────────────────────
  const displayedHp = Math.max(0, serverHp.current - unconfirmedDamage);
  const maxHp = serverHp.max;
  const hpPercent = maxHp > 0 ? (displayedHp / maxHp) * 100 : 100;

  // ── Dynamic form configs (driven by /api/game/init spine config) ───────────
  const formConfigs: FormConfig[] = buildFormConfigs(spineConfig?.formThresholds ?? null);

  // REPARK 6.0 (2026-08-22): Drive the StandardHPBar ② ③ ④ tick markers from
  // the admin-configured spine form thresholds. When the operator updates
  // `activities.config.spine.formThresholds` in /admin/activities/[id]/config
  // and saves, the next /api/battle/init response carries the new values and
  // the bar reflects them on the next page load. NaN / out-of-range values
  // (e.g. payload missing for older activities) fall back to 75/50/25.
  const dynamicHpMilestones = [
    {
      unlockThreshold: Number.isFinite(spineFormThresholds.stage2) ? spineFormThresholds.stage2 : 75,
      tag: '②',
    },
    {
      unlockThreshold: Number.isFinite(spineFormThresholds.stage3) ? spineFormThresholds.stage3 : 50,
      tag: '③',
    },
    {
      unlockThreshold: Number.isFinite(spineFormThresholds.stage4) ? spineFormThresholds.stage4 : 25,
      tag: '④',
    },
  ];

  // ── Modal subscription — use hook at component level (Rules of Hooks) ──
  const modalPage = useModalStore((s) => s.page);

  // ── Stable modal control callbacks — memoized so SubPageModal (React.memo)
  // never receives a new function reference on parent re-renders. ─────────────
  const stableCloseModal = useCallback(() => closeModal(), []);
  const stableSetInventory = useCallback((inv: typeof inventory) => setInventory(inv), []);
  // Guards against:
  //   1. Reentrant taps (modalTriggerLockRef — 250ms)
  //   2. Already-open modal (modalStore guard — NO-OP on same page)
  //   3. SyntheticEvent bubbling (stopPropagation / stopImmediatePropagation)
  //   4. Double-open from concurrent /api/battle/init re-renders (stable callback)
  const handleModalOpen = useCallback((page: 'task' | 'reward' | 'rules' | 'leaderboard', e?: React.SyntheticEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    if (e && 'nativeEvent' in e && typeof (e.nativeEvent as Event)?.stopImmediatePropagation === 'function') {
      (e.nativeEvent as Event).stopImmediatePropagation();
    }
    if (modalTriggerLockRef.current) return;
    openModal(page);
    modalTriggerLockRef.current = true;
    window.setTimeout(() => { modalTriggerLockRef.current = false; }, 250);
  }, []);

  // ── Task claim refresh ───────────────────────────────────────────────────────
  // Called when a task is claimed in SubPageModal; refreshes taskRedDots so
  // the red-dot progress bar in BattleLayout reflects the updated state.
  const handleTaskClaimed = useCallback(async (taskType: 'daily_energy' | 'daily_recharge') => {
    try {
      const { data: initJson } = await fetchWithTimeout<{
        ok: boolean;
        data?: { user?: { tasks?: {
          daily_energy: { currentProgress: number; targetThreshold: number; isClaimed: boolean; remainingAttempts: number; dailyLimit: number };
          daily_recharge: { currentProgress: number; targetThreshold: number; isClaimed: boolean; remainingAttempts: number; dailyLimit: number };
        } } };
      }>(buildInitUrl());

      // ── REPARK API RESPONSE — short payload snapshot for the Commander ─────
      console.log('[REPARK API RESPONSE] (handleTaskClaimed) tasks:', {
        ok: initJson?.ok,
        daily_energy: initJson?.data?.user?.tasks?.daily_energy,
        daily_recharge: initJson?.data?.user?.tasks?.daily_recharge,
      });

      if (initJson?.ok && initJson.data?.user?.tasks) {
        const api = initJson.data!.user!.tasks!;
        // snapshot the current state before async op (safe via closure)
        const prevState = taskRedDots;
        const newEnergy: typeof taskRedDots.daily_energy = {
          ...prevState.daily_energy,
          currentProgress: api.daily_energy.currentProgress,
          targetThreshold: api.daily_energy.targetThreshold,
          isClaimed: api.daily_energy.isClaimed,
          remainingAttempts: api.daily_energy.remainingAttempts,
          dailyLimit: api.daily_energy.dailyLimit ?? prevState.daily_energy.dailyLimit,
        };
        const newRecharge: typeof taskRedDots.daily_recharge = {
          ...prevState.daily_recharge,
          currentProgress: api.daily_recharge.currentProgress,
          targetThreshold: api.daily_recharge.targetThreshold,
          isClaimed: api.daily_recharge.isClaimed,
          remainingAttempts: api.daily_recharge.remainingAttempts,
          dailyLimit: api.daily_recharge.dailyLimit ?? prevState.daily_recharge.dailyLimit,
        };
        setTaskRedDots(() => ({
          daily_energy: newEnergy,
          daily_recharge: newRecharge,
        }));
      }
    } catch (err) {
      console.warn('[BattleLayout] Failed to refresh task state after claim:', err);
    }
  }, [buildInitUrl]);

  // ── Mount guard ───────────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // ════════════════════════════════════════════════════════════════════════════════
  // TASK 1: Single Source of Truth Initialization
  // Fetch /api/battle/init on mount to hydrate all state from REAL backend
  // ════════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isMountedRef.current) return;

    const controller = new AbortController();

    const initializeFromBackend = async () => {
      console.log('[BattleLayout] Initializing from /api/battle/init...');

      try {
        const result = await fetchWithTimeout<{ ok: boolean; data?: BattleInitData; error?: { code?: string; message?: string } }>(
          buildInitUrl(),
          { signal: controller.signal },
        );

        const json = result.data;
        if (!json || !json.ok || !json.data) {
          // P0 2026-07-28: ACTIVITY_OFFLINE means the admin pulled the kill
          // switch (or no activity row exists). Reflect this on the gate so
          // deriveActivityStatus() resolves to 'ENDED' and the attack buttons
          // are blocked. Previously the catch swallowed the error and the
          // gate stayed at its default {activityEnabled: true} → 'LIVE'.
          if (json?.error?.code === 'ACTIVITY_OFFLINE') {
            setActivityGateConfig({
              activityEnabled: false,
              startTime: undefined,
              endTime: undefined,
            });
            console.warn('[BattleLayout] Activity offline reported by backend, locking UI.');
            return;
          }
          throw new Error(json?.error?.message || 'Invalid response');
        }

        const data: BattleInitData = json.data;

        // ── REPARK API RESPONSE — full inventory snapshot for the Commander ──
        console.log('[REPARK API RESPONSE] (initialize) full payload:', {
          ok: json.ok,
          boss: { current: data.boss.currentHp, max: data.boss.maxHp },
          inventory: data.user.inventory,
          forms: data.user.forms.map((f) => ({ id: f.formId, unlocked: f.isUnlocked })),
        });

        // Hydrate Boss HP
        setServerHp({
          current: data.boss.currentHp,
          max: data.boss.maxHp,
        });

        // Hydrate Inventory (API uses item_hand_count, WeaponBar uses item_hand)
        setInventory({
          item_hand: data.user.inventory.item_hand_count,
          item_phallus: data.user.inventory.item_phallus_count,
        });

        // Hydrate Total Damage (累计伤害)
        setTotalDamage(data.user.inventory.total_damage_dealt ?? 0);

        setActivityRules(data.config.rules ?? '');
        setActivityGateConfig({
          activityEnabled: data.config.activityEnabled,
          startTime: data.config.startTime,
          endTime: data.config.endTime,
        });

        // FIX T-02: Hydrate dynamic task thresholds
        if (data.taskConfig) {
          setTaskConfig(data.taskConfig);
        }

        // Hydrate Task Red-Dots (include targetThreshold from API + dailyLimit)
        setTaskRedDots({
          daily_energy: {
            currentProgress: data.user.tasks.daily_energy.currentProgress,
            targetThreshold: data.user.tasks.daily_energy.targetThreshold,
            isClaimed: data.user.tasks.daily_energy.isClaimed,
            remainingAttempts: data.user.tasks.daily_energy.remainingAttempts,
            dailyLimit: data.user.tasks.daily_energy.dailyLimit ?? 5,
          },
          daily_recharge: {
            currentProgress: data.user.tasks.daily_recharge.currentProgress,
            targetThreshold: data.user.tasks.daily_recharge.targetThreshold,
            isClaimed: data.user.tasks.daily_recharge.isClaimed,
            remainingAttempts: data.user.tasks.daily_recharge.remainingAttempts,
            dailyLimit: data.user.tasks.daily_recharge.dailyLimit ?? 5,
          },
        });

        // P0 2026-08-19: Hydrate milestone rewards so the red-dot on the
        // 「进度奖励」 button reflects REAL server-evaluated unlock/claim
        // state (not the daily-recharge task progress — that was the old
        // inverted bug).
        if (data.user.milestones && Array.isArray(data.user.milestones)) {
          setMilestones(data.user.milestones);
        }

        // P0 2026-08-19: Forward the full init payload to SubPageModal so it
        // renders the admin-configured milestones instead of hardcoded defaults.
        setBattleInit(data as any);

        // REPARK 7.0 (2026-08-24): Sync ACTIVITY-SCOPED personal_damage to
        // rewardStore so the red-dot badge (GameBannerCarousel, H5Banner,
        // HomePageClient) uses the player's damage in the CURRENT activity.
        //
        // Source: data.personal_damage (top-level field on the init payload,
        // scoped to the active activity) — NOT data.user.inventory.total_damage_dealt
        // (global / all-time, would incorrectly unlock milestones from prior activities).
        useRewardStore.getState().setPersonalDamage(
          (data as { personal_damage?: number }).personal_damage ?? 0
        );

        // Hydrate Form Unlock Status from API
        // P0 2026-09-19: Map server stage1-4 IDs → client FormId via the
        // authoritative bridge so FormSelector's Set.has(form.id) actually matches.
        const forms = new Set<FormId>(['initial']);
        for (const form of data.user.forms) {
          if (!form.isUnlocked) continue;
          const clientId = serverFormIdToClientFormId(form.formId);
          if (clientId) forms.add(clientId);
        }
        setUnlockedForms(forms);

        // REPARK 6.0 (2026-08-14): Capture admin-configured character profile.
        // The H5 panel falls back to DEFAULT_* if any field is empty, so we
        // pass the raw payload untouched.
        if (data.config.character_profile) {
          setCharacterProfile(data.config.character_profile);
        }

        // REPARK 6.0 (2026-08-22): Capture admin-configured spine form thresholds
        // so the StandardHPBar ② ③ ④ tick markers track the operator's latest
        // values. Falls back to the SSOT baseline (75/50/25) when the payload
        // is missing — back-compat with init responses predating this field.
        const apiSpineFt = data.config.spine?.formThresholds;
        const safeSpine = {
          stage2: Number(apiSpineFt?.stage2 ?? 75),
          stage3: Number(apiSpineFt?.stage3 ?? 50),
          stage4: Number(apiSpineFt?.stage4 ?? 25),
        };
        setSpineFormThresholds(safeSpine);

        console.log('[BattleLayout] Initialized:', {
          bossHp: data.boss.currentHp,
          inventory: { item_hand: data.user.inventory.item_hand_count, item_phallus: data.user.inventory.item_phallus_count },
          forms: Array.from(forms),
        });
      } catch (err: any) {
        // P0 2026-07-26: Silence the AbortError ghost that fires when the
        // controller aborts during cleanup (e.g., HMR or unmount). Treat it
        // as a successful exit, not an error.
        if (err?.kind === 'ABORTED' || err?.name === 'AbortError' || /aborted/i.test(err?.message ?? '')) {
          console.debug('[BattleLayout] Fetch aborted during cleanup (safe to ignore).');
          return;
        }
        console.error('[BattleLayout] Init failed, using defaults:', err);
        // Continue with defaults - backend will be in mock mode
      }
    };

    initializeFromBackend();

    return () => controller.abort();
  }, [buildInitUrl]);

  // ════════════════════════════════════════════════════════════════════════════════
  // TC-BT-05/15: Re-init HP when Admin resets boss HP in /api/admin/boss/update-hp
  // Polls /api/battle/init every 10 seconds + on tab visibility-change
  // to pick up external HP modifications made by the Commander.
  // ════════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isMountedRef.current) return;

    let pollController: AbortController | null = null;

    const syncHpFromAdmin = async () => {
      try {
        pollController?.abort();
        pollController = new AbortController();
        const result = await fetchWithTimeout<{ ok: boolean; data?: BattleInitData }>(
          buildInitUrl(),
          { signal: pollController.signal },
        );
        const json = result.data;
        if (!json?.ok || !json.data) return;
        const { currentHp, maxHp } = json.data.boss;
        setServerHp((prev) => {
          if (prev.current === currentHp && prev.max === maxHp) return prev;
          return { current: currentHp, max: maxHp };
        });
        const syncedInventory = {
          item_hand: json.data.user.inventory.item_hand_count,
          item_phallus: json.data.user.inventory.item_phallus_count,
        };
        setInventory(syncedInventory);
        setTotalDamage(json.data.user.inventory.total_damage_dealt ?? 0);
        // ── REPARK API RESPONSE — periodic sync snapshot (3s polling) ─────
        console.log('[REPARK API RESPONSE] (syncHpFromAdmin) inventory:', syncedInventory);
        // Polling now also syncs daily task progress so the task red-dot badge
        // updates live when webhook callbacks arrive (no need to refresh the page).
        const tasks = json.data.user.tasks;
        if (tasks) {
          setTaskRedDots(prev => ({
            daily_energy: {
              ...prev.daily_energy,
              currentProgress: tasks.daily_energy.currentProgress,
              isClaimed: tasks.daily_energy.isClaimed,
              remainingAttempts: tasks.daily_energy.remainingAttempts,
            },
            daily_recharge: {
              ...prev.daily_recharge,
              currentProgress: tasks.daily_recharge.currentProgress,
              isClaimed: tasks.daily_recharge.isClaimed,
              remainingAttempts: tasks.daily_recharge.remainingAttempts,
            },
          }));
        }
        // P0 2026-08-19: Also refresh milestone unlock/claim state from the
        // server every poll. Without this, the red dot would stay lit (or
        // dim) based on stale client snapshots while the admin/manual damage
        // tick keeps moving the global boss HP across thresholds.
        const apiMilestones = (json.data.user as { milestones?: ApiMilestone[] })?.milestones;
        if (apiMilestones && Array.isArray(apiMilestones)) {
          setMilestones(apiMilestones);
        }
        // P0 2026-08-19: Forward the latest init payload to SubPageModal so its
        // `personal_damage` / `boss` / `milestones` re-render in lock-step
        // with the parent poll (otherwise the rewards panel shows a stale
        // damage total after the user lands more attacks).
        setBattleInit(json.data as any);

        // ── A3 (REPARK 2026-09): Sync admin-configured spine thresholds ───────
        // Without this, changing thresholds in /admin/activities/[id]/config
        // would not affect the form unlock buttons until the page is reloaded.
        const apiSpineFt = json.data.config.spine?.formThresholds;
        const newSpineFt = {
          stage2: Number(apiSpineFt?.stage2 ?? 75),
          stage3: Number(apiSpineFt?.stage3 ?? 50),
          stage4: Number(apiSpineFt?.stage4 ?? 25),
        };
        setSpineFormThresholds(newSpineFt);

        // ── A3: Sync unlocked forms from server + re-validate active selection ──
        // Server is authoritative for the unlock state.
        // We rebuild unlockedForms DIRECTLY from the server's user.forms[] — NO local HP append.
        // P0 2026-09-19: Use the same serverFormIdToClientFormId bridge as init.
        const serverForms = json.data.user.forms ?? [];
        const nextUnlocked = new Set<FormId>(['initial']);
        for (const f of serverForms) {
          if (!f.isUnlocked) continue;
          const clientId = serverFormIdToClientFormId(f.formId);
          if (clientId) nextUnlocked.add(clientId);
        }

        // Design rule: current activeForm must stay valid.
        // If the active form is no longer unlocked, fall back to the
        // highest-indexed available form (shadow > flame > awakening > initial).
        // Stage 1 (initial) is always in unlockedForms, so a fallback always exists.
        const FORM_ORDER: FormId[] = ['shadow', 'flame', 'awakening', 'initial'];
        const currentActive = activeFormRef.current;
        let needsFallback = false;
        for (const fid of FORM_ORDER) {
          if (fid === 'initial') break; // initial is always available — stop here
          if (currentActive === fid && !nextUnlocked.has(fid)) {
            needsFallback = true;
            break;
          }
        }
        if (needsFallback) {
          // Find the highest available stage (iterate in reverse order)
          for (const fid of FORM_ORDER) {
            if (nextUnlocked.has(fid)) {
              console.log(`[BattleLayout] Form "${activeForm}" no longer unlocked — falling back to "${fid}"`);
              setActiveForm(fid);
              spineViewerRef.current?.forceResetAllModels();
              break;
            }
          }
        }

        setUnlockedForms(nextUnlocked);
        // P0 2026-08-21: Push ACTIVITY-SCOPED personal_damage to rewardStore
        // so the red-dot badge stays in sync with the milestone list.
        //
        // Source: top-level data.personal_damage — NOT
        // data.user.inventory.total_damage_dealt (which is global / all-time
        // and would falsely unlock milestones from other activities).
        useRewardStore.getState().setPersonalDamage(
          (json.data as { personal_damage?: number }).personal_damage ?? 0
        );
      } catch {
        // Silent — non-critical background sync
      }
    };

    const POLL_INTERVAL = 3_000; // 3-second polling for full-server HP sync
    const pollId = setInterval(syncHpFromAdmin, POLL_INTERVAL);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncHpFromAdmin();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(pollId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      pollController?.abort();
    };
  }, [buildInitUrl]);

  // ════════════════════════════════════════════════════════════════════════════════
  // REPARK 7.0 (2026-09-18 round 2): Form unlock is SERVER-AUTHORITATIVE.
  // TASK 3's independent HP-based unlock effect is REMOVED.
  // The only source of truth for form unlock state is:
  //   1. /api/battle/init → forms[] → isUnlocked (server getFormStatus())
  //   2. polling sync → setUnlockedForms(nextUnlocked) from server.forms
  // Client must NEVER independently decide that a form is unlocked.
  // ════════════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════════════
  // TASK 2: Real Attack Execution with Optimistic Update & Rollback
  // ════════════════════════════════════════════════════════════════════════════════
  const handleAttack = useCallback(async (itemType: 'item_hand' | 'item_phallus'): Promise<void> => {
    // TC-BT-04: if modal open, ignore
    if (useModalStore.getState().page) return;

    // TC-BT-14: block all attacks after activity end time.
    // Use a one-shot ref so the toast fires only on the FIRST click after expiry,
    // not on every subsequent tap (which would stack multiple identical toasts).
    if (isActivityEnded) {
      if (!activityEndedToastShownRef.current) {
        activityEndedToastShownRef.current = true;
        toast.warning('活动已结束', 3000);
      }
      return;
    }

    const currentCount = inventory?.[itemType] ?? 0;
    if (currentCount <= 0) {
      handleModalOpen('task');
      return;
    }

    // TC-BT-09: disable buttons immediately
    setIsAttacking(true);

    // Rollback snapshot
    const previousInventory = { ...inventory };

    // Generate unique nonce for idempotency
    const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // ════════════════════════════════════════════════════════════════════════════
    // OPTIMISTIC UPDATE: Apply immediately for responsive UX
    // ════════════════════════════════════════════════════════════════════════════
    
    // Optimistic inventory deduction
    setInventory((prev) => ({
      ...prev,
      [itemType]: Math.max(0, (prev[itemType] ?? 1) - 1),
    }));

    // Track pending attack for visual feedback
    pendingAttacksRef.current.set(nonce, { itemType, damage: 0 });
    setUnconfirmedDamage((prev) => prev + 1); // Placeholder, will be updated

    // ════════════════════════════════════════════════════════════════════════════
    // VISUAL EFFECTS: Fire AFTER confirmed API response with actual damage
    // ════════════════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════════════════
    // REAL API CALL: Execute atomic attack on backend
    // ════════════════════════════════════════════════════════════════════════════
    try {
      // TC-BT-08/13/17-V6: Network timeout delegated to fetchWithTimeout wrapper.
      // Baseline (production mode, 2026-07-11 e2e):
      //   P50 of /api/action/attack  = 1.8s
      //   P99 (cold Redis Lua + PG)  = 8.2s
      // 15s = P99 × 1.8 → safe margin without stranding the UI.
      const controller = new AbortController();
      const result = await fetchWithTimeout<AttackResponse>('/api/action/attack', {
        method: 'POST',
        timeoutMs: 15_000,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(getAuthHeader() ? { 'Authorization': getAuthHeader()! } : {}),
        },
        body: JSON.stringify({
          item_type: itemType,
          nonce: nonce,
        }),
      });

      // result.data is AttackResponse (or undefined on HTTP_NON_2XX, which throws)
      const response: AttackResponse = result.data ?? { ok: false };

      // TC-BT-A4: Log the raw response for every error so we can diagnose the 500
      if (!response.ok || !response.data) {
        console.warn('[BattleLayout] Attack API error response:', {
          status: result.status,
          elapsedMs: result.elapsedMs,
          reqId: result.reqId,
          ok: response.ok,
          error: response.error,
          // REPARK 6.0 — P0 2026-07-25: also dump the raw body so the
          // Commander can paste stack traces / DB constraint errors.
          raw: (response as unknown as Record<string, unknown>),
        });
        // REPARK 6.0 — P0 2026-07-25 — always print the backend message
        // verbatim. The Commander has been chasing a 5xx where the
        // toast hides the real reason; the console MUST not.
        console.error('[REPARK ATTACK ERROR] backend says:', {
          status: result.status,
          error: response.error,
          rawMessage: (response as unknown as { message?: string }).message,
          rawError: (response as unknown as { error?: unknown }).error,
        });
        // Handle specific error codes
        const errorCode = response.error?.code ?? 'UNKNOWN';
        
        switch (errorCode) {
          case 'INSUFFICIENT_ITEM':
            toast.error('物品不足', 3000);
            break;
          case 'DUPLICATE_ATTACK':
            console.warn('[BattleLayout] Duplicate attack rejected');
            break;
          case 'RATE_LIMITED':
            toast.warning('攻击太频繁，请稍后再试', 3000);
            break;
          case 'BAD_RESPONSE':
            toast.error('服务器异常，请稍后重试', 4000);
            break;
          default:
            toast.error('网络异常，请重试', 4000);
        }

        // ROLLBACK on any error
        throw new Error(errorCode);
      }

      const { actual_damage, new_hp, total_damage } = response.data;

      // Update pending attack with actual damage
      pendingAttacksRef.current.set(nonce, { itemType, damage: actual_damage });

      // Update unconfirmed damage with actual value
      setUnconfirmedDamage(() => {
        const pendingDamage = Array.from(pendingAttacksRef.current.values())
          .reduce((sum, a) => sum + a.damage, 0);
        return pendingDamage;
      });

      // ════════════════════════════════════════════════════════════════════════
      // SUCCESS: Sync serverHp and totalDamage from REAL API response
      // ════════════════════════════════════════════════════════════════════════
      setServerHp((prev) => ({ ...prev, current: new_hp }));
      setTotalDamage(total_damage ?? totalDamage + actual_damage);

      // Clear all unconfirmed damage for this attack
      pendingAttacksRef.current.delete(nonce);
      setUnconfirmedDamage((prev) => Math.max(0, prev - actual_damage));

      lastAttackTimeRef.current = Date.now();

      // Visual effects — fire with the CONFIRMED damage value
      const weaponLetter = itemType === 'item_hand' ? 'a' : 'b';
      spawnFloatingDamage(
        actual_damage,
        45 + (Math.random() - 0.5) * 20,
        28 + (Math.random() - 0.5) * 10
      );
      spawnParticles(
        itemType === 'item_hand' ? 'gold' : 'blue',
        45 + (Math.random() - 0.5) * 15,
        30 + (Math.random() - 0.5) * 8
      );
      if (typeof (window as any).triggerHitFeedback === 'function') {
        (window as any).triggerHitFeedback(actual_damage, weaponLetter);
      }

      // ── A1: Trigger attack animation, await its Promise ────────────────────────
      // triggerSpineAttack() returns Promise<void> that resolves only when the
      // Track 1 attack animation fires 'complete' AND the blend settles.
      // isAttacking lock is held until that Promise settles — the absolute
      // physical lock. No window events, no 2000ms fallback.
      const attackPromise = (window as any).triggerSpineAttack?.(actual_damage, weaponLetter);
      if (attackPromise) {
        await attackPromise;
      }
      // Lock released — buttons become interactive again
      setIsAttacking(false);
      // Attack result logged by backend response

    } catch (err) {
      // ════════════════════════════════════════════════════════════════════════
      // ROLLBACK (Section 2.10): Revert optimistic changes
      // ════════════════════════════════════════════════════════════════════════
      console.warn('[BattleLayout] Attack failed, rolling back:', err);

      // Remove from pending
      pendingAttacksRef.current.delete(nonce);

      // Clear unconfirmed damage
      setUnconfirmedDamage(() => {
        const pendingDamage = Array.from(pendingAttacksRef.current.values())
          .reduce((sum, a) => sum + a.damage, 0);
        return pendingDamage;
      });

      // Revert inventory
      setInventory(previousInventory);

      // TC-BT-09: Release lock immediately on failure
      setIsAttacking(false);

      // TC-BT-08/13/17-V6: FetchError drives toast selection.
      // We don't have to string-match err names anymore — fetchWithTimeout
      // hands back a typed error with a `kind` discriminator.
      if (err instanceof FetchError) {
        const k = err.payload.kind;
        if (k === 'TIMEOUT') {
          toast.warning('网络超时，请重试', 4000);
        } else if (k === 'NETWORK') {
          toast.error('网络异常，请重试', 4000);
        } else if (k === 'HTTP_NON_2XX' && err.payload.status === 401) {
          toast.warning('请先登录', 4000);
        } else if (k === 'BAD_JSON' || k === 'HTTP_NON_2XX') {
          toast.error('服务器异常，请稍后重试', 4000);
        }
        // ABORTED is silence — component unmounted, no UI to update.
      } else if (!(err instanceof Error) || ![
        'INSUFFICIENT_ITEM', 'DUPLICATE_ATTACK', 'RATE_LIMITED', 'BAD_RESPONSE',
      ].includes(err.message)) {
        toast.error('网络异常，请重试', 4000);
      }
    } finally {
      // On SUCCESS: isAttacking is released by the await attackPromise above.
      // On FAILURE (catch): we release immediately above in the catch block.
      // The finally block here handles only the rollback path — no double-release.
    }
  }, [inventory, totalDamage, isActivityEnded, handleModalOpen]);

  // ── Form selection ─────────────────────────────────────────────────────────
  // TC-BT-05/12: activeForm drives SpineViewer's State-Driven form switching.
  // SpineViewer maps: 'initial'→Stage1, 'awakening'→Stage2(morph), 'flame'/'shadow'→no-op.
  const handleSelectForm = useCallback((formId: FormId) => {
    setActiveForm(formId);
  }, []);

  // ════════════════════════════════════════════════════════════════════════════
  // CHARACTER_INTERACTION_VOICE_LOCK
  // Wires SpineViewer's character taps to the Standby voice.
  //
  // Flow:
  //   1. If already attacking or a standby is playing → ignore (no reentry)
  //   2. If a modal is open → ignore (don't bleed voice into the modal scene)
  //   3. If activity has ended → ignore
  //   4. Otherwise: set the lock, await playVoice(), release the lock
  //
  // The Promise from playVoice() is guaranteed to resolve — on 'end',
  // loaderror, playerror, autoplay-block, OR a hard 6s timeout. So we
  // never strand the UI even if a clip is missing/corrupt.
  // ════════════════════════════════════════════════════════════════════════════
  const handleCharacterClick = useCallback(async (stageIdx: number) => {
    // P0 2026-08-19: Triple-reentrant guard (Defense in Depth):
    //   1. standbyLockRef — React-level re-entrancy (synchronous, zero async overhead)
    //   2. isStandbyPlaying — React state (prevents stale renders from re-enabling)
    //   3. AudioManager.isVoiceLocked() — window-level singleton lock (definitive answer
    //      even if React state is stale or multiple module instances exist).
    // PRD rule: while any voice clip is playing, any subsequent click is a no-op.
    if (standbyLockRef.current) return;
    if (isAttacking || isStandbyPlaying) return;
    if (AudioManager.isVoiceLocked()) return;
    if (useModalStore.getState().page) return;
    if (activityStatus === 'ENDED') return;

    standbyLockRef.current = true;
    setIsStandbyPlaying(true);
    try {
      await AudioManager.playVoice(stageIdx, 'standby');
    } catch (err) {
      // playVoice() is contractually void-of-rejection, but the catch
      // keeps lints clean and prevents unhandled-rejection noise.
      console.warn('[BattleLayout] Standby voice rejected (should not happen):', err);
    } finally {
      standbyLockRef.current = false;
      setIsStandbyPlaying(false);
    }
  }, [isAttacking, isStandbyPlaying, activityStatus]);

  // ── Entry point handlers ─────────────────────────────────────────────────────
  const handleDailyTaskClick = (e: React.MouseEvent) => {
    handleModalOpen('task', e);
  };

  const handleProgressRewardClick = (e: React.MouseEvent) => {
    handleModalOpen('reward', e);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  // SSR-Safe: Prevent hydration mismatch by returning a static fallback until mounted
  if (!isMounted) {
    return <div className="fixed inset-0 bg-[#0A0A12] z-[9999]" />;
  }

  return (
    <>
      {activityStatus === 'LOADING' && (
        <LoadingScreen
          onComplete={handleLoadingComplete}
          onForceEnter={handleForceEnter}
          onTimeout={handleLoadingTimeout}
          // P1-43 HOTFIX: route the LoadingScreen's in-overlay back button
          // through the same safe handler TopNav uses (backUrl → main station
          // home). Without this prop, LoadingScreen falls back to its own
          // history.length check, which is acceptable but not project-wide.
          onBack={handleBackNavigation}
          isAssetLoaded={isSpineLoaded}
          isCanvasRendered={isCurrentModelRendered}
          isStage1Failed={isStage1Failed}
        />
      )}

      {/* ════════════════════════════════════════════════════════════════════════════
          TEMPORARY COSMIC NEBULA BACKGROUND — visible during loading gap
          ════════════════════════════════════════════════════════════════════════════ */}
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          backgroundColor: '#06040F',
          backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(155,92,255,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(255,45,135,0.12) 0%, transparent 40%)'
        }}
      />

      {/* ════════════════════════════════════════════════════════════════════════════
          CANVAS LAYER — fixed full-screen, z-10, above background.
          Character click detection is handled by the HTML Glass Plate
          (z-[5]) INSIDE SpineViewer — a transparent DOM overlay that
          captures pointer events via native browser DOM, bypassing PIXI
          hit testing entirely. No hitArea, no eventMode, no tint — just
          a plain div with onClick wired to handleCharacterClick.

          REPARK 6.0 (2026-08-18): Added opacity fade-in so that when
          assets are cached (IndexedDB hit → isReadyForLiveView flips true
          before LoadingScreen exits), the canvas smoothly transitions from
          opacity 0 → 1 instead of snapping from invisible to opaque,
          eliminating the white-flash artifact.

          P0 FALLBACK FIX: Now uses shouldShowBattleVisual so the container
          is visible during fallback/error states — allowing the silhouette
          fallback inside SpineViewer to render even when the real model
          has not yet rendered. Normal loading is still covered by LoadingScreen.
          ════════════════════════════════════════════════════════════════════════════ */}
      <div
        className="fixed inset-0 z-10 transition-opacity duration-400 ease-in"
        // P1-42 FIX: keep canvas composited (visibility:hidden) instead of opacity:0.
        // opacity:0 alone lets some browsers throttle WebGL rAF under fully-transparent
        // occluded layers, which stalled _triggerExplicitFirstFrame's double-rAF chain.
        // visibility:hidden still removes the canvas from hit-testing but the WebGL
        // context remains composited, so rAF fires reliably. POI.
        style={{
          opacity: shouldShowBattleVisual ? 1 : 0,
          visibility: shouldShowBattleVisual ? 'visible' : 'hidden',
        }}
      >
        <SpineViewer
          ref={spineViewerRef}
          onDamageShow={() => {}}
          onLoaded={handleSpineLoaded}
          onStage2Loaded={handleStage2Loaded}
          onStage3Loaded={handleStage3Loaded}
          onStage4Loaded={handleStage4Loaded}
          onCurrentModelRendered={handleCurrentModelRendered}
          hasSpineError={activityStatus === 'ERROR'}
          onFatalError={handleFatalSpineError}
          onStage1Retry={(attempt, max) => {
            // P1-41: clear fatal/error state so the retry renders fresh loading UI.
            setHasSpineError(false);
            setIsStage1Failed(false);
            console.log(
              `[BattleLayout] Stage 1 retry ${attempt}/${max} — fallback cleared, retry in progress…`,
            );
          }}
          currentForm={activeForm}
          onStageIdxChange={setActiveStageIdx}
          onCharacterClick={handleCharacterClick}
        />
        {/* ── BGM Controller — phase-aware music engine ───────────────── */}
        <BGMController activeStageIdx={activeStageIdx} />
      </div>

      {/* TASK 2: Left Character Intro Panel — glassmorphism info card */}
      <CharacterIntroPanel activeStageIdx={activeStageIdx} profile={characterProfile ?? undefined} />

      {/* ════════════════════════════════════════════════════════════════════════════
          UI SHELL — Absolute Pinning Protocol
          All regions are OUT of document flow: no flex-col, no h-[*vh].
          Pointer events cascade down to individual interactive leaves.

          Layer stack (z-index):
            z-[100]  — outer shell (pointer-events-none)
            z-[101]  — TopNav absolute band
            z-[102]  — HP bar absolute band
            z-[100]  — FormSelector (right-side, mid-anchored)
            z-[101]  — Bottom action console (above form selector)

          Safe area: pb-[env(safe-area-inset-bottom)] on bottom band
          so iPhone notch / home-indicator never clips attack buttons.
          ════════════════════════════════════════════════════════════════════════════ */}
      <div className="fixed inset-0 z-[100] pointer-events-none select-none">

        {/* ── Top Nav Band ──
            Pure absolute anchor — NO CSS scale.
            Pins to the ceiling, full width, compact internal padding. */}
        <div className="absolute top-0 left-0 right-0 z-50 pointer-events-auto px-4 sm:px-6 py-2 sm:py-3">
          <TopNav
            endTime={activityGateConfig.endTime ? new Date(activityGateConfig.endTime).getTime() : undefined}
            serverOffsetMs={serverOffsetMs}
            activityStatus={activityStatus}
            onOpenModal={handleModalOpen}
            onBack={handleBackNavigation}
          />
        </div>

        {/* ── HP Bar Band ──
            Pure absolute anchor — NO CSS scale.
            Fixed pixel values are safe under Fit/Contain because the model
            is centered and shrinks proportionally; it can never reach this band.
            Mobile: top-[80px]. Desktop: top-[100px] (slightly more clearance). */}
        <div
          className="absolute left-4 right-4 z-40"
          id="hp-bar-tweaker"
          style={{ top: `${UI_CONFIG.HP_BAR_TOP}px` }}
        >
          <StandardHPBar currentHp={displayedHp} maxHp={maxHp} milestones={dynamicHpMilestones} />
        </div>

        {/* ── Right Stage Panel ──
            Right-anchored, vertically centred on the viewport.
            Mobile: right-2 (tight to edge) + scale-50 (half size — same as before).
            Desktop: right-8 + scale-100. */}
        <div className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 z-40 pointer-events-auto">
          <FormSelectorWithLock
            activeForm={activeForm}
            unlockedForms={unlockedForms}
            onSelectForm={handleSelectForm}
            formConfigs={formConfigs}
            disabled={isAttacking || isStandbyPlaying}
          />
        </div>

        {/* ── Bottom Action Console ──
            2026-08-19 — Mobile Portrait 2-Column Layout:
              • Mobile/portrait (< sm) — two vertical columns:
                  LEFT:  [📅 每日任务] above [✋ 触碰 weapon]
                  RIGHT: [🏆 进度奖励] above [🦴 深入 weapon]
              • Desktop (≥ sm) — keeps the original centred weapon row with
                task/reward buttons on top, side-by-side.
            Pure absolute anchor — NO CSS scale.
            Pinned to floor with safe-area inset for iPhone home indicator. */}
        <div
          className="
            absolute bottom-0 left-0 right-0
            z-50 pointer-events-auto
            flex flex-col items-stretch
            gap-3
            px-4 sm:px-8
            pt-2 pb-6
            pb-[env(safe-area-inset-bottom)]
          "
        >
          {/* Mobile portrait: 2-column grid (md:hidden).
              Each column stacks a Task/Reward button on top of its weapon. */}
          <div className="md:hidden grid grid-cols-2 gap-6">
            {/* LEFT COLUMN — Daily task (top) + Hand weapon (bottom) */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={handleDailyTaskClick}
                className="flex items-center gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 rounded-xl bg-white/10 border border-white/20 backdrop-blur-xl hover:bg-white/15 active:scale-95 transition-all min-w-0"
                style={{ touchAction: 'manipulation' }}
              >
                <BreathingRedDot
                  color="#FFD060"
                  glow="rgba(255,208,96,0.6)"
                  active={hasClaimableTasks}
                />
                <CalendarDays size={12} className="text-purple-400 sm:w-[14px] sm:h-[14px]" />
                <span className="text-[10px] sm:text-[11px] font-semibold text-white/90 whitespace-nowrap">每日任务</span>
              </button>
              <div
                className="w-full flex justify-center"
                style={{ pointerEvents: isActivityLive ? 'auto' : 'none' }}
              >
                <WeaponBar
                  isAttacking={isAttacking || isStandbyPlaying}
                  inventory={inventory ?? { item_hand: 0, item_phallus: 0 }}
                  onAttack={handleAttack}
                  onInsufficient={() => { toast.error('道具不足，去完成任务获取', 3000); handleModalOpen('task'); }}
                  layout="split-left"
                />
              </div>
            </div>

            {/* RIGHT COLUMN — Progress reward (top) + Phallus weapon (bottom) */}
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={handleProgressRewardClick}
                className="flex items-center gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 rounded-xl bg-white/10 border border-white/20 backdrop-blur-xl hover:bg-white/15 active:scale-95 transition-all min-w-0"
                style={{ touchAction: 'manipulation' }}
              >
                <BreathingRedDot
                  color="#FF2D87"
                  glow="rgba(255,45,135,0.6)"
                  active={hasClaimableRewards}
                  phaseOffset={0.5}
                />
                <Trophy size={12} className="text-amber-400 sm:w-[14px] sm:h-[14px]" />
                <span className="text-[10px] sm:text-[11px] font-semibold text-white/90 whitespace-nowrap">进度奖励</span>
              </button>
              <div
                className="w-full flex justify-center"
                style={{ pointerEvents: isActivityLive ? 'auto' : 'none' }}
              >
                <WeaponBar
                  isAttacking={isAttacking || isStandbyPlaying}
                  inventory={inventory ?? { item_hand: 0, item_phallus: 0 }}
                  onAttack={handleAttack}
                  onInsufficient={() => { toast.error('道具不足，去完成任务获取', 3000); handleModalOpen('task'); }}
                  layout="split-right"
                />
              </div>
            </div>
          </div>

          {/* Desktop / wide (≥ md) — original centred layout. */}
          <div className="hidden md:flex flex-col items-stretch gap-3">
            {/* Task / Reward row — desktop: side-by-side; mobile: horizontal gap */}
            <div className="flex justify-between items-center gap-2">
              <button
                onClick={handleDailyTaskClick}
                className="flex items-center gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 rounded-xl bg-white/10 border border-white/20 backdrop-blur-xl hover:bg-white/15 active:scale-95 transition-all min-w-0"
                style={{ touchAction: 'manipulation' }}
              >
                <BreathingRedDot
                  color="#FFD060"
                  glow="rgba(255,208,96,0.6)"
                  active={hasClaimableTasks}
                />
                <CalendarDays size={12} className="text-purple-400 sm:w-[14px] sm:h-[14px]" />
                <span className="text-[10px] sm:text-[11px] font-semibold text-white/90 whitespace-nowrap">每日任务</span>
              </button>

              <button
                onClick={handleProgressRewardClick}
                className="flex items-center gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 rounded-xl bg-white/10 border border-white/20 backdrop-blur-xl hover:bg-white/15 active:scale-95 transition-all min-w-0"
                style={{ touchAction: 'manipulation' }}
              >
                <BreathingRedDot
                  color="#FF2D87"
                  glow="rgba(255,45,135,0.6)"
                  active={hasClaimableRewards}
                  phaseOffset={0.5}
                />
                <Trophy size={12} className="text-amber-400 sm:w-[14px] sm:h-[14px]" />
                <span className="text-[10px] sm:text-[11px] font-semibold text-white/90 whitespace-nowrap">进度奖励</span>
              </button>
            </div>

            {/* Attack Buttons — always full-width, always centred.
                TC-BT-14: pointer-events:none when activity has ended. */}
            <div
              className="w-full flex justify-center"
              style={{ pointerEvents: isActivityLive ? 'auto' : 'none' }}
            >
              <WeaponBar
                isAttacking={isAttacking || isStandbyPlaying}
                inventory={inventory ?? { item_hand: 0, item_phallus: 0 }}
                onAttack={handleAttack}
                onInsufficient={() => { toast.error('道具不足，去完成任务获取', 3000); handleModalOpen('task'); }}
                layout="center"
              />
            </div>
          </div>
        </div>

        {/* TC-BT-14: Activity End Page — mounted above all battle UI when expired.
            Modal entry points (Task / Progress Rewards) remain clickable below. */}
        <AnimatePresence>
          {activityStatus === 'ENDED' && (
            <ActivityEndPage
              onRewardClick={handleProgressRewardClick}
              onBack={handleBackNavigation}
            />
          )}
        </AnimatePresence>

        {/* ── Sub-Page Modal — AnimatePresence wraps the portal-rendered modal
            so framer-motion controls the exit lifecycle. Without this, motion.div
            animation resets on every parent re-render (visible flicker loop).
            key= must be on <SubPageModal>, NOT on <AnimatePresence>. ── */}
        <AnimatePresence>
          {modalPage && (
            <SubPageModal
              key={modalPage}
              page={modalPage}
              onClose={stableCloseModal}
              currentInventory={inventory}
              taskState={taskRedDots}
              taskConfig={taskConfig}
              onInventoryUpdate={stableSetInventory}
              onTaskClaimed={handleTaskClaimed}
              battleInit={battleInit}
              activityRules={activityRules}
            />
          )}
        </AnimatePresence>

        {/* ── Toast Container ── */}
        <ToastContainer />

        {/* ── CSS animations ── */}
        <style>{`
          @keyframes dotBreath {
            0%, 100% { opacity: 1; transform: scale(1); }
            50%       { opacity: 0.6; transform: scale(0.75); }
          }
        `}</style>
      </div>

      {activityStatus === 'NOT_STARTED' && (
        <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-[#050510]/95 backdrop-blur-sm px-6 text-center">
          <p className="text-white/60 text-sm tracking-[0.3em] mb-4">ACTIVITY LOCKED</p>
          <h2 className="text-white text-2xl font-semibold mb-2">活动尚未开始</h2>
          <p className="text-white/50 text-sm">当前为预热阶段，活动开启后将自动进入战斗界面。</p>
        </div>
      )}

      {/* P17-HOTFIX-2: Per Commander directive, "全局兜底状态" should NOT be
          a full-page overlay that replaces the entire battle UI. When Spine
          fails to initialize, SpineViewer itself already renders a silhouette
          placeholder + ambient pulse at the character position. The HUD
          (TopNav / HP bar / tabs / bottom action bar) MUST stay visible and
          interactive. We therefore remove the full-screen fallback mask and
          surface the error as a non-blocking toast at the top instead. */}
      {activityStatus === 'ERROR' && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[1100] pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-red-950/70 backdrop-blur-md border border-red-500/40 px-4 py-2 text-xs text-red-100 shadow-lg shadow-red-900/40">
            <span className="inline-block h-2 w-2 rounded-full bg-red-400 animate-pulse" />
            <span className="tracking-widest text-red-300">RESOURCE FALLBACK</span>
            <span className="text-red-100/80">|</span>
            <span>角色模型未加载，已切换为剪影模式</span>
          </div>
        </div>
      )}

      {/* ── Effect Layers (above UI, below modals) ── */}
      <FloatingDamageLayer />
      <ParticleLayer />
    </>
  );
}
