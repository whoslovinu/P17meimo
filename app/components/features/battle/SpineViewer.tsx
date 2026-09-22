'use client';

// spine-patch.ts must be imported BEFORE any spine-core or spine-pixi-v8 module
// so that Object.defineProperty runs before any class is instantiated.
import '@/lib/spine/spine-patch';

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import type { FormId } from './FormSelector';
import type { ActivityStatus } from './types';
import { AudioManager } from '@/app/lib/audio/AudioManager';
import { fetchWithTimeout } from '@/app/lib/fetchWithTimeout';
import { installAssetFetchInterceptor } from '@/app/lib/assetCache';
// V3 PHASE 1 — JSON/atlas acquisition flows through the shared resource loader.
// Spine pages (PNG textures) are still loaded via PIXI.Assets.load because they
// need a PIXI.Texture wrapper, not a raw Blob. The loader owns the network/IDB
// path; PIXI owns texture caching. Both reach the same bytes via the loader's
// single-flight guarantee — concurrent calls dedupe automatically.
import { ensure as ensureResource, normalizeUrl as normalizeResourceUrl, logDiagnosticsTable } from './battleResourceLoader';
import { shipBattleTrace } from './battleTraceShipper';
import { SuccubusSilhouette } from './SuccubusSilhouette';
import { shipDiag } from '@/app/lib/diagShipper';

// P0 2026-07-31: IndexedDB asset cache — install fetch interceptor at module load
// so the very first Assets.load() call (Stage 1 + BG + halo) is already covered.
// Idempotent: subsequent imports are no-ops.
installAssetFetchInterceptor();

// ════════════════════════════════════════════════════════════════════════════════
//  FORENSIC TRACE — STAGE 1 CHARACTER PIPELINE (P0 2026-08-26)
//  Every step S01-S21 is logged to console AND shipped to /api/diag/client-log
//  so the real failure point can be identified from server-side logs.
//  Payload is kept intentionally small: step + error name/message/stack + URLs.
//  ════════════════════════════════════════════════════════════════════════════════

/** Serialise any value to a JSON-safe string for diag transport. */
function traceVal(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** Fire-and-forget console.log + shipDiag. Never throws. */
function stage1Trace(prefix: string, data: Record<string, unknown>): void {
  const ts   = Date.now();
  const msg  = `[Stage1Trace][${prefix}] ${ts}`;
  try {
    console.log(msg, data);
    // shipDiag: (origin, level, msg, stack?)
    // Encode all data into the msg string so it survives single-line transport.
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      payload[k] = typeof v === 'function' ? '[function]' : v;
    }
    shipDiag('stage1-trace', 'info', `${msg} ${traceVal(payload)}`);
  } catch {
    // Shipper must never affect the trace.
  }
}

/** Structured FAIL event: logs + ships error details to server for PM2 capture. */
function stage1Fail(
  step: string,
  opts: {
    pageName?: string;
    url?: string;
    label?: string;
    err: unknown;
    extra?: Record<string, unknown>;
  },
): void {
  const err   = opts.err;
  const name  = err instanceof Error ? err.name    : 'Unknown';
  const msg   = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack   : undefined;
  const ts    = Date.now();
  const payload = {
    step,
    label:   opts.label   ?? '',
    pageName: opts.pageName ?? '',
    url:     opts.url      ?? '',
    errName:  name,
    errMsg:   msg,
    errStack: stack,
    ts,
    ...opts.extra,
  };
  try {
    console.error(`[Stage1Trace][FAIL] ${step} ts=${ts}`, payload);
    shipDiag('stage1-trace', 'error', `[Stage1Trace][FAIL] ${step} ts=${ts} ${traceVal(payload)}`);
  } catch {
    // Shipper must never affect the trace.
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  🎛️  COMMANDER'S DASHBOARD  —  All Tunable Knobs Live Here
// ════════════════════════════════════════════════════════════════════════════════
//  ┌──────────────────────────────────────────────────────────────────────────┐
//  │  FIT_SCALE_MULT   (currently: 1.5)  →  Zoom model in/out              │
//  │  PIVOT_OFFSET_PX  (currently: 400)   →  Lift/drop feet position        │
//  │  HALO_RATIO       (currently: 0.28)  →  Halo vertical offset from char  │
//  │  SCALE_RATIO      (currently: 0.68)  →  Base character scale ratio      │
//  └──────────────────────────────────────────────────────────────────────────┘
const COMMAND_CENTER = {
  CHARACTER: {
    SCALE_RATIO: 0.68,
    HALO_RATIO: 0.28,
  },
  VIEWPORT: {
    MAX_MOBILE_RATIO: 16 / 9,
    MIN_PC_RATIO: 4 / 3,
    ENFORCE_LETTERBOX: false,
  },
  // ── Fit/Contain Protocol (P0 2026-07-26) ───────────────────────────────────
  // Design reference: 1080×1920 (portrait mobile-first).
  // fitScale = min(W/DESIGN_W, H/DESIGN_H) — guarantees model is never cropped.
  // PIVOT_OFFSET_PX = pixel distance from spine pivot to feet at DESIGN_H=1920.
  // spine.y = viewportCenterY + PIVOT_OFFSET_PX × fitScale.
  DESIGN_W: 1080,
  DESIGN_H: 1920,
  FIT_SCALE_MULT: 1, // enlarge coefficient — Commander-adjustable
  PIVOT_OFFSET_PX: 1100, // spine pivot (center-bottom) to feet at design ref
} as const;

// ── Silhouette image path (same as LoadingScreen) ───────────────────────────────
const SILHOUETTE_PRIMARY   = '/meimo-silhouette.png';
const SILHOUETTE_FALLBACK  = '/spine/assets/boss/idle_1.png';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SpineViewerProps {
  onAnimationComplete?: (animationName: string) => void;
  onDamageShow?: (damage: number) => void;
  onLoaded?: () => void;
  onStage2Loaded?: () => void; // Stage 2 (awakening) done — kept for backwards compat
  onStage3Loaded?: () => void; // Stage 3 (flame) done
  onStage4Loaded?: () => void; // Stage 4 (shadow) done
  /**
   * P0 2026-08-20: fires once when the WebGL canvas has physically rendered the
   * FIRST FRAME of the current active stage (Stage 0 by default). This is the
   * only signal that guarantees the user sees a complete character — not just
   * assets in memory, but actual pixels on screen.
   * Wired into BattleLayout's isCurrentModelRendered dual gate.
   */
  onCurrentModelRendered?: () => void;
  hasSpineError?: boolean;
  onFatalError?: () => void;
  /** P1-41: fires when a Stage 1 load attempt fails and a retry is scheduled. */
  onStage1Retry?: (attemptNumber: number, maxAttempts: number) => void;
  activityStatus?: ActivityStatus;
  /** Exposes the live stage index to parent components (e.g. CharacterIntroPanel). */
  onStageIdxChange?: (idx: number) => void;
  /** State-driven form switching — maps directly to STAGE_REGISTRY indices:
   *    'initial'   → stageIdx 0
   *    'awakening' → stageIdx 1  ← THE ONLY morph trigger
   *    'flame'     → stageIdx 2  (placeholder)
   *    'shadow'    → stageIdx 3  (placeholder) */
  currentForm?: FormId;
  /**
   * CHARACTER_INTERACTION_VOICE_LOCK:
   * Fired when the user taps a character spine. The parent is expected
   * to play the stage-specific Standby voice and lock the WeaponBar
   * for the duration of the voice clip.
   */
  onCharacterClick?: (stageIdx: number) => void;
}

/** Lightweight surface of the actual Spine class from spine-pixi-v8. */
interface SpineHandle {
  anchor: { set: (x: number, y: number) => void } | undefined;
  width: number;
  scale: { set: (x: number, y?: number) => void } | { x: number; y: number };
  x: number;
  y: number;
  skeleton: {
    setSlotsToSetupPose(): void;
    updateWorldTransform(): void;
    data: { animations: readonly { name: string }[] };
  };
  state: {
    setAnimation(trackIndex: number, name: string, loop: boolean): unknown;
    clearTrack(trackIndex: number): void;
    setEmptyAnimation(trackIndex: number, mixDuration: number): unknown;
    addAnimation(trackIndex: number, name: string, loop: boolean, delay?: number): unknown;
    getCurrent(trackIndex: number): unknown;
    addListener(callback: (entry: SpineTrackEntry) => void): void;
    removeListener(callback: (entry: SpineTrackEntry) => void): void;
  };
  autoUpdate: boolean;
  update(dt: number): void;
  on(event: 'complete', handler: (entry: SpineTrackEntry) => void): void;
  on(event: 'hit', handler: () => void): void;
  data: { animations: readonly { name: string }[] };
}

interface SpineTrackEntry {
  animation: { name: string };
  addListener?(cb: (entry: SpineTrackEntry) => void): void;
  removeListener?(cb: (entry: SpineTrackEntry) => void): void;
}

// ════════════════════════════════════════════════════════════════════════════════
// A1 — STAGE REGISTRY: Future-Proof Plug & Play Pipeline
//   1. Create its folder under /public/H501/ (e.g. idle_05/)
//   2. Add an entry here with id, path, idle animation name, and optional Y offset
//   3. No other code changes needed — the preloader, transition, and visibility
//      systems iterate the registry automatically.
//
// Stage 0 = initial (Stage 1, always loaded synchronously in initSpine)
// Stages 1-3 = additional (loaded lazily by preloadAdditionalStages)
//
// Form-to-stage mapping mirrors FormSelector.tsx:
//   'initial'    → STAGE_REGISTRY[0]
//   'awakening'  → STAGE_REGISTRY[1]
//   'flame'      → STAGE_REGISTRY[2]
//   'shadow'     → STAGE_REGISTRY[3]

// ════════════════════════════════════════════════════════════════════════════════
// COMMAND CENTER — STAGE Y-OFFSET SSOT
// ════════════════════════════════════════════════════════════════════════════════
//
// SINGLE SOURCE OF TRUTH for per-stage character Y offsets inside ROOT_CONTAINER.
// Negative values lift the model higher on screen. Tune these numbers to align
// each stage's character pose with the persistent aura halo position.
//
// To re-align stages 1/2: edit values 1 and 2.
// To nudge stage 3 up/down: edit value 3 (current = -100 to keep her head near halo).
// To lift stage 4 (shadow form) to match stages 1/2: edit value 4.
//
// Units are in PIXEL SPACE — they get multiplied by `charScale` (~0.164) at render.
// So a change of -2700 here equals ~443px on a 1080p display.
//
export const SPINE_STAGE_Y_OFFSETS = {
  1: 0,       // Stage 1 — baseline form, no offset needed
  2: -1150,   // Stage 2 — morphs from stage 1; lifts to keep feet on floor line
  3: -2500,    // Stage 3 — sitting/flame form; small lift to keep head near halo
  4: -2500,   // Stage 4 — shadow form; large lift to align with stages 1/2
} as const;

// ════════════════════════════════════════════════════════════════════════════════
// HALO ANCHOR STRATEGY — SINGLE SSOT FUNCTION
// ════════════════════════════════════════════════════════════════════════════════
//
// All halo transforms (y and scale) are computed by applyHaloTransform().
// No intermediate storage in haloBaseYRef — each caller recomputes from live charY/charScale.
// Formula: halo.y = charY + (HALO_BASE_OFFSET_PIXI + stageOffset) * (charScale/baseCharScale)
//          halo.scale = charScale * HALO_SCALE_RATIO
//
// Stage 1 and Stage 2 SHARE the same halo position ("Base Position"): the halo
// sits where it was at first paint, regardless of how much the underlying
// character has been lifted. This makes the aura feel like a stable "stage
// prop" that does not move when the model morphs.
//
// Stage 3 and Stage 4 SHARE the same halo position ("Advanced Position"):
// when the character enters a stronger form, the halo drops a fixed amount
// so it visually re-centers on the new pose's torso.
//
// Edit the two constants below to retune the absolute halo placement.
//
export const HALO_STAGE_Y_OFFSETS = {
  1: 0,        // Stage 1 — Base Position (default halo Y)
  2: 0,        // Stage 2 — Base Position (identical to Stage 1 by design)
  3: -400,     // Stage 3 — Advanced Position (drop halo by 460px)
  4: -450,     // Stage 4 — Advanced Position (identical to Stage 3 by design)
} as const;

const getStageHaloYOffset = (stageIdx: number): number => {
  // 1-based mapping into HALO_STAGE_Y_OFFSETS (key 1 = stageIdx 0)
  const key = (stageIdx + 1) as 1 | 2 | 3 | 4;
  return HALO_STAGE_Y_OFFSETS[key] ?? 0;
};

// Character Y offset is now read directly from STAGE_REGISTRY (which is
// built from SPINE_STAGE_Y_OFFSETS above). The earlier helper was retired
// when the halo anchor was decoupled from the character's stage offset.

const STAGE_REGISTRY = [
  {
    id:       'initial',
    path:     '/H501/idle_01/',
    jsonName: 'idle_1',
    atlasName:'idle_1',
    idle:     'idle_1',
    yOffset:  SPINE_STAGE_Y_OFFSETS[1],
  },
  {
    id:       'awakening',
    path:     '/H501/idle_02/',
    jsonName: 'idle_2',
    atlasName:'idle_2',
    idle:     'idle',
    yOffset:  SPINE_STAGE_Y_OFFSETS[2],
  },
  {
    id:       'flame',
    path:     '/H501/idle_03/',
    jsonName: 'idle_3',
    atlasName:'idle_3',
    idle:     'idle',
    yOffset:  SPINE_STAGE_Y_OFFSETS[3],
  },
  {
    id:       'shadow',
    path:     '/H501/idle_04/',
    jsonName: 'idle_4',
    atlasName:'idle_4',
    idle:     'idle',       // Verified from idle_4.json at line 54559: "idle": {
    yOffset:  SPINE_STAGE_Y_OFFSETS[4],
  },
] as const;

// ── Character authored dimensions (Height 3495) ────────────────────────────────
const CHARACTER_HEIGHT = 3495;

// ── Halo scale ratio (FIX P0 2026-07-31) ────────────────────────────────────
// HALO_SCALE_RATIO = local scale applied inside mainContainer.
// Combined world scale = charScale × HALO_SCALE_RATIO = proportional to model.
export const HALO_SCALE_RATIO = 1.5;

// ── Scale-invariant halo Y base offset (FIX P0 2026-07-31) ──────────────────
// Halo Y = charY + (this offset * charScale/baseCharScale).
// Derived from old formula at design reference (fitScale=1):
//   charY = 1920/2 + 1100*1 = 2060
//   old haloY = charY - (0.28 * 1920) = 2060 - 537.6 = 1522.4
//   → baseOffset = haloY - charY = -537.6 at fitScale=1
// At any other fitScale: haloY = charY + (-537.6) * (charScale/baseCharScale)
// The constant is stored in PIXI space (before charScale multiplication).
export const HALO_BASE_OFFSET_PIXI = -500; // calibrated for design ref height 1920

// ── Residual Slot Definitions ──────────────────────────────────────────────────
const RESIDUAL_SLOTS = new Set([
  'boob_catch_hand_L',
  'boob_catch_hand_R',
  'catch_hand_R',
  'catch_hand_R2',
]);

// ── Halo version (bump this string whenever halo assets are updated to force cache refresh) ─
// 2026-06-02: New corrected halo deployed from H5 000/H501/character_halo/
const HALO_VERSION = 'v2.0.0'; // ← bump on every halo re-export

// ── Asset paths (season2 — 1.0x clean assets) ────────────────────────────────
const ASSETS = {
  bg: {
    json:  `/H501/BG/BG.json`,
    atlas: `/H501/BG/BG.atlas`,
  },
  halo: {
    json:  `/H501/character_halo/halo.json?v=${HALO_VERSION}`,
    atlas: `/H501/character_halo/halo.atlas?v=${HALO_VERSION}`,
  },
} as const;

// ════════════════════════════════════════════════════════════════════════════════
// P1-41 FIX (REWORK): Stage 1 Character Load Retry State Machine
// FAILURE IS NOT AN END STATE — system retries with exponential backoff.
// MAX 3 retries. Successful load clears all fallback state.
//
// INSTANCE-ISOLATED: counter + timer live in useRef, NOT module-level.
// StrictMode / multi-instance / remount all start fresh.
// ════════════════════════════════════════════════════════════════════════════════
const STAGE1_RETRY_MAX         = 3;
const STAGE1_RETRY_BASE_MS     = 2000; // doubles each attempt: 2s → 4s → 8s

// Module-level state intentionally removed — see useRef stage1RetryCountRef
// in SpineViewerInner. Keeping a module-level ref would corrupt counters
// across StrictMode mount/unmount/mount and across multiple instances.
// Using a module-level Map so the same object reference is returned every call.
// This guarantees addListener() never accumulates duplicate handlers across renders.
// Safe for SSR: the Map is keyed by stageIdx; cleanup always runs on unmount.
// ════════════════════════════════════════════════════════════════════════════════
const _stageListenerCache = new Map<number, { complete: (entry: any) => void }>();

// ════════════════════════════════════════════════════════════════════════════════
// SpineViewerInner
// ════════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════════════════
// SpineViewer — Zero-Latency Attack Ref Interface
//
// Exposes:
//   - triggerAttack(damage?, weaponType?) → fires IMMEDIATELY on pointer-down
//   - forceResetAllModels()
//
// The actual WeaponBar calls this via spineViewerRef.current.triggerAttack()
// ════════════════════════════════════════════════════════════════════════════════════════

export interface SpineViewerRef {
  triggerAttack: (damage?: number, weaponType?: 'a' | 'b') => Promise<void>;
  /** Returns true if an attack can be triggered (not locked). */
  canTrigger: () => boolean;
  forceResetAllModels: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
// SpineViewer with display name for React DevTools
const _SpineViewerWithDisplayName = forwardRef<SpineViewerRef, SpineViewerProps>(
  ({ onAnimationComplete: _onAnimationComplete, onDamageShow: _onDamageShow, onLoaded, onStage2Loaded, onStage3Loaded, onStage4Loaded, onCurrentModelRendered, onStageIdxChange, hasSpineError = false, onFatalError, onStage1Retry, currentForm = 'initial', onCharacterClick }, ref) => {
  const containerRef  = useRef<HTMLDivElement>(null);
  const appRef       = useRef<any>(null);

  // A3: Unified indexed spine array — stageIdx 0..3
  // stageIdx 0 = Stage 1 (always loaded), stageIdx 1..3 = lazy-loaded
  const spinesRef    = useRef<(SpineHandle | undefined)[]>([]);

  // FIX P-03: Store injected listener references for guaranteed removeListener on cleanup.
  // Each entry corresponds to STAGE_REGISTRY[stageIdx].state.
  const stageListenerRefs = useRef<(SpineTrackEntry | undefined)[]>([]);

  const bgRef        = useRef<SpineHandle | undefined>(undefined);
  const haloRef      = useRef<SpineHandle | undefined>(undefined);
  // SSOT: holds only the viewport-relative halo baseline before any stage-local offsets.
  // Final render Y is always derived via:
  //   halo.y = haloBaseYRef.current + HALO_STAGE_Y_OFFSETS[activeStageIdx]
  // This keeps the halo anchor independent of the character's Y offset, so
  // tuning SPINE_STAGE_Y_OFFSETS will not move the halo.
  const haloBaseYRef = useRef<number>(0);

  // ── HALO TRANSFORM SSOT (FIX P0 2026-07-31) ─────────────────────────────────────
  // Single source of truth for ALL halo position and scale calculations.
  // Called by: transitionToForm, handleResize, safelySyncHaloTransform.
  // No other code path may write halo.y or halo.scale.
  //
  // Formula:
  //   halo.y    = charY + (HALO_BASE_OFFSET_PIXI + stageOffset) * (charScale/baseCharScale)
  //   halo.scale = charScale * HALO_SCALE_RATIO
  //
  // stageIdx: 0-based (Stage 1 = 0, Stage 2 = 1, etc.)
  const applyHaloTransform = (halo: any, charY: number, charScale: number, baseCharScale: number, stageIdx: number) => {
    const stageOffset = getStageHaloYOffset(stageIdx);
    const totalOffset = (HALO_BASE_OFFSET_PIXI + stageOffset) * (charScale / (baseCharScale || 1));
    halo.y = charY + totalOffset;
    halo.scale.set(charScale * HALO_SCALE_RATIO);
  };

  // ── safelySyncHaloTransform — DELEGATES to applyHaloTransform ────────────────────
  // REPARK 6.0 — Spine_Fidelity_And_Halo_Sync_Safe_Fix
  // SAFETY: NEVER throws. NEVER calls setHasSpineError(). Only logs warnings.
  const safelySyncHaloTransform = () => {
    try {
      const halo = haloRef.current;
      if (!halo) return;
      const baseCharScale = (COMMAND_CENTER.DESIGN_H * COMMAND_CENTER.CHARACTER.SCALE_RATIO) / CHARACTER_HEIGHT;
      const fitScale = Math.min(window.innerWidth / COMMAND_CENTER.DESIGN_W, window.innerHeight / COMMAND_CENTER.DESIGN_H);
      const charScale = baseCharScale * fitScale * COMMAND_CENTER.FIT_SCALE_MULT;
      const charY = (window.innerHeight / 2) + (COMMAND_CENTER.PIVOT_OFFSET_PX * fitScale);
      applyHaloTransform(halo, charY, charScale, baseCharScale, activeStageIdxRef.current);
    } catch (err) {
      console.warn('[SpineViewer] safelySyncHaloTransform skipped:', err);
    }
  };

  const hitEffectRef      = useRef(false);
  const handleResizeRef   = useRef<(() => void) | null>(null);
  const targetScaleRef    = useRef<number>(0.5);
  const resizeRafRef      = useRef<number | null>(null);
  const rafRef            = useRef<number>(0);
  const isInitializingRef = useRef(false);
  const animationLockRef = useRef(false);
  const mainContainerRef = useRef<any>(null);
  const rootContainerRef = useRef<any>(null);
  const shakeRafRef       = useRef<number | null>(null);
  // P0 2026-08-25: one-shot guard — prevents double-firing onCurrentModelRendered
  const firstVisibleFrameReportedRef = useRef(false);
  // P0 2026-08-26: tracks double-RAF ID for explicit first-frame gate cleanup
  const firstFrameRafRef = useRef<number>(0);
  const firstFrameWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const FIRST_FRAME_WATCHDOG_MS = 1500;

  // ── P1-41 REWORK: instance-local retry state ───────────────────────────────
  // Stage 1 retry counter — INSTANCE-LOCAL, fresh per mount.
  // Reset in cleanup so re-mount starts at 0.
  const stage1RetryCountRef = useRef<number>(0);
  // Active retry timer handle — must be cancelled on unmount or before re-schedule.
  // null when no retry pending.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lock against concurrent schedule — true while a retry timer is live.
  // Prevents two failure callbacks (e.g. init catch + first-frame null) from
  // double-scheduling when they fire in the same tick.
  const retryInFlightRef = useRef<boolean>(false);

  // ── A4: Unified transition ref — single function for all morph/demorph ─────────
  const transitionToFormRef = useRef<((targetStageIdx: number) => void) | null>(null);

  // Global listener resolve
  const resolveAttackRef   = useRef<(() => void) | null>(null);
  const idleToRestoreRef   = useRef<string>('idle_1');

  // ── resetToIdlePose — authoritative skeleton + slots reset before idle animation ──
  // REPARK 6.0 — P0 2026-07-31: Unified reset for attack-complete / forceReset / transition.
  // Declared early so callbacks below can reference it without TDZ errors.
  const resetToIdlePose = (spine: SpineHandle, idleAnim: string) => {
    const skel = (spine as any).skeleton;
    if (!skel) return;
    (spine.state as any).clearTracks?.();
    skel.setToSetupPose?.();
    skel.setSlotsToSetupPose?.();
    spine.state.setAnimation(0, idleAnim, true);
    eradicateResidualSlots(spine, 'resetToIdlePose');
  };

  // P0 2026-08-26: BATTLE MINIMUM READY FIX
  // `engineReady` stays — pre-warm effect and form-switch effect gate on it.
  // `stage1Ready` is the new character-ready gate — set only when characterSpine !== null.
  const [engineReady, setEngineReady] = useState(false);
  const [stage1Ready, setStage1Ready] = useState(false);

  // A2: Stage index — 0|1|2|3 = stable idle; 'morphing' = mid-transition
  const [activeStageIdx, setActiveStageIdx] = useState<number>(0);
  // SSOT companion: allows non-reactive closures (handleResize) to read the live
  // stage index without stale-closure bugs. Kept in sync via the useEffect below.
  const activeStageIdxRef = useRef<number>(0);

  // SSOT sync: keep the companion ref in lock-step with the live state.
  // This guarantees handleResize always reads the current stage, not a stale closure.
  useEffect(() => { activeStageIdxRef.current = activeStageIdx; }, [activeStageIdx]);

  // ── P1-43 FINAL: Independent recovery signals ──────────────────────────────
  // The original visibilitychange handler re-triggered the rAF/watchdog chain
  // only when document.visibilityState flipped to 'visible'. Mobile WebViews
  // (WeChat, in-app browsers, iOS PWA) commonly report visibilityState='hidden'
  // for the entire session, so visibility-based recovery is unreliable.
  //
  // Real recovery signals that fire REGARDLESS of document.visibilityState:
  //   1. window 'focus'            — user / OS focuses the window
  //   2. window 'pageshow'         — page becomes current in history
  //   3. user pointer events       — pointerdown / touchstart / click fire
  //                                   even when document.hidden=true (the user
  //                                   is literally tapping the screen)
  //   4. Pixi ticker callback      — fires on next rAF tick; ticker is
  //                                   independent of visibilityState in the
  //                                   sense that add() registers regardless
  //                                   and fires the next time the browser
  //                                   ticks (even if throttled, eventually
  //                                   fires)
  //
  // Each handler calls the idempotent requestFirstFrameRecovery(source)
  // which calls app.render() synchronously and confirms the first frame
  // when character + renderer + stage are all valid.
  const requestFirstFrameRecoveryRef = useRef<((source: string) => void) | null>(null);
  useEffect(() => {
    const tryRecover = (source: string) => {
      const fn = requestFirstFrameRecoveryRef.current;
      if (!fn) return;
      try { fn(source); } catch { /* swallow */ }
    };

    const handleVisibilityChange = () => {
      if (!appRef.current) return;
      if (document.hidden) {
        appRef.current.ticker.stop();
      } else {
        appRef.current.ticker.start();
        if (appRef.current.ticker.maxElapsedMS !== undefined) {
          appRef.current.ticker.maxElapsedMS = 32;
        }
        tryRecover('visibilitychange');
      }
    };
    const handleWindowFocus = () => tryRecover('focus');
    const handleWindowPageshow = () => tryRecover('pageshow');
    const handlePointerDown = () => tryRecover('pointerdown');
    const handleTouchStart = () => tryRecover('touchstart');
    const handleClick = () => tryRecover('click');

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pageshow', handleWindowPageshow);
    // pointerdown + touchstart capture even when document.hidden=true — the
    // browser still dispatches them on the user's actual touch.
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    document.addEventListener('click', handleClick, { capture: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handleWindowPageshow);
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true } as any);
      document.removeEventListener('touchstart', handleTouchStart, { capture: true, passive: true } as any);
      document.removeEventListener('click', handleClick, { capture: true } as any);
    };
  }, []);

  // Stable callback refs
  const onLoadedRef            = useRef(onLoaded);
  const onStage2LoadedRef      = useRef(onStage2Loaded);
  const onStage3LoadedRef      = useRef(onStage3Loaded);
  const onStage4LoadedRef      = useRef(onStage4Loaded);
  const onStageIdxChangeRef    = useRef(onStageIdxChange);
  const onFatalErrorRef        = useRef(onFatalError);
  const onCurrentModelRenderedRef = useRef(onCurrentModelRendered);
  const onStage1RetryRef      = useRef(onStage1Retry); // P1-41
  onLoadedRef.current            = onLoaded;
  onStage2LoadedRef.current      = onStage2Loaded;
  onStage3LoadedRef.current      = onStage3Loaded;
  onStage4LoadedRef.current      = onStage4Loaded;
  onStageIdxChangeRef.current    = onStageIdxChange;
  onFatalErrorRef.current        = onFatalError;
  onCurrentModelRenderedRef.current = onCurrentModelRendered;
  onStage1RetryRef.current       = onStage1Retry; // P1-41

  // ── TASK 3: Notify parent whenever the active stage index changes ──────────
  useEffect(() => {
    onStageIdxChangeRef.current?.(activeStageIdx);
  }, [activeStageIdx]);

  // ── Screen Shake: Damped Harmonic Oscillator ─────────────────────────────────
  const shake = useCallback((magnitude: number = 4) => {
    if (!mainContainerRef.current) return;
    const shakeDuration = 250;
    const startTime = performance.now();
    const frequency = 20;
    const origX = mainContainerRef.current.position.x;
    const origY = mainContainerRef.current.position.y;
    const animateShake = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      if (elapsed >= shakeDuration) {
        mainContainerRef.current!.position.set(origX, origY);
        return;
      }
      const lambda = 12;
      const progress = elapsed / 1000;
      const decay = Math.exp(-lambda * progress);
      const oscillation = Math.sin(2 * Math.PI * frequency * progress);
      const jitterX = oscillation * magnitude * decay * 0.5;
      const jitterY = oscillation * magnitude * decay * 0.3;
      mainContainerRef.current!.position.set(origX + jitterX, origY + jitterY);
      shakeRafRef.current = requestAnimationFrame(animateShake);
    };
    if (shakeRafRef.current) cancelAnimationFrame(shakeRafRef.current);
    shakeRafRef.current = requestAnimationFrame(animateShake);
  }, []);

  // ── Chromatic Aberration ─────────────────────────────────────────────────────
  const applyChromaticAberration = useCallback((isDeep: boolean = false) => {
    if (!isDeep || !containerRef.current) return;
    containerRef.current.style.filter = 'contrast(1.2) saturate(1.15) brightness(1.05)';
    setTimeout(() => { if (containerRef.current) containerRef.current.style.filter = ''; }, 100);
  }, []);

  // ── Residual Slot Supervisor ─────────────────────────────────────────────────
  const restoreResidualSlots = useCallback((char: SpineHandle) => {
    const skel = (char as any).skeleton;
    if (!skel?.slots) return;
    for (const slot of skel.slots) {
      if (RESIDUAL_SLOTS.has(slot.data?.name)) {
        // Direct property assignment — see comment at line ~427 for why
        try { (slot as any).attachment = slot.data?.attachmentName ?? null; } catch { /* ignore */ }
        slot.color?.set(1, 1, 1, 1);
      }
    }
  }, []);

  const eradicateResidualSlots = useCallback((char: SpineHandle, reason?: string) => {
    const skel = (char as any).skeleton;
    if (!skel?.slots) return;
    const hidden: string[] = [];
    for (const slot of skel.slots) {
      if (RESIDUAL_SLOTS.has(slot.data?.name)) {
        // Direct property assignment instead of setAttachment() to avoid a
        // Spine-pixi-v8 bug where Slot.setAttachment() internally calls
        // this.getAttachment() which doesn't exist in the pixi runtime.
        try { (slot as any).attachment = null; } catch { /* ignore */ }
        slot.color?.set(0, 0, 0, 0);
        (slot as any).setToSetupPose?.();
        hidden.push(slot.data?.name);
      }
    }
    if (hidden.length) {
      console.debug(`[eradicate] ${reason ?? '?'} hidden:`, hidden);
    }
    // Log ALL currently-attached slot names — guarded so it NEVER breaks init
    try {
      const attached = (skel.slots as any[])
        .filter((s) => { try { return (s as any).attachment != null; } catch { return false; } })
        .map((s) => { try { return (s as any).data?.name; } catch { return '?'; } });
      if (attached.length) {
        console.debug(`[eradicate] ${reason ?? '?'} still-attached:`, attached);
      }
    } catch { /* never break init */ }
    try {
      if ((skel as any).physics) { skel.updateWorldTransform?.(); } else { (skel as any).updateCache?.(); }
    } catch { (skel as any).updateCache?.(); }
  }, []);

  // ── A5: triggerAttack — Universal: picks active skeleton by activeStageIdx ──────
  // FIX T5: Read activeStageIdx from a ref instead of closure state.
  // Previously, activeStageIdx was in the dependency array, causing the global
  // window.triggerSpineAttack to re-bind on every form switch. Now it reads the
  // live value from activeStageIdxRef, so the effect only runs once on mount.
  const triggerAttack = useCallback((damage?: number, weaponType: 'a' | 'b' = 'a'): Promise<void> => {
    // Use ref for live value — avoids stale closure and eliminates
    // activeStageIdx from dependency array → no more re-bind on form switch.
    const stageIdx = activeStageIdxRef.current;
    const char = spinesRef.current[stageIdx];
    if (!char) return Promise.resolve();

    const stageInfo = STAGE_REGISTRY[stageIdx];

    if (animationLockRef.current) {
      return Promise.resolve();
    }
    animationLockRef.current = true;

    // Build animation name from registry + weapon type
    // TASK 3: Stage 3 (flame) swaps weapon-to-motion mapping:
    //   Standard:  Weapon A → attack_a, Weapon B → attack_b
    //   Stage 3:   Weapon A → attack_b, Weapon B → attack_a
    const attackKey = stageIdx === 2
      ? (weaponType === 'b' ? 'attack_a' : 'attack_b')
      : (weaponType === 'b' ? 'attack_b' : 'attack_a');
    const stagePrefix = stageIdx === 0 ? '_1' : '';
    const animName = `${attackKey}${stagePrefix}`;
    const idleAnim = stageInfo.idle;
    idleToRestoreRef.current = idleAnim;

    const available = char.skeleton?.data?.animations?.map((a: { name: string }) => a.name) ?? [];
    if (!available.includes(animName)) {
      console.warn(`[Spine] Animation "${animName}" not found in Stage ${stageIdx}. Available:`, available);
      animationLockRef.current = false;
      if (containerRef.current) {
        const flash = document.createElement('div');
        flash.style.cssText = [
          'position:absolute;inset:0;pointer-events:none;z-index:60;',
          'background:radial-gradient(circle,rgba(255,45,135,0.55) 0%,rgba(200,20,100,0.3) 40%,transparent 70%);',
          'animation:spineFallbackFlash 0.45s ease-out forwards;',
        ].join('');
        containerRef.current.appendChild(flash);
        setTimeout(() => flash.remove(), 500);
        containerRef.current.style.boxShadow = '0 0 40px #FF2D87, 0 0 80px #FF2D87, inset 0 0 20px #FF2D8740';
        containerRef.current.style.transition  = 'box-shadow 0.05s';
        containerRef.current.style.animation    = 'spineFallbackShake 0.45s ease-out';
        setTimeout(() => {
          if (containerRef.current) { containerRef.current.style.boxShadow = ''; containerRef.current.style.animation = ''; }
        }, 500);
      }
      return Promise.resolve();
    }

    // NOTE: restoreResidualSlots intentionally NOT called here.
    // If we previously called eradicateResidualSlots (e.g. from a failed attack
    // that was caught in the outer try/catch), calling restoreResidualSlots
    // would re-activate the hand-slot attachments and cause the residual flash.
    // We simply hold the attack and return — the next successful attack will
    // restore slots on its own normal path.

    if (animationLockRef.current) {
      const track1Entry = (char.state as any).getCurrent?.(1);
      if (!track1Entry) {
        console.warn('[Spine] Stale lock detected, forcing recovery.');
        animationLockRef.current = false;
      } else {
        return Promise.resolve();
      }
    }
    animationLockRef.current = true;

    return new Promise<void>((resolve) => {
      resolveAttackRef.current = resolve;
      char.state.setAnimation(1, animName, false);
      // TASK 3: Play attack voice for the current stage + weapon.
      // playVoice() now returns a Promise that resolves on the audio's
      // onend event. The attack animation lock is released by the global
      // Spine 'complete' listener (line ~650), NOT by this promise — so
      // we fire-and-forget here. A stray rejection cannot occur because
      // playVoice always resolves, but we attach .catch() defensively.
      AudioManager.playVoice(stageIdx, weaponType === 'a' ? 'attack_a' : 'attack_b')
        .catch(() => undefined);
      const shakeMagnitude = damage ? Math.min(3 + damage * 0.15, 8) : 4;
      shake(shakeMagnitude);
      applyChromaticAberration(weaponType === 'b');
    });
  }, [shake, applyChromaticAberration, eradicateResidualSlots, restoreResidualSlots]);

  // ── Hit Feedback ─────────────────────────────────────────────────────────────
  const triggerHitFeedback = useCallback((damage: number, weaponType: 'a' | 'b' = 'a') => {
    if (containerRef.current) {
      const brightness = weaponType === 'a' ? '1.3' : '1.5';
      containerRef.current.style.transition = 'filter 0.08s ease-out';
      containerRef.current.style.filter = `brightness(${brightness})`;
      setTimeout(() => { if (containerRef.current) containerRef.current.style.filter = ''; }, 120);
    }
    const magnitude = damage ? Math.min(3 + damage * 0.15, 8) : 4;
    shake(magnitude);
    applyChromaticAberration(weaponType === 'b');
  }, [shake, applyChromaticAberration]);

  // ── Form Switch Flash ───────────────────────────────────────────────────────
  const triggerFormSwitchFlash = useCallback(() => {
    if (!containerRef.current) return;
    containerRef.current.style.transition = 'filter 0.05s ease-out';
    containerRef.current.style.filter = 'brightness(1.5)';
    setTimeout(() => { if (containerRef.current) containerRef.current.style.filter = ''; }, 300);
  }, []);

  // ── A4: Unified transitionToForm — replaces performMorph + performDemorph ───────
  const transitionToForm = useCallback((targetStageIdx: number) => {
    const currentIdx = activeStageIdx;

    // No-op: already in target stage
    if (currentIdx === targetStageIdx) return;

    // Guard: morphing in progress
    if (currentIdx === -1) return;

    const _fromStage = STAGE_REGISTRY[currentIdx];
    const toStage   = STAGE_REGISTRY[targetStageIdx];

    // ── HALO SNAP — DELEGATES to applyHaloTransform SSOT (FIX P0 2026-07-31) ──────
    // No intermediate haloBaseYRef — applyHaloTransform computes halo.y directly.
    const currentCharY = rootContainerRef.current?.y ?? 0;
    const currentCharScale = targetScaleRef.current ?? 0;
    const _baseCharScale = (COMMAND_CENTER.DESIGN_H * COMMAND_CENTER.CHARACTER.SCALE_RATIO) / CHARACTER_HEIGHT;
    if (haloRef.current) {
      applyHaloTransform(haloRef.current, currentCharY, currentCharScale, _baseCharScale, targetStageIdx);
    }

    triggerFormSwitchFlash();

    // Snapshot all character spines
    const allSpines = spinesRef.current;

    const CROSSFADE_DURATION = 500;
    const start = performance.now();

    const fadeStep = (timestamp: number) => {
      const elapsed = timestamp - start;
      const t = Math.min(elapsed / CROSSFADE_DURATION, 1);
      const eased = 1 - Math.pow(1 - t, 2); // ease-out quad

      // Fade OUT the source stage
      const fromSpine = allSpines[currentIdx];
      if (fromSpine) {
        (fromSpine as any).alpha = 1 - eased;
        (fromSpine as any).visible = true;
      }

      // Fade IN the target stage
      const toSpine = allSpines[targetStageIdx];
      if (toSpine) {
        (toSpine as any).alpha   = eased;
        (toSpine as any).visible = true;
      }

      if (t < 1) {
        requestAnimationFrame(fadeStep);
      } else {
        // Cross-fade complete:
        // 1. Source: fully invisible
        if (fromSpine) {
          (fromSpine as any).alpha   = 0;
          (fromSpine as any).visible = false;
        }
        // 2. Target: fully visible, start idle
        // NOTE: scale is NOT set here. All scale authority belongs exclusively to
        // rootContainer (charScale) + the visibility watcher (which sets scale=1).
        // Double-writing scale here caused a brief flicker and overrode rootContainer inheritance.
        if (toSpine) {
          (toSpine as any).alpha   = 1;
          (toSpine as any).visible = true;

          // REPARK 6.0 — P1: same fix as attack-complete path above.
          // Use tiny mix (0.1s) instead of instant-empty + setupPose so
          // the new stage's idle starts from the blended result rather
          // than a hard snap to setup-pose.
          (toSpine as any).state?.setEmptyAnimation?.(1, 0.1);

          // Start idle animation for target stage — use resetToIdlePose
          // to ensure setSlotsToSetupPose clears all attachment keyframes.
          const availAnim = (toSpine as any).skeleton?.data?.animations?.map((a: { name: string }) => a.name) ?? [];
          const idleAnim  = availAnim.includes(toStage.idle) ? toStage.idle : (availAnim[0] ?? '');
          if (idleAnim) resetToIdlePose(toSpine as unknown as SpineHandle, idleAnim);
        }

        setActiveStageIdx(targetStageIdx);
        onStageIdxChange?.(targetStageIdx);

        // ── safelySyncHaloTransform — NON-BREAKING proportional sync ──────────────
        // REPARK 6.0 — Spine_Fidelity_And_Halo_Sync_Safe_Fix
        // SAFETY: function-level try-catch above; NEVER throws setHasSpineError().
        safelySyncHaloTransform();
      }
    };

    requestAnimationFrame(fadeStep);
  }, [activeStageIdx, triggerFormSwitchFlash, eradicateResidualSlots, resetToIdlePose]);

  // Wire refs immediately
  transitionToFormRef.current = transitionToForm;

  // ── Force Reset All Models ───────────────────────────────────────────────────
  const forceResetAllModels = useCallback(() => {
    for (let i = 0; i < STAGE_REGISTRY.length; i++) {
      const spine = spinesRef.current[i];
      if (!spine) continue;
      const skel = (spine as any).skeleton;
      const stageInfo = STAGE_REGISTRY[i];
      const anims = skel?.data?.animations?.map((a: { name: string }) => a.name) ?? [];
      const idleAnim = anims.includes(stageInfo.idle)
        ? stageInfo.idle
        : anims.includes('idle')
        ? 'idle'
        : (anims[0] ?? stageInfo.idle);

      // REPARK 6.0: resetToIdlePose handles setBonesToSetupPose +
      // setSlotsToSetupPose + clearTracks + idle animation.
      resetToIdlePose(spine, idleAnim);
    }

    if (resolveAttackRef.current) {
      animationLockRef.current = false;
      resolveAttackRef.current();
      resolveAttackRef.current = null;
    }
  }, [eradicateResidualSlots, resetToIdlePose]);

  // ── Expose triggerAttack globally ────────────────────────────────────────────
  useEffect(() => {
    (window as Window & { triggerSpineAttack?: (damage?: number, weaponType?: 'a' | 'b') => Promise<void> }).triggerSpineAttack = triggerAttack;
    (window as Window & { triggerHitFeedback?: (damage: number, weaponType?: 'a' | 'b') => void }).triggerHitFeedback = triggerHitFeedback;
    (window as Window & { triggerFormSwitchFlash?: () => void }).triggerFormSwitchFlash = triggerFormSwitchFlash;
    // Debug: dump all slot attachment names for the active character
    (window as Window & { __spineDebug?: () => void }).__spineDebug = () => {
      try {
        const char = spinesRef.current[activeStageIdxRef.current ?? 0];
        if (!char) { console.warn('[__spineDebug] no spine'); return; }
        const skel: any = (char as any)?.skeleton;
        if (!skel?.slots) { console.warn('[__spineDebug] no slots'); return; }
        const attached = (skel.slots as any[])
          .filter((s: any) => { try { return s.attachment != null; } catch { return false; } })
          .map((s: any) => {
            try { return { name: s.data?.name, type: s.attachment?.constructor?.name ?? typeof s.attachment }; }
            catch { return { name: '?' }; }
          });
        console.table(attached);
      } catch (e) { console.warn('[__spineDebug] error:', e); }
    };
    return () => {
      delete (window as Window & { triggerSpineAttack?: unknown }).triggerSpineAttack;
      delete (window as Window & { triggerHitFeedback?: unknown }).triggerHitFeedback;
      delete (window as Window & { triggerFormSwitchFlash?: unknown }).triggerFormSwitchFlash;
      delete (window as Window & { __spineDebug?: unknown }).__spineDebug;
    };
  }, [triggerAttack, triggerHitFeedback, triggerFormSwitchFlash]);

  // ── Global listener factory — TC-BT-05: singleton per stageIdx via Map cache ─────
  // The factory creates and caches ONE listener object per stageIdx on first call.
  // Subsequent calls return the cached object — no object identity drift across renders.
  // Cleanup happens in the useEffect return below (FIX P-03) via stageListenerRefs.
  //
  // REPARK 6.0 — P1 2026-07-26: Dead-loop fix.
  // ABSOLUTE RULE: setAnimation / setEmptyAnimation MUST NOT be called inside
  // the 'interrupt' or 'end' callbacks. Both events fire synchronously inside
  // the Spine update loop — calling setAnimation in interrupt triggers a new
  // interrupt, producing 70k logs/sec and crashing the browser.
  // Idle restoration is ONLY permitted inside 'complete' (trackIndex === 1).
  const _makeGlobalListener = (stageIdx: number): {
    start: (entry: any) => void;
    interrupt: (entry: any) => void;
    end: (entry: any) => void;
    complete: (entry: any) => void;
  } => {
    if (_stageListenerCache.has(stageIdx)) {
      return _stageListenerCache.get(stageIdx)! as ReturnType<typeof _makeGlobalListener>;
    }

    // Lightweight logging — only for 'complete', no per-frame events.
    const listener: ReturnType<typeof _makeGlobalListener> = {
      start: (_entry: any) => {
        // NO-OP: we never call setAnimation in start.
      },

      interrupt: (_entry: any) => {
        // NO-OP: setAnimation in interrupt → dead loop. Forbidden.
      },

      end: (_entry: any) => {
        // NO-OP: we never call setAnimation in end.
      },

      complete: (entry: any) => {
        if (entry?.trackIndex !== 1) return;

        const spine = spinesRef.current[stageIdx];
        if (!spine) return;

        const idleAnim = STAGE_REGISTRY[stageIdx]?.idle ?? 'idle_1';
        if (!idleAnim) return;

        // TASK 3: Play standby voice when returning to idle.
        AudioManager.playVoice(stageIdx, 'standby').catch(() => undefined);

        // REPARK 6.0 — P0 2026-07-26: Next-frame hard reset.
        //
        // setEmptyAnimation(mixDuration) is unreliable when the browser tab is
        // backgrounded, throttled, or the Pixi ticker is suspended — the mix
        // never completes and the model freezes at the attack's last frame.
        //
        // Fix: use requestAnimationFrame to reset in the NEXT render frame.
        // This guarantees:
        //   1. clearTracks()      — strips all bone control from all tracks
        //   2. setToSetupPose()   — authoritative skeleton reset to rest-pose
        //   3. setAnimation(0, …) — hard restart idle on track 0, loop=true
        //
        // The double-rAF gives the Pixi engine a full tick to flush before we
        // touch skeleton state — avoids the scenario where Pixi re-reads skeleton
        // data mid-reset and briefly shows a corrupted frame.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const sp = spinesRef.current[stageIdx];
            if (!sp) return;
            const idleAnim = STAGE_REGISTRY[stageIdx]?.idle ?? 'idle_1';
            resetToIdlePose(sp, idleAnim);

            if (resolveAttackRef.current) {
              animationLockRef.current = false;
              resolveAttackRef.current();
              resolveAttackRef.current = null;
            }
          });
        });
      },
    };
    _stageListenerCache.set(stageIdx, listener as any);
    return listener as ReturnType<typeof _makeGlobalListener>;
  };

  // ── Init PixiJS v8 + spine-pixi-v8 ──────────────────────────────────────────
  useEffect(() => {
    if (isInitializingRef.current) return;
    isInitializingRef.current = true;

    let mounted = true;

    const safeDestroy = (target: any) => {
      if (!target) return;
      try { target.destroy(true, { children: true, texture: true, baseTexture: true }); }
      catch (e) { console.warn('[SpineViewer] Safely caught destroy error.', e); }
    };

    // ════════════════════════════════════════════════════════════════════════════
    // P1-41 REWORK: unified retryOrFatal(reason) — single source of truth
    //
    // Every Stage 1 recoverable failure (Pixi init, characterSpine null,
    // app.render() throw, first-frame character null) MUST funnel through
    // this function. Do NOT inline retry logic at call sites — that creates
    // version drift and bypass paths.
    //
    // Contract:
    //   1. If unmounted → no-op (don't schedule work on dead instance).
    //   2. If a retry timer is already live → no-op (prevent double-schedule).
    //   3. If retryCount < MAX → increment, schedule initSpine() after backoff.
    //   4. Otherwise → onFatalError() (terminal).
    //
    // Side effects:
    //   - Cancels any existing timer before scheduling a new one.
    //   - Calls safeDestroy(app) and resets isInitializingRef so the next
    //     attempt re-enters the load sequence from scratch.
    //   - Ships a diag event so PM2 sees retry storms.
    //
    // `reason` is one of: 'pixi_init' | 'character_null' | 'render_throw' |
    //                     'first_frame_char_null'.
    // ════════════════════════════════════════════════════════════════════════════
    const retryOrFatal = (reason: 'pixi_init' | 'character_null' | 'render_throw' | 'first_frame_char_null') => {
      if (!mounted) return;
      if (retryInFlightRef.current) return; // already scheduled

      const next = stage1RetryCountRef.current + 1;
      if (next > STAGE1_RETRY_MAX) {
        console.error(
          `[SpineViewer] All ${STAGE1_RETRY_MAX} Stage 1 retries exhausted (reason=${reason}). Going fatal.`,
        );
        try {
          shipDiag('stage1-trace', 'error',
            `[P1-41] retry-exhausted reason=${reason} ts=${Date.now()}`);
        } catch { /* shipper must never affect retry */ }
        retryInFlightRef.current = false;
        stage1RetryCountRef.current = 0;
        onFatalErrorRef.current?.();
        return;
      }

      stage1RetryCountRef.current = next;
      retryInFlightRef.current = true;
      const delayMs = STAGE1_RETRY_BASE_MS * Math.pow(2, next - 1);
      console.warn(
        `[SpineViewer] Stage 1 retry ${next}/${STAGE1_RETRY_MAX} in ${delayMs}ms (reason=${reason})`,
      );
      try {
        shipDiag('stage1-trace', 'warn',
          `[P1-41] retry-scheduled attempt=${next} max=${STAGE1_RETRY_MAX} delayMs=${delayMs} reason=${reason} ts=${Date.now()}`);
      } catch { /* ignore */ }
      onStage1RetryRef.current?.(next, STAGE1_RETRY_MAX);

      // Tear down current failed attempt so initSpine can start fresh.
      safeDestroy(appRef.current);
      appRef.current = null;
      isInitializingRef.current = false;

      // Clear any prior timer before scheduling (defensive).
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        retryInFlightRef.current = false;
        if (!mounted) return;
        void initSpine();
      }, delayMs);
    };

    const initSpine = async () => {
      if (!containerRef.current || !mounted) return;

      const PIXI = await import('pixi.js');
      (window as any).PIXI = PIXI;
      (window as any).require = (pkg: string) => {
        if (pkg === 'pixi.js' || pkg.startsWith('@pixi/')) return PIXI;
        return undefined;
      };

      let app: any = null;
      try {
        const { Application, Assets } = PIXI;
        await import('@esotericsoftware/spine-pixi-v8');

        console.log("[Spine] App ready, loading assets...");

        app = new Application();
        await app.init({
          resizeTo:         window,
          backgroundAlpha:   0,
          antialias:        true,
          resolution:       Math.min(window.devicePixelRatio || 1, 2.5),
          autoDensity:     true,
          premultipliedAlpha: true,
          // P0 2026-08-19: PixiJS v8 has `roundPixels` as a getter-only property on
          // AbstractRenderer (see node_modules/pixi.js/lib/rendering/renderers/
          // shared/system/AbstractRenderer.d.ts:315). Assigning to it post-init
          // throws "Cannot set property roundPixels of #<e> which has only a
          // getter" and drops the renderer into the silhouette fallback. Pass
          // it as an init option instead — that's the documented v8 path.
          roundPixels:      true,
          hello:            true,
        });

        if (!mounted) { safeDestroy(app); return; }
        appRef.current = app;
        console.log('[TRACE][SpineViewer] pixi-init-complete', { ts: Date.now() });
        shipBattleTrace('[SpineViewer] pixi-init-complete', {
          battleInit: false,
          isSpineLoaded: false,
          isStage2Loaded: false,
          isStage3Loaded: false,
          isStage4Loaded: false,
          isAssetLoaded: false,
          isCurrentModelRendered: false,
          isReadyForLiveView: false,
        });
        app.stage.sortableChildren = true;
        containerRef.current.appendChild(app.canvas);
        app.canvas.style.width  = '100%';
        app.canvas.style.height = '100%';
        app.canvas.style.zIndex = '0';
        (app.canvas as HTMLCanvasElement).style.imageRendering =
          navigator.userAgent.includes('Firefox') ? 'crisp-edges' : 'pixelated';
        // GLASS PLATE: Canvas is purely visual — pointer events are
        // handled by the HTML Glass Plate in SpineViewer (z-[40]).
        // pointer-events: none ensures no accidental PIXI hit testing.
        app.canvas.style.pointerEvents = 'none';

        // V3 PHASE 1 — pre-warm BG/Halo/Stage 1 JSON + atlas through the
        // shared resource loader. The actual byte consumption happens later
        // inside tryMountLayer (rawResponse + text() / json()). Pre-warming
        // here only guarantees the bytes are resident (memory or IDB) by the
        // time the spine mounts run, eliminating the second network round-trip
        // that the previous Assets.load path caused. Note: query strings are
        // PRESERVED — `halo.json?v=v2.0.0` and `idle_1.json?v=1` are
        // intentionally different resources from their unsuffixed counterparts.
        await Promise.all([
          ensureResource(ASSETS.bg.json,                    { timeoutMs: 0 }),
          ensureResource(ASSETS.bg.atlas,                   { timeoutMs: 0 }),
          ensureResource(ASSETS.halo.json,                  { timeoutMs: 0 }),
          ensureResource(ASSETS.halo.atlas,                 { timeoutMs: 0 }),
          ensureResource('/H501/idle_01/idle_1.json?v=1',   { timeoutMs: 0 }),
          ensureResource('/H501/idle_01/idle_1.atlas?v=1',  { timeoutMs: 0 }),
        ]);
        if (!mounted) { safeDestroy(app); return; }

      } catch (err) {
        console.error("[Spine] FATAL during PixiJS init or asset load:", err instanceof Error ? err.message : err);
        stage1Fail('S00_PIXI_INIT', { err });
        // P1-41 REWORK: unified retry — single source of truth for all Stage 1 failures.
        // retryOrFatal schedules initSpine() with backoff and tears down the failed app.
        retryOrFatal('pixi_init');
        return;
      }

      const _cw = containerRef.current?.clientWidth  || 400;
      const _ch = containerRef.current?.clientHeight || 520;

      // ── Generic spine mount factory ──────────────────────────────────────────
      // ════════════════════════════════════════════════════════════════════════════
      //  FORENSIC TRACE — S01–S21 per-step markers (P0 2026-08-26)
      //  Every step is traced to console AND shipped via shipDiag to /api/diag/client-log.
      //  FAIL events always print: step + error.name + error.message + error.stack + URL.
      //  No business logic is changed. No decision points are altered.
      // ════════════════════════════════════════════════════════════════════════════

      const tryMountLayer = async (
        label: string,
        skeletonUrl: string,
        atlasUrl: string,
        idleAnimName: string,
        layerScale: number,
        layerY: number,
        extraSetup?: (s: any) => void,
      ): Promise<SpineHandle | null> => {
        try {
          // ── S01: CHARACTER_START ──────────────────────────────────────────────
          if (label === 'Character') {
            stage1Trace('S01_CHARACTER_START', {
              skeletonUrl,
              atlasUrl,
              idleAnimName,
              layerScale,
              layerY,
            });
          }

          // ── S02: JSON_FETCH_START ───────────────────────────────────────────
          if (label === 'Character') {
            stage1Trace('S02_JSON_FETCH_START', { url: skeletonUrl });
          }
          // V3 PHASE 1 — JSON goes through the shared resource loader.
          // If LoadingScreen pre-warmed this URL earlier, this ensure() call
          // resolves from memory / IDB instead of triggering a second network
          // fetch. The loader guarantees one acquisition per normalized URL.
          const jsonResult = await ensureResource(skeletonUrl, { timeoutMs: 0 });
          if (jsonResult.blob.size === 0) {
            const err = new Error(`[Spine/${label}] Empty JSON blob: ${skeletonUrl}`);
            if (label === 'Character') stage1Fail('S02_JSON_FETCH', { url: skeletonUrl, err });
            throw err;
          }

          // ── S03: JSON_FETCH_OK ──────────────────────────────────────────────
          if (label === 'Character') {
            stage1Trace('S03_JSON_FETCH_OK', {
              url: skeletonUrl,
              fromCache: jsonResult.fromCache,
              fromMemory: jsonResult.fromMemory,
              elapsedMs: jsonResult.elapsedMs,
              size: jsonResult.blob.size,
            });
          }

          // ── S04: JSON_PARSE_OK ──────────────────────────────────────────────
          let rawJson: any;
          try {
            const jsonText = await jsonResult.blob.text();
            rawJson = JSON.parse(jsonText);
          } catch (parseErr) {
            if (label === 'Character') stage1Fail('S04_JSON_PARSE', { url: skeletonUrl, err: parseErr });
            throw parseErr;
          }
          if (label === 'Character') {
            stage1Trace('S04_JSON_PARSE_OK', {
              url: skeletonUrl,
              hasData: !!rawJson,
              hasBones: Array.isArray(rawJson?.bones),
              boneCount: rawJson?.bones?.length ?? 0,
              skinNames: rawJson?.skins ? Object.keys(rawJson.skins) : [],
            });
          }

          // ── S05: ATLAS_FETCH_START ─────────────────────────────────────────
          if (label === 'Character') {
            stage1Trace('S05_ATLAS_FETCH_START', { url: atlasUrl });
          }
          // V3 PHASE 1 — atlas text goes through the shared resource loader.
          const atlasResult = await ensureResource(atlasUrl, { timeoutMs: 0 });
          if (atlasResult.blob.size === 0) {
            const err = new Error(`[Spine/${label}] Empty atlas blob: ${atlasUrl}`);
            if (label === 'Character') stage1Fail('S05_ATLAS_FETCH', { url: atlasUrl, err });
            throw err;
          }

          // ── S06: ATLAS_FETCH_OK ─────────────────────────────────────────────
          if (label === 'Character') {
            stage1Trace('S06_ATLAS_FETCH_OK', {
              url: atlasUrl,
              fromCache: atlasResult.fromCache,
              elapsedMs: atlasResult.elapsedMs,
              size: atlasResult.blob.size,
            });
          }

          // ── S07: ATLAS_PARSE_OK ─────────────────────────────────────────────
          let atlasText: string;
          let tempAtlas: any;
          let pageNames: string[];
          try {
            atlasText = await atlasResult.blob.text();
          } catch (atlasTextErr) {
            if (label === 'Character') stage1Fail('S07_ATLAS_PARSE', { url: atlasUrl, err: atlasTextErr });
            throw atlasTextErr;
          }
          try {
            const spineCore = await import('@esotericsoftware/spine-core');
            tempAtlas = new spineCore.TextureAtlas(atlasText);
            pageNames = tempAtlas.pages.map((p: any) => p.name);
          } catch (atlasParseErr) {
            if (label === 'Character') stage1Fail('S07_ATLAS_PARSE', { url: atlasUrl, err: atlasParseErr });
            throw atlasParseErr;
          }
          const atlasDir = atlasUrl.substring(0, atlasUrl.lastIndexOf('/') + 1);
          if (label === 'Character') {
            stage1Trace('S07_ATLAS_PARSE_OK', {
              url: atlasUrl,
              pageCount: pageNames.length,
              pageNames,
            });
          }

          // Import spine libraries once, after atlas is parsed
          const spineCore = await import('@esotericsoftware/spine-core');
          const { SpineTexture } = await import('@esotericsoftware/spine-pixi-v8');

          // ── S08/S09: Per-page PIXI.Assets.load + PIXI texture forensic trace ──
          // P0 2026-08-26: Strict mode — any page failure propagates to null return.
          // Stage 2/3/4 keep best-effort .catch(() => null) for background preloading.
          const pageLoadErrors: string[] = [];
          for (const pageName of pageNames) {
            const fullUrl = atlasDir + pageName;

            if (label === 'Character') {
              stage1Trace('S08_PAGE_LOAD_START', { pageName, url: fullUrl });
            }

            let pixiTex: any = null;
            try {
              pixiTex = await PIXI.Assets.load(fullUrl);
            } catch (loadErr) {
              pageLoadErrors.push(`[Spine/${label}] Failed to load atlas page: ${fullUrl} — ${loadErr instanceof Error ? loadErr.message : String(loadErr)}`);
              if (label === 'Character') {
                stage1Fail('S09_PAGE_LOAD_FAIL', {
                  pageName,
                  url: fullUrl,
                  err: loadErr,
                });
              }
            }

            if (!pixiTex) {
              pageLoadErrors.push(`[Spine/${label}] PIXI.Assets.load returned null for: ${fullUrl}`);
              if (label === 'Character') {
                stage1Fail('S09_PAGE_LOAD_NULL', {
                  pageName,
                  url: fullUrl,
                  err: new Error('PIXI.Assets.load returned null'),
                });
              }
            }

            // ── TASK 4: Forensic audit of PIXI.Assets.load result ─────────────
            if (label === 'Character' && pixiTex) {
              const textureType     = pixiTex.constructor?.name ?? typeof pixiTex;
              const hasSource       = pixiTex.source !== undefined && pixiTex.source !== null;
              const sourceType      = hasSource ? (pixiTex.source?.constructor?.name ?? 'unknown') : 'none';
              const texWidth        = pixiTex.width  ?? (hasSource ? pixiTex.source?.width  : undefined);
              const texHeight       = pixiTex.height ?? (hasSource ? pixiTex.source?.height : undefined);
              const validFlag       = pixiTex.valid   ?? 'n/a';
              const destroyedFlag   = (pixiTex as any).destroyed ?? 'n/a';
              stage1Trace('S09_PAGE_PIXI_RESULT', {
                pageName,
                url: fullUrl,
                textureType,
                hasSource,
                sourceType,
                width: texWidth,
                height: texHeight,
                valid: validFlag,
                destroyed: destroyedFlag,
              });
            }

            if (pageLoadErrors.length > 0) {
              const err = new Error(`[Spine/${label}] Stage 1 character texture load failed: ${pageLoadErrors.join('; ')}`);
              if (label === 'Character') stage1Fail('S09_PAGE_LOAD_AGGREGATE', { err, label });
              throw err;
            }

            // ── S10: SpineTexture.from ────────────────────────────────────────
            // TASK 5: forensic wrap around SpineTexture.from (observe, don't change)
            let spineTex: any = null;
            const spineTexInput = pixiTex.source ?? pixiTex;
            if (label === 'Character') {
              stage1Trace('S10_SPINE_TEXTURE_CREATE', {
                pageName,
                url: fullUrl,
                inputType: spineTexInput.constructor?.name ?? typeof spineTexInput,
                inputHasSource: pixiTex.source !== undefined,
                inputWidth:  spineTexInput.width  ?? (pixiTex.source?.width  ?? undefined),
                inputHeight: spineTexInput.height ?? (pixiTex.source?.height ?? undefined),
              });
            }
            try {
              spineTex = SpineTexture.from(spineTexInput);
            } catch (texErr) {
              if (label === 'Character') {
                stage1Fail('S10_SPINE_TEXTURE_CREATE', {
                  pageName,
                  url: fullUrl,
                  err: texErr,
                  extra: { inputType: spineTexInput.constructor?.name ?? typeof spineTexInput },
                });
              }
              throw texErr;
            }

            if (!spineTex) {
              const err = new Error(`[Spine/${label}] SpineTexture.from returned null for: ${fullUrl}`);
              if (label === 'Character') stage1Fail('S10_SPINE_TEXTURE_NULL', { pageName, url: fullUrl, err });
              throw err;
            }

            // ── S11: page.setTexture ───────────────────────────────────────────
            const page = tempAtlas.pages.find((p: any) => p.name === pageName);
            if (page) {
              try {
                page.setTexture(spineTex);
                if (label === 'Character') {
                  const postWidth  = (page.texture as any)?.width  ?? spineTex.width  ?? 'n/a';
                  const postHeight = (page.texture as any)?.height ?? spineTex.height ?? 'n/a';
                  stage1Trace('S11_PAGE_TEXTURE_BOUND', {
                    pageName,
                    bound: true,
                    postWidth,
                    postHeight,
                  });
                }
              } catch (setTexErr) {
                if (label === 'Character') {
                  stage1Fail('S11_PAGE_TEXTURE_BOUND', { pageName, err: setTexErr });
                }
                throw setTexErr;
              }
            } else {
              if (label === 'Character') {
                stage1Trace('S11_PAGE_TEXTURE_BOUND', { pageName, bound: false, reason: 'page_not_found_in_atlas' });
              }
              console.warn(`[Spine/${label}] Atlas page not found: ${pageName}`);
            }
          }

          // ── S12: All pages bound ─────────────────────────────────────────────
          if (label === 'Character') {
            stage1Trace('S12_ATLAS_ALL_PAGES_BOUND', { pageCount: pageNames.length, pageNames });
          }

          rawJson.physics = [];
          if (rawJson.data) rawJson.data.physics = [];

          // ── S13: AtlasAttachmentLoader created ────────────────────────────────
          let atlasLoader: any;
          try {
            atlasLoader = new spineCore.AtlasAttachmentLoader(tempAtlas);
          } catch (alErr) {
            if (label === 'Character') stage1Fail('S13_ATLAS_LOADER', { err: alErr, label });
            throw alErr;
          }
          if (label === 'Character') {
            stage1Trace('S13_ATLAS_LOADER_OK', { label });
          }

          // ── S14: SkeletonJson created ────────────────────────────────────────
          let skeletonJson: any;
          try {
            skeletonJson = new spineCore.SkeletonJson(atlasLoader);
          } catch (sjErr) {
            if (label === 'Character') stage1Fail('S14_SKELETON_JSON', { err: sjErr, label });
            throw sjErr;
          }
          if (label === 'Character') {
            stage1Trace('S14_SKELETON_JSON_OK', { label });
          }

          // ── S15: readSkeletonData ─────────────────────────────────────────────
          let skeletonData: any;
          try {
            skeletonData = skeletonJson.readSkeletonData(rawJson);
          } catch (sdErr) {
            if (label === 'Character') stage1Fail('S15_READ_SKELETON_DATA', { err: sdErr, label });
            throw sdErr;
          }
          (skeletonData as any).physics = [];
          if (label === 'Character') {
            const animNames  = skeletonData.animations?.map((a: any) => a.name) ?? [];
            const slotNames = skeletonData.slots?.map((s: any) => s.data?.name) ?? [];
            const skinNames = skeletonData.skins?.map((s: any) => s.name) ?? [];
            const boneCount = skeletonData.bones?.length ?? 0;
            stage1Trace('S15_SKELETON_DATA_OK', {
              label,
              animations: animNames,
              animCount: animNames.length,
              idleRequested: idleAnimName,
              idleIncluded: animNames.includes(idleAnimName),
              firstAnim: animNames[0] ?? '',
              slots: slotNames,
              slotCount: slotNames.length,
              skins: skinNames,
              skinCount: skinNames.length,
              bones: boneCount,
            });
          }

          // ── S16: new Spine() ────────────────────────────────────────────────
          const { Spine } = await import('@esotericsoftware/spine-pixi-v8');
          let spine: SpineHandle;
          try {
            spine = new Spine({ skeletonData, autoUpdate: false }) as unknown as SpineHandle;
          } catch (spineErr) {
            if (label === 'Character') stage1Fail('S16_SPINE_INSTANCE', { err: spineErr, label });
            throw spineErr;
          }
          if (label === 'Character') {
            const hasSkeleton = (spine as any).skeleton != null;
            const hasState    = (spine as any).state    != null;
            const childCount  = (spine as any).children?.length ?? 'n/a';
            const destroyed   = (spine as any).destroyed ?? 'n/a';
            stage1Trace('S16_SPINE_INSTANCE_OK', {
              label,
              hasSkeleton,
              hasState,
              childCount,
              destroyed,
            });
          }

          const skel: any = (spine as any).skeleton;
          if (skel) {
            skel.physics = [];
            const origUWT = skel.updateWorldTransform.bind(skel);
            skel.updateWorldTransform = (physics: any) => {
              try {
                if (physics == null) return origUWT(null);
                return origUWT(physics);
              } catch { (skel as any).updateCache?.(); }
            };
          }

          (spine as any).x = 0;
          (spine as any).y = 0;
          (spine as any).scale.set(layerScale);

          // ── extraSetup (Character only gets forensic catch; BG/Halo unchanged) ─
          try { extraSetup?.(spine); } catch (setupErr) {
            console.warn(`[Spine/${label}] extraSetup failed:`, setupErr instanceof Error ? setupErr.message : setupErr);
            if (label === 'Character') {
              stage1Fail('extraSetup', { err: setupErr, label });
            }
          }

          // ── S17: Idle animation selection ────────────────────────────────────
          const anims = (spine as any).skeleton?.data?.animations?.map((a: { name: string }) => a.name) ?? [];
          const selectedAnim = anims.includes(idleAnimName) ? idleAnimName : (anims[0] ?? '');
          if (label === 'Character') {
            stage1Trace('S17_IDLE_ANIM_SELECTED', {
              requested: idleAnimName,
              available: anims,
              selected: selectedAnim,
            });
          }

          // ── S18: setAnimation ───────────────────────────────────────────────
          // TASK 9: Independent try-catch around setAnimation
          if (selectedAnim) {
            try {
              const trackEntry = spine.state.setAnimation(0, selectedAnim, true) as any;
              if (label === 'Character') {
                stage1Trace('S18_ANIMATION_BOUND', {
                  selected: selectedAnim,
                  entryAnimation: trackEntry?.animation?.name ?? 'n/a',
                });
              }
            } catch (animErr) {
              if (label === 'Character') {
                stage1Fail('S18_ANIMATION_BOUND', {
                  err: animErr,
                  extra: { selected: selectedAnim, available: anims },
                });
              }
              throw animErr;
            }
          }

          // Residual attachment clearing (existing code — no changes)
          const _clearResidualAttachments = (spineObj: SpineHandle) => {
            const skel2: any = (spineObj as any).skeleton;
            if (!skel2?.slots) return;
            for (const slot of skel2.slots) {
              if (RESIDUAL_SLOTS.has((slot as any).data?.name)) {
                try { (slot as any).attachment = null; } catch { /* noop */ }
                (slot as any).setToSetupPose?.();
              }
            }
          };

          _clearResidualAttachments(spine);
          (spine as any).autoUpdate = false;
          stageListenerRefs.current[0] = (spine as any).state?.addListener?.(_makeGlobalListener(0));
          _clearResidualAttachments(spine); // second pass handles timing gap

          // ── S19: addChild ────────────────────────────────────────────────────
          appRef.current?.stage?.addChild(spine as any);
          const parentOk = (spine as any).parent != null;
          if (label === 'Character') {
            stage1Trace('S19_CHARACTER_ADD_CHILD_OK', { parentExists: parentOk });
          }

          // ── S20: spinesRef assignment ─────────────────────────────────────────
          if (label === 'Character') {
            stage1Trace('S20_CHARACTER_REF_ASSIGNED', { label });
          }

          // ── GLITCH GUARD (Character only — existing non-fatal safety net) ─────
          if (label === 'Character') {
            try {
              const skel2: any = (spine as any).skeleton;
              skel2.setBonesToSetupPose?.();
              skel2.setSlotsToSetupPose?.();
              for (const slot of skel2.slots ?? []) {
                if (RESIDUAL_SLOTS.has((slot as any).data?.name)) {
                  try { (slot as any).attachment = null; } catch { /* noop */ }
                  (slot as any).setToSetupPose?.();
                }
              }
              try { skel2.updateWorldTransform(null); } catch { (spine as any).updateCache?.(); }
            } catch (initErr) {
              console.warn('[Spine/Character] Glitch-guard init failed (non-fatal):',
                initErr instanceof Error ? initErr.message : initErr);
            }
          }

          // ── S21: CHARACTER_READY ─────────────────────────────────────────────
          (spine as any).autoUpdate = true;
          (spine as any).updateCache?.();
          if (label === 'Character') {
            stage1Trace('S21_CHARACTER_READY', { label });
          }
          return spine;

        } catch (layerErr) {
          // Outer catch: preserves existing null-return behaviour.
          // Every step-specific error fires stage1Fail then re-throws, so the
          // outer catch here should only fire when an uncaught error escapes
          // a step without its own try/catch. Add stage1Fail as a last-resort
          // capture so nothing silently disappears into the void.
          console.error(`[Spine/${label}] Mount failed:`, layerErr instanceof Error ? layerErr : layerErr);
          if (label === 'Character') {
            stage1Fail('SXX_OUTER_CATCH', { err: layerErr, label });
          }
          return null;
        }
      };

      // ── PIXI Container Hierarchy ─────────────────────────────────────────────
      //  stage (root PIXI stage)
      //  ├── bgContainer
      //  ├── mainContainer
      //  │   ├── haloSpine  (zIndex: 0)
      //  │   └── rootContainer (zIndex: 10)  ← all character spines children here
      //  │       ├── characterSpine[0]  Stage 1 (always loaded)
      //  │       ├── characterSpine[1]  Stage 2 (lazy)
      //  │       ├── characterSpine[2]  Stage 3 (lazy, placeholder)
      //  │       └── characterSpine[3]  Stage 4 (lazy, placeholder)
      const mainContainer = new PIXI.Container();
      mainContainer.sortableChildren = true;
      appRef.current?.stage?.addChild(mainContainer);

      const rootContainer = new PIXI.Container();
      rootContainer.sortableChildren = true;
      rootContainer.zIndex = 10;
      mainContainer.addChild(rootContainer);

      mainContainerRef.current  = mainContainer;
      rootContainerRef.current  = rootContainer;

      const viewW = window.innerWidth;
      const viewH = window.innerHeight;

      // Fit/Contain Protocol (P0 2026-07-26) — Linear scale (no quadratic doubling).
      // fitScale: never crop the model — use whichever axis needs the smaller scale.
      const fitScale     = Math.min(viewW / COMMAND_CENTER.DESIGN_W, viewH / COMMAND_CENTER.DESIGN_H);
      // baseCharScale is now a CONSTANT — depends only on the design reference height,
      // NOT the live viewport. Mixing viewport height back in would cause quadratic scaling.
      const baseCharScale = (COMMAND_CENTER.DESIGN_H * COMMAND_CENTER.CHARACTER.SCALE_RATIO) / CHARACTER_HEIGHT;
      const charScale    = baseCharScale * fitScale * COMMAND_CENTER.FIT_SCALE_MULT;
      // Spine pivot is at center-bottom of the character. We want feet to sit at
      // the viewport's vertical center + a fixed pixel offset that scales with fitScale.
      const charY = (viewH / 2) + (COMMAND_CENTER.PIVOT_OFFSET_PX * fitScale);
      rootContainer.x = viewW / 2;
      rootContainer.y = charY;
      rootContainer.scale.set(charScale);
      targetScaleRef.current = charScale;

      // ── HALO POSITION: scale-invariant (FIX P0 2026-07-31) ────────────────────
      //
      // OLD formula: haloY = charY - (HALO_RATIO * viewH)
      //   Problem: HALO_RATIO = 0.28 and viewH changes at different viewport sizes,
      //   so the halo "drifts" relative to the character's feet when aspect ratio changes.
      //
      // NEW formula: haloY = charY + baseHaloOffset * (charScale / baseCharScale)
      //   The base offset is calibrated at design-reference scale (fitScale=1).
      //   At any other scale, it scales proportionally with charScale, keeping the
      //   halo's visual gap from the feet constant regardless of screen size or DPR.
      //
      // Derivation (at fitScale=1, baseCharScale=0.374):
      //   old:  haloY = charY - (0.28 * 1920) = charY - 538.6
      //   new:  haloY = charY + (-1439) = charY - 1439
      //   charScale/baseCharScale = 1.0  →  haloY = charY - 1439  ✓
      const haloY = charY + HALO_BASE_OFFSET_PIXI * (charScale / baseCharScale);

      // ── LAYER 0 — BACKGROUND ─────────────────────────────────────────────
      const bgContainer = new PIXI.Container();
      bgContainer.zIndex = 0;
      appRef.current?.stage?.addChildAt(bgContainer, 0);

      const bgScale = Math.max(viewW / 4165, viewH / 5840) * 1.1;

      const bgSpine = await tryMountLayer('BG', ASSETS.bg.json, ASSETS.bg.atlas, 'animation', 1, 0, (s) => {
        (s as any).skeleton?.setSlotsToSetupPose?.();
        s.anchor?.set(0.5);
        s.x = viewW / 2;
        s.y = viewH / 2;
        (s as any).scale?.set(bgScale);
      });
      if (bgSpine) {
        bgContainer.addChild(bgSpine as any);
        bgRef.current = bgSpine;
        console.log('[TRACE][SpineViewer] bg-mounted', { ts: Date.now() });
        shipBattleTrace('[SpineViewer] bg-mounted', {
          battleInit: false,
          isSpineLoaded: false,
          isStage2Loaded: false,
          isStage3Loaded: false,
          isStage4Loaded: false,
          isAssetLoaded: false,
          isCurrentModelRendered: false,
          isReadyForLiveView: false,
        });
      }

      // ── LAYER 1 — CHARACTER Stage 1 (index 0 in spinesRef) ────────────────
      const characterSpine = await tryMountLayer(
        'Character',
        `/H501/idle_01/idle_1.json`,
        `/H501/idle_01/idle_1.atlas`,
        STAGE_REGISTRY[0].idle,
        1, 0,
        (s) => {
          // ── CRITICAL: Clear residual attachments BEFORE setSkinByName and
          // state.apply. This is the first line of defense. If state.apply runs
          // first (from a previous animation attempt on this skeleton), it may
          // re-apply the hand attachments. Clearing here ensures we start
          // from a clean state before any animation state is set.
          for (const slot of (s as any).skeleton?.slots ?? []) {
            if (RESIDUAL_SLOTS.has((slot as any).data?.name)) {
              try { (slot as any).attachment = null; } catch { /* noop */ }
            }
          }

          (s as any).skeleton?.setSkinByName?.('default');
          // NOTE: state.apply is intentionally NOT called here. Calling it after
          // setSkinByName but before setAnimation can apply attachment keyframes
          // from whatever animation was last active on this skeleton, overwriting
          // the attachment-nulling above. The skeleton starts without any active
          // animation, and setAnimation in tryMountLayer is what sets the idle
          // animation — with no state.apply in between, the cleared state holds.

          (s as any).x = 0;
          (s as any).y = 0;
          (s as any).scale.set(1);
          (s as any).pivot?.set(0, 0);

          // Visual suppression (opacity 0) as secondary defense.
          // The primary fix is the attachment=null above (before state.apply).
          // This color:alpha=0 is the fallback in case any code path
          // somehow still assigns an attachment to these slots.
          for (const slot of (s as any).skeleton?.slots ?? []) {
            if (RESIDUAL_SLOTS.has((slot as any).data?.name)) {
              (slot as any).color?.set(0, 0, 0, 0);
            }
          }

          // ── GLITCH GUARD (Phase 6) ────────────────────────────────────────
          // Update world transform so the first PIXI render has correct positions.
          // NOTE: eradicateResidualSlots is called in tryMountLayer AFTER
          // setAnimation, so it's the authoritative slot-clearing mechanism.
          // This GLITCH GUARD block here serves as an additional safety net.
          try {
            const skel: any = (s as any).skeleton;
            skel.setBonesToSetupPose?.();
            skel.setSlotsToSetupPose?.();
            // Re-clear attachments here as a belt-and-suspenders measure
            for (const slot of skel.slots ?? []) {
              if (RESIDUAL_SLOTS.has((slot as any).data?.name)) {
                try { (slot as any).attachment = null; } catch { /* noop */ }
                (slot as any).setToSetupPose?.();
              }
            }
            try { skel.updateWorldTransform(null); } catch { skel.updateCache?.(); }
          } catch (initErr) {
            console.warn('[Spine/Character] Glitch-guard init failed (non-fatal):',
              initErr instanceof Error ? initErr.message : initErr);
          }
        },
      );

      if (characterSpine) {
        (characterSpine as any).zIndex = 10;
        rootContainer.addChild(characterSpine as any);
        console.log('[TRACE][SpineViewer] character-mounted', { ts: Date.now() });
        shipBattleTrace('[SpineViewer] character-mounted', {
          battleInit: false,
          isSpineLoaded: true,
          isStage2Loaded: false,
          isStage3Loaded: false,
          isStage4Loaded: false,
          isAssetLoaded: false,
          isCurrentModelRendered: false,
          isReadyForLiveView: false,
        });

        // ── Asset Probe: Confirm slots exist ───────────────────────────────────────
        // Pixel Heist extraction logic removed per Commander mandate.
        // Weapon icons now use static assets: /ui/icon_hand.png and /ui/icon_thrust.png

        characterSpine.on('hit', () => {
          if (hitEffectRef.current) return;
          hitEffectRef.current = true;
          const flash = document.createElement('div');
          flash.style.cssText = [
            'position:absolute;inset:0;pointer-events:none;z-index:50;',
            'background:radial-gradient(circle,rgba(255,45,135,0.25) 0%,transparent 70%);',
            'animation:spineFlash 0.35s ease-out forwards;',
          ].join('');
          containerRef.current?.appendChild(flash);
          setTimeout(() => flash.remove(), 400);
          setTimeout(() => { hitEffectRef.current = false; }, 350);
        });
      }

      // ── LAYER 2 — HALO ───────────────────────────────────────────────────
      // TASK 2: haloBaseYRef stores the full Y (baseline + active stage offset).
      // handleResize reads it directly so the stage offset survives window resizes.
      haloBaseYRef.current = haloY;

      // ── HALO SCALE: proportionally anchored to charScale (FIX P0 2026-07-31) ────
      //
      // OLD formula: haloScale = (viewH * 0.92) / CHARACTER_HEIGHT
      //   Problem: tied to viewH, so halo shrinks/grows incorrectly when aspect ratio changes.
      //
      // NEW formula: haloScale = charScale * HALO_SCALE_RATIO
      //   The halo is now in mainContainer (not rootContainer), so its world scale =
      //   container's charScale * local haloScale. We compute the local value so that
      //   combined world scale = charScale * 0.92 (consistent visual size relative to model).
      //
      // Also moved HALO_SCALE_RATIO to module level (was local to initSpine) so it is
      // accessible from all callers (mount / handleResize / transitionToForm).
      const haloScale = charScale * HALO_SCALE_RATIO;

      const haloSpine = await tryMountLayer('Halo', ASSETS.halo.json, ASSETS.halo.atlas, 'animation', 1, 0, (s) => {
        s.x = rootContainer.x;
        s.y = haloY;
        s.pivot?.set(0, 0);
        (s as any).scale?.set(haloScale); // Use halo-specific scale, not charScale
        if ((s as any).container) {
          (s as any).container.blendMode = 'screen';
          (s as any).container.alpha = 0.8;
        } else {
          (s as any).alpha = 0.8;
        }
      });
      if (haloSpine) {
        (haloSpine as any).zIndex = 0;
        mainContainer.addChild(haloSpine as any);
        haloRef.current = haloSpine;
        console.log('[TRACE][SpineViewer] halo-mounted', { ts: Date.now() });
        shipBattleTrace('[SpineViewer] halo-mounted', {
          battleInit: false,
          isSpineLoaded: true,
          isStage2Loaded: false,
          isStage3Loaded: false,
          isStage4Loaded: false,
          isAssetLoaded: false,
          isCurrentModelRendered: false,
          isReadyForLiveView: false,
        });
      }

      // Stage 1 is index 0
      spinesRef.current = [characterSpine ?? undefined, undefined, undefined, undefined];

      // P0 2026-08-26: MINIMUM READY FIX — only set stage1Ready when Character truly succeeded.
      // BG and Halo are background aesthetics; they must NEVER gate Battle entry.
      const isCharacterTrulyReady = characterSpine !== null;

      // ── P1-41 REWORK: Character mount failed (null) — route through retryOrFatal ─
      if (!isCharacterTrulyReady) {
        retryOrFatal('character_null');
        return;
      }

      // Success path — characterSpine is non-null
      setStage1Ready(true);
      // P0 2026-08-26 FINAL: Gate onLoaded on Character success only.
      // isSpineLoaded must be strictly equivalent to Stage 1 Character truly mounted.
      onLoadedRef.current?.();
      // P1-41 REWORK: Reset instance-local retry counter on successful mount.
      stage1RetryCountRef.current = 0;
      retryInFlightRef.current = false;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      console.debug('[SpineViewer] all initial layers mounted (character, bg, halo)');
      console.debug('[SpineViewer] waiting for first completed render');

      // V3 PHASE 1 — dev-only resource loader diagnostics dump.
      // The acceptance gate for Phase 1 is "networkStarts <= 1 per URL
      // during one cold Battle entry." Print the table once the engine is
      // ready so QA can copy/paste from devtools console. No-op in production.
      logDiagnosticsTable('SpineViewer initSpine complete');

      setEngineReady(true);

      // ── P1-43 FINAL: idempotent first-frame recovery ──────────────────────
      //
      // Conceptually:
      //   Spine character exists     ─┐
      //   Pixi application/renderer   ├─→ confirm first frame exactly once
      //   character attached to stage ─┘
      //
      // This function is SAFE TO CALL MULTIPLE TIMES — it short-circuits
      // on `firstVisibleFrameReportedRef.current` after the first successful
      // call. It does NOT depend on document.visibilityState: the actual
      // confirmation signal is `app.render()` which is a synchronous WebGL
      // draw pass. The render writes pixels to the canvas framebuffer
      // regardless of whether the browser composites immediately.
      //
      // Sources that may trigger recovery:
      //   - the original `_triggerExplicitFirstFrame` boot path
      //   - the visibilitychange handler (visibility → visible)
      //   - window 'focus' / 'pageshow'
      //   - user pointerdown / touchstart / click
      //   - Pixi ticker callback (next rAF tick)
      //   - the 1.5s setTimeout watchdog (last-resort timer)
      const requestFirstFrameRecovery = (source: string) => {
        if (!app) return;
        // Idempotent — already confirmed.
        if (firstVisibleFrameReportedRef.current) return;
        if (!mounted) return;
        // P1-44 FIX: removed `isInitializingRef.current` guard.
        // That flag is set to true at the start of initSpine() and was
        // historically meant to prevent initSpine re-entry. But it was
        // NEVER cleared on the success path of initSpine, so every recovery
        // source (boot / watchdog / rAF / ticker / visibilitychange /
        // focus / pageshow / pointerdown / touchstart / click) was silently
        // rejected by this guard after init finished. Result:
        //   [SpineViewer] explicit-first-render-called fired,
        //   but [SpineViewer] first-frame-confirmed NEVER did,
        //   so isCurrentModelRendered stayed false,
        //   so LoadingScreen kept polling dismiss-blocked-no-canvas.
        // Idempotency is already provided by firstVisibleFrameReportedRef
        // (one-shot), so the removed guard was both harmful AND redundant.
        const appRefNow = appRef.current;
        if (!appRefNow?.renderer) return;
        // Require the Stage 1 character spine — otherwise the canvas might be
        // blank and LoadingScreen would dismiss into a blank battle.
        const charSpine = spinesRef.current[0];
        if (!charSpine) return;
        // Require at least one stage child so we know something is drawn.
        let stageChildren = 0;
        try { stageChildren = appRefNow.stage?.children?.length ?? 0; } catch { /* ignore */ }
        if (stageChildren === 0) return;

        firstVisibleFrameReportedRef.current = true;
        // Cancel any in-flight rAF + watchdog so duplicate callbacks don't fire.
        if (firstFrameWatchdogRef.current !== null) {
          clearTimeout(firstFrameWatchdogRef.current);
          firstFrameWatchdogRef.current = null;
        }
        if (firstFrameRafRef.current !== 0) {
          cancelAnimationFrame(firstFrameRafRef.current);
          firstFrameRafRef.current = 0;
        }
        // The actual recovery action: synchronously drive a full WebGL draw
        // pass. This does NOT depend on document.visibilityState — it is a
        // function call that runs in the current execution context.
        try {
          appRefNow.render();
        } catch { /* swallow — recovery must never break the page */ }

        shipDiag('stage1-trace', 'info',
          `[P1-43] first-frame-confirmed source=${source} ts=${Date.now()}` +
          ` characterExists=${!!charSpine} pixiExists=${!!appRefNow}` +
          ` stageChildren=${stageChildren}` +
          (typeof document !== 'undefined' ? ` visibilityState=${document.visibilityState}` : '') +
          ` retryCount=${stage1RetryCountRef.current}`);
        shipBattleTrace('[SpineViewer] first-frame-confirmed', {
          battleInit: false,
          isSpineLoaded: true,
          isStage2Loaded: false,
          isStage3Loaded: false,
          isStage4Loaded: false,
          isAssetLoaded: false,
          isCurrentModelRendered: true,
          isReadyForLiveView: false,
        }, true);
        try { onCurrentModelRenderedRef.current?.(); } catch { /* swallow */ }
      };

      // ── P0 2026-08-26: Explicit First Frame Render Gate ────────────────────
      //
      // Problem history:
      //   app.ticker.addOnce(cb)  → fires BEFORE render (not pixel-ready)
      //   app.renderer.on('afterrender', cb)  → v7 API, does NOT exist in PIXI v8.19.0
      //     (zero occurrences of 'afterrender' in node_modules/pixi.js source; the
      //     EventEmitter silently accepts any string but nothing emits it)
      //
      // Fix: Use the explicit PUBLIC API call app.render() once the display tree is
      // fully assembled. This is the only PIXI v8 public API that synchronously
      // triggers a complete WebGL draw pass. After it returns, we defer to the
      // browser's animation frame scheduler so the compositor can process the result
      // before signalling readiness.
      //
      //   • app.render()          → PixiJS PUBLIC Application API, line 249 of
      //                             Application.d.ts: "Renders the current stage"
      //   • requestAnimationFrame  → browser PUBLIC API, guaranteed paint order
      //
      // Guards (P1-44: isInitializingRef removed — see recovery function):
      //   1. firstVisibleFrameReportedRef — one-shot, never fires twice.
      //   2. mounted — skips if component has unmounted.
      //   3. (removed) isInitializingRef — was a re-entrancy guard for initSpine,
      //      but was never cleared on the success path, silently rejecting every
      //      recovery source after init completed. Idempotency is already
      //      guaranteed by firstVisibleFrameReportedRef.
      //   4. Fail-safe: if app.render() throws, do NOT set ready.
      //
      // Semantic guarantee of the double-RAF:
      //   First  rAF callback  → fires before the NEXT paint (browser "repaint" phase
      //                           has not yet happened for this rAF's frame opportunity)
      //   Second rAF callback → fires after the NEXT paint, meaning at least one
      //                           full rendering opportunity has passed since app.render().
      //                           This is the earliest point at which we can be confident
      //                           the compositor has processed the canvas output.
      //   We do NOT claim GPU pixels are physically on screen.
      //
      const _triggerExplicitFirstFrame = () => {
        // P1-42 FIX: clear any prior watchdog before scheduling a fresh chain.
        if (firstFrameWatchdogRef.current !== null) {
          clearTimeout(firstFrameWatchdogRef.current);
          firstFrameWatchdogRef.current = null;
        }
        // P1-43 HOTFIX: cancel any in-flight double-rAF from a previous call
        // so we don't end up with two chains racing to set
        // firstVisibleFrameReportedRef. The inner rAF callback is the only
        // legitimate writer; cancelling here prevents duplicate work.
        if (firstFrameRafRef.current !== 0) {
          cancelAnimationFrame(firstFrameRafRef.current);
          firstFrameRafRef.current = 0;
        }
        // P1-43 FINAL: idempotent recovery function. All top-level handlers
        // (visibilitychange, focus, pageshow, pointerdown, touchstart, click,
        // ticker callback) call requestFirstFrameRecovery(source). Safe to
        // call multiple times — short-circuits on firstVisibleFrameReportedRef.
        requestFirstFrameRecoveryRef.current = requestFirstFrameRecovery;
        try {
          console.log('[TRACE][SpineViewer] explicit-first-render-called', { ts: Date.now() });
          shipBattleTrace('[SpineViewer] explicit-first-render-called', {
            battleInit: false,
            isSpineLoaded: true,
            isStage2Loaded: false,
            isStage3Loaded: false,
            isStage4Loaded: false,
            isAssetLoaded: false,
            isCurrentModelRendered: false,
            isReadyForLiveView: false,
          });
          // Single explicit render — the auto-ticker will continue drawing every frame
          // after this, so this is purely a bootstrap trigger.
          app.render();
        } catch (err) {
          console.error('[SpineViewer] explicit first render FAILED', err instanceof Error ? err.message : String(err));
          shipBattleTrace('[SpineViewer] explicit-first-render-FAILED', {
            battleInit: false,
            isSpineLoaded: false,
            isStage2Loaded: false,
            isStage3Loaded: false,
            isStage4Loaded: false,
            isAssetLoaded: false,
            isCurrentModelRendered: false,
            isReadyForLiveView: false,
          });
          // P1-41 REWORK: render throw is a recoverable Stage 1 failure.
          // Route through retryOrFatal — only exhaustion calls onFatalError.
          // P1-42 FIX: cancel watchdog — retryOrFatal schedules a fresh initSpine.
          if (firstFrameWatchdogRef.current !== null) {
            clearTimeout(firstFrameWatchdogRef.current);
            firstFrameWatchdogRef.current = null;
          }
          retryOrFatal('render_throw');
          return;
        }

        // ── P1-43 FINAL: belt-and-suspenders secondary paths ─────────────
        //
        // The PRIMARY recovery signal is `requestFirstFrameRecovery` defined
        // above — it is synchronous and independent of document.visibilityState
        // because `app.render()` is a function call in the current execution
        // context. These secondary paths are kept for the case where the
        // synchronous path's character/stage guard rejects (e.g., character
        // still mounting at this instant). They all route through
        // requestFirstFrameRecovery so the actual confirm path is shared.
        //
        // (1) setTimeout watchdog — last-resort timer.
        firstFrameWatchdogRef.current = setTimeout(() => {
          firstFrameWatchdogRef.current = null;
          requestFirstFrameRecovery('watchdog');
        }, FIRST_FRAME_WATCHDOG_MS);

        // (2) Double-rAF — fires when browser eventually ticks. Even when
        // document.visibilityState is permanently 'hidden', rAF still fires
        // (throttled). When the user touches the screen or focus arrives,
        // rAF resumes normal cadence.
        firstFrameRafRef.current = requestAnimationFrame(() => {
          firstFrameRafRef.current = requestAnimationFrame(() => {
            firstFrameRafRef.current = 0;
            requestFirstFrameRecovery('raf');
          });
        });

        // (3) Pixi ticker callback — fires on next ticker tick. The Pixi v8
        // ticker uses rAF internally, so this is throttled alongside rAF in
        // hidden tabs. We keep it as a third independent channel.
        try {
          const tickerCb = () => {
            requestFirstFrameRecovery('ticker');
            try { app.ticker.remove(tickerCb); } catch { /* ignore */ }
          };
          app.ticker.add(tickerCb);
          // Auto-cleanup after 5s to avoid leaking the callback.
          setTimeout(() => {
            try { app.ticker.remove(tickerCb); } catch { /* ignore */ }
          }, 5000);
        } catch { /* ignore — ticker is best-effort */ }

        // (4) Synchronous direct path — fires immediately if everything is
        // already in place at the moment _triggerExplicitFirstFrame is called.
        requestFirstFrameRecovery('boot');
      };

      _triggerExplicitFirstFrame();

      // ── Responsive resize ──────────────────────────────────────────────────
      const handleResize = () => {
        if (resizeRafRef.current !== null) return;
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = null;
          if (!appRef.current || !containerRef.current) return;

          const newViewW = window.innerWidth;
          const newViewH = window.innerHeight;

          // REPARK 6.0 — P0 2026-07-31: Hard DPR Lock.
          //
          // FIX: Set renderer.resolution BEFORE calling resize(). The previous code
          // called resize() which implicitly uses the old resolution, then only
          // set CSS pixels — leaving the backing buffer at the previous DPR, which
          // causes the canvas to be stretched/blurred when DPR changes (e.g. moving
          // from external monitor to laptop screen, or switching between 1x/2x tabs).
          //
          // Correct order:
          //   1. Set resolution     ← THIS WAS MISSING
          //   2. Call resize()       ← uses the new resolution
          //   3. Set CSS px         ← matches backing buffer exactly
          //
          // image-rendering: pixelated forces nearest-neighbour upscaling, so
          // the WebGL texture pixels snap cleanly rather than bilinear-blur.
          const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
          app.renderer.resolution = dpr;
          app.renderer.resize(newViewW, newViewH);
          app.canvas.style.width  = `${newViewW}px`;
          app.canvas.style.height = `${newViewH}px`;
          (app.canvas as HTMLCanvasElement).style.imageRendering =
            navigator.userAgent.includes('Firefox') ? 'crisp-edges' : 'pixelated';

          // Fit/Contain Protocol (P0 2026-07-26) — Linear scale (no quadratic doubling).
          const fitScale     = Math.min(newViewW / COMMAND_CENTER.DESIGN_W, newViewH / COMMAND_CENTER.DESIGN_H);
          // baseCharScale is a CONSTANT — derived from design reference height only.
          const baseCharScale = (COMMAND_CENTER.DESIGN_H * COMMAND_CENTER.CHARACTER.SCALE_RATIO) / CHARACTER_HEIGHT;
          const newCharScale  = baseCharScale * fitScale * COMMAND_CENTER.FIT_SCALE_MULT;
          // X: explicit viewport center. Y: center + scaled pivot offset.
          const newCharX      = newViewW / 2;
          const newCharY      = (newViewH / 2) + (COMMAND_CENTER.PIVOT_OFFSET_PX * fitScale);
          // Scale-invariant halo Y (FIX P0 2026-07-31) — replaces HALO_RATIO * viewH
          const newHaloY      = newCharY + HALO_BASE_OFFSET_PIXI * (newCharScale / baseCharScale);
          const newBgScale    = Math.max(newViewW / 4165, newViewH / 5840) * 1.1;
          targetScaleRef.current = newCharScale;

          if (bgRef.current) {
            bgRef.current.x = newViewW / 2;
            bgRef.current.y = newViewH / 2;
            (bgRef.current as any).scale?.set(newBgScale);
          }

          if (rootContainerRef.current) {
            rootContainerRef.current.x = newCharX;
            rootContainerRef.current.y = newCharY;
            rootContainerRef.current.scale.set(newCharScale);
          }

          // ── HALO RESIZE — apply via SSOT helper ─────────────────────────────────
          // applyHaloTransform writes both halo.y and halo.scale atomically.
          // haloBaseYRef is no longer needed as intermediate storage (kept for debug
          // compatibility with safelySyncHaloTransform's non-critical logging path).
          if (haloRef.current) {
            haloRef.current.x = newCharX;
            applyHaloTransform(haloRef.current, newCharY, newCharScale, baseCharScale, activeStageIdxRef.current);
          }

          // safelySyncHaloTransform delegates to applyHaloTransform — safe to call.
          safelySyncHaloTransform();
        });
      };
      handleResizeRef.current = handleResize;
      window.addEventListener('resize', handleResize);
    };

    initSpine();

    return () => {
      mounted = false;
      if (rafRef.current)             cancelAnimationFrame(rafRef.current);
      if (firstFrameRafRef.current)   cancelAnimationFrame(firstFrameRafRef.current);
      if (resizeRafRef.current !== null) cancelAnimationFrame(resizeRafRef.current);
      if (handleResizeRef.current)   window.removeEventListener('resize', handleResizeRef.current);

      // FIX P-03 / TC-BT-05: Remove all injected Spine state listeners on unmount.
      // This prevents duplicate handlers from accumulating on remount.
      // Also purges the module-level singleton cache so next mount creates fresh objects.
      for (let i = 0; i < stageListenerRefs.current.length; i++) {
        const listener = stageListenerRefs.current[i];
        const spine = spinesRef.current[i];
        if (listener && spine) {
          try {
            // listener is SpineTrackEntry (has removeListener method) or undefined.
            // Always call state.removeListener() with the object reference; never call
            // listener.removeListener() (wrong API).
            (spine as any).state?.removeListener?.(listener);
          } catch (e) {
            console.warn(`[SpineViewer] Failed to remove listener for Stage ${i}:`, e);
          }
        }
      }
      stageListenerRefs.current = [];
      _stageListenerCache.clear();

      // ── P1-41 REWORK: cancel pending retry + reset retry state on unmount ──────
      // Prevents leaked setTimeout → initSpine() running on dead instance.
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryInFlightRef.current = false;
      stage1RetryCountRef.current = 0;

      // ── P1-42 FIX: cancel pending first-frame watchdog on unmount ──────
      if (firstFrameWatchdogRef.current !== null) {
        clearTimeout(firstFrameWatchdogRef.current);
        firstFrameWatchdogRef.current = null;
      }

      // P1-43 HOTFIX: drop the visibility-recovery closure so the handler
      // cannot accidentally re-fire a stale function on remount.
      requestFirstFrameRecoveryRef.current = null;

      // ── CRITICAL: Full state reset for React 18 Strict Mode double-mount ──────────
      // Use safeDestroy (closure-captured) to ensure Pixi App is destroyed properly.
      // safeDestroy internally handles null targets safely.
      safeDestroy(appRef.current);
      appRef.current = null;
      spinesRef.current = [];
      isInitializingRef.current = false;

      delete (window as Window & { triggerSpineAttack?: unknown }).triggerSpineAttack;
    };
  }, []);

  // ── Pre-warm attack animation ───────────────────────────────────────────────
  // FIX T6: Hardened against residual-slot leak. The previous version fired
  // `attack_a_1` on Track 0 and only cleared Track 0 + restored alpha, which
  // allowed keyframe-baked hand attachments (boob_catch_hand_L/R,
  // catch_hand_R/R2) to remain visible at their default world positions.
  // The clear() path now mirrors the Glitch-Guard sequence:
  //   1) setBonesToSetupPose + setSlotsToSetupPose → drop keyframe-baked state
  //   2) eradicateResidualSlots → null the hand attachments + alpha 0
  //   3) refresh world transform so nulled attachments don't flicker
  //   4) clearTrack(0) + setAnimation(0, idle_1, true) → restore idle loop
  useEffect(() => {
    if (!engineReady) return;
    const character = spinesRef.current[0];
    if (!character) return;

    const animName = 'attack_a_1';
    const skeletonData = (character as any).state?.data?.skeletonData;
    const hasAnim = skeletonData?.animations?.some?.((a: any) => a.name === animName) ?? false;
    if (!hasAnim) { console.warn(`⚔️ [SpinePreWarm] Animation not found — skipping`); return; }

    const origAlpha = (character as any).alpha ?? 1;
    (character as any).alpha = 0;
    character.state.setAnimation(0, animName, false);
    console.debug('[Spine/PreWarm] attack_a_1 set, will clear when complete');

    let cleared = false;
    const clear = () => {
      if (cleared) return;
      cleared = true;
      console.debug('[Spine/PreWarm] clear() running');
      try {
        const skel: any = (character as any).skeleton;
        // Phase 1: drop keyframe-baked slot/bone state (mirrors Glitch Guard)
        skel?.setBonesToSetupPose?.();
        skel?.setSlotsToSetupPose?.();
        // Phase 2: eradicate residual hand attachments (SSOT)
        eradicateResidualSlots(character as unknown as SpineHandle, 'prewarm-clear');
        // Phase 3: refresh world transform so nulled attachments don't flicker
        try {
          if (typeof skel?.updateWorldTransform === 'function') {
            skel.updateWorldTransform(null);
          } else {
            skel?.updateCache?.();
          }
        } catch { skel?.updateCache?.(); }
        // Phase 4: restore idle loop
        // setEmptyAnimation(0, 0) — instantly drain the prewarm animation on
        // its own track so the keyframes are handed back to track 0's idle
        // and the hand attachments get dropped. clearTrack(0) was a trap that
        // left the prewarm's last frame baked into the slot.
        character.state.setEmptyAnimation(0, 0);
        character.state.setAnimation(0, 'idle_1', true);
        (character as any).alpha = origAlpha;
        // Phase 5 (FIX): The idle_1 animation may contain keyframe timelines
        // that re-expose the hand slot attachments after Phase 4 starts playing.
        // We run eradicateResidualSlots one additional time AFTER setAnimation
        // to ensure those re-exposures are suppressed. Without this, the pre-warm
        // leaves the character in a state where idle_1 keyframes can re-show
        // attack_a residuals between the pre-warm completing and the first real
        // attack firing.
        eradicateResidualSlots(character as unknown as SpineHandle, 'prewarm-post-idle');
      } catch { /* unmounted */ }
    };

    const listener = (entry: any) => { if (entry?.animation?.name === animName) clear(); };
    character.state.addListener(listener);
    const fallbackTimer = setTimeout(clear, 1200);

    return () => {
      clearTimeout(fallbackTimer);
      try { character.state.removeListener(listener); } catch { /* noop */ }
      clear();
    };
  // P0 2026-08-26: pre-warm effect gates on stage1Ready (character truly mounted).
  // was: `[engineReady, ...]` — engineReady alone doesn't guarantee character exists.
  }, [stage1Ready, eradicateResidualSlots]);

  // ── A3: Eager parallel preloader — loads ALL stages simultaneously
  // REPARK v7.0 (2026-08-24): Replaces the old sequential requestIdleCallback loop.
  // All 4 stages (0-3) are fetched in parallel from T+0 so the user can switch
  // to any stage the moment the battle UI becomes visible. Each stage fires its
  // onStageNLoaded callback independently; BattleLayout's allStagesLoaded gate
  // opens only when ALL 4 resolve.
  useEffect(() => {
    if (!engineReady) return;

    const preloadAllStages = async () => {
      const spineCore = await import('@esotericsoftware/spine-core').catch(() => null);
      if (!spineCore) return;

      const PIXI = (window as any).PIXI;
      if (!PIXI?.Assets) return;

      const loadStage = async (stageIdx: number): Promise<boolean> => {
        if (stageIdx < 1 || stageIdx >= STAGE_REGISTRY.length) return true;
        const stageInfo = STAGE_REGISTRY[stageIdx];
        const jsonUrl  = `${stageInfo.path}${stageInfo.jsonName}.json`;
        const atlasUrl = `${stageInfo.path}${stageInfo.atlasName}.atlas`;

        try {
          const jsonResponse = await fetchWithTimeout(jsonUrl, {
            rawResponse: true,
            timeoutMs: 0,
          });
          if (!jsonResponse.raw.ok) {
            console.warn(`[Pipeline] Stage ${stageIdx} JSON 404 — skipping (placeholder): ${jsonUrl}`);
            return false;
          }
          const rawJson = await jsonResponse.raw.json();

          const atlasResponse = await fetchWithTimeout(atlasUrl, {
            rawResponse: true,
            timeoutMs: 0,
          });
          if (!atlasResponse.raw.ok) {
            console.warn(`[Pipeline] Stage ${stageIdx} Atlas 404 — skipping (placeholder): ${atlasUrl}`);
            return false;
          }
          const atlasText = await atlasResponse.raw.text();
          const atlasDir  = atlasUrl.substring(0, atlasUrl.lastIndexOf('/') + 1);

          const tempAtlas  = new spineCore.TextureAtlas(atlasText);
          const pageNames  = tempAtlas.pages.map((p: any) => p.name);

          for (const pageName of pageNames) {
            const fullUrl = atlasDir + pageName;
            const pixiTex = await PIXI.Assets.load(fullUrl).catch(() => null);
            if (pixiTex) {
              const { SpineTexture } = await import('@esotericsoftware/spine-pixi-v8').catch(() => ({ SpineTexture: null }));
              if (!SpineTexture) continue;
              const spineTex = SpineTexture.from(pixiTex.source ?? pixiTex);
              const page = tempAtlas.pages.find((p: any) => p.name === pageName);
              if (page) page.setTexture(spineTex);
            } else {
              console.warn(`[Pipeline/Stage${stageIdx}] Failed to load atlas image: ${fullUrl}`);
            }
          }

          rawJson.physics = [];
          if (rawJson.data) rawJson.data.physics = [];

          const atlasLoader  = new spineCore.AtlasAttachmentLoader(tempAtlas);
          const skeletonJson = new spineCore.SkeletonJson(atlasLoader);
          const skeletonData = skeletonJson.readSkeletonData(rawJson);
          (skeletonData as any).physics = [];

          const { Spine } = await import('@esotericsoftware/spine-pixi-v8').catch(() => ({ Spine: null }));
          if (!Spine) return false;

          const stageSpine = new Spine({ skeletonData, autoUpdate: false }) as unknown as SpineHandle;

          const skel: any = (stageSpine as any).skeleton;
          if (skel) {
            skel.physics = [];
            const origUWT = skel.updateWorldTransform.bind(skel);
            skel.updateWorldTransform = (physics: any) => {
              try {
                if (physics == null) return origUWT(null);
                return origUWT(physics);
              } catch { (skel as any).updateCache?.(); }
            };
          }

          (stageSpine as any).x = 0;
          (stageSpine as any).y = stageInfo.yOffset;
          (stageSpine as any).scale.set(1);
          (stageSpine as any).alpha = 0;
          (stageSpine as any).visible = false;
          (stageSpine as any).zIndex = 10;
          (stageSpine as any).autoUpdate = true;

          for (const slot of (stageSpine as any).skeleton?.slots ?? []) {
            if (RESIDUAL_SLOTS.has(slot.data?.name)) {
              slot.color?.set(0, 0, 0, 0);
            }
          }

          try {
            skel.setBonesToSetupPose?.();
            skel.setSlotsToSetupPose?.();
            eradicateResidualSlots(stageSpine as unknown as SpineHandle, 'stage-init');
            if (typeof skel.updateWorldTransform === 'function') {
              try { skel.updateWorldTransform(null); }
              catch { skel.updateCache?.(); }
            } else {
              skel.updateCache?.();
            }
          } catch (initErr) {
            console.warn(`[Pipeline/Stage${stageIdx}] Glitch-guard init failed (non-fatal):`,
              initErr instanceof Error ? initErr.message : initErr);
          }

          stageListenerRefs.current[stageIdx] = (stageSpine as any).state?.addListener?.(_makeGlobalListener(stageIdx));

          const root = rootContainerRef.current;
          if (root) root.addChild(stageSpine as any);
          spinesRef.current[stageIdx] = stageSpine;

          // Fire the appropriate callback (backwards compat + new)
          if (stageIdx === 1) { console.log('[TRACE][SpineViewer] stage2-mounted', { ts: Date.now() }); shipBattleTrace('[SpineViewer] stage2-mounted', { battleInit: false, isSpineLoaded: true, isStage2Loaded: true, isStage3Loaded: false, isStage4Loaded: false, isAssetLoaded: false, isCurrentModelRendered: false, isReadyForLiveView: false }); onStage2LoadedRef.current?.(); }
          if (stageIdx === 2) { console.log('[TRACE][SpineViewer] stage3-mounted', { ts: Date.now() }); shipBattleTrace('[SpineViewer] stage3-mounted', { battleInit: false, isSpineLoaded: true, isStage2Loaded: true, isStage3Loaded: true, isStage4Loaded: false, isAssetLoaded: false, isCurrentModelRendered: false, isReadyForLiveView: false }); onStage3LoadedRef.current?.(); }
          if (stageIdx === 3) { console.log('[TRACE][SpineViewer] stage4-mounted', { ts: Date.now() }); shipBattleTrace('[SpineViewer] stage4-mounted', { battleInit: false, isSpineLoaded: true, isStage2Loaded: true, isStage3Loaded: true, isStage4Loaded: true, isAssetLoaded: false, isCurrentModelRendered: false, isReadyForLiveView: false }); onStage4LoadedRef.current?.(); }

          console.debug(`[Pipeline] Stage ${stageIdx} loaded (${stageInfo.id})`);
          return true;

        } catch (err) {
          console.warn(`[Pipeline] Stage ${stageIdx} (${stageInfo.id}) pre-load failed:`, err instanceof Error ? err.message : err);
          return false;
        }
      };

      // ── PARALLEL: Load stages 1-3 in parallel (stage 0 already loaded in initSpine)
      const results = await Promise.all([
        loadStage(1), // awakening
        loadStage(2), // flame
        loadStage(3), // shadow
      ]);
      console.debug('[Pipeline] All stages resolved:', {
        stage1: results[0], stage2: results[1], stage3: results[2],
      });
    };

    preloadAllStages();
  }, [engineReady]);

  // ── A4: Emergency load — fires when a form-switch targets an unloaded stage.
  // REPARK v7.0 (2026-08-24): Replaces the old silent return.
  // Returns a promise that resolves when the stage is loaded or all retries exhausted.
  const emergencyLoadStage = useCallback(async (targetStageIdx: number): Promise<boolean> => {
    if (targetStageIdx < 1 || targetStageIdx >= STAGE_REGISTRY.length) return true;
    if (spinesRef.current[targetStageIdx]) return true; // already loaded

    console.warn(`[SpineViewer] Emergency load: stage ${targetStageIdx} not ready, attempting retry...`);
    const MAX_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const spineCore = await import('@esotericsoftware/spine-core').catch(() => null);
        if (!spineCore) break;
        const PIXI = (window as any).PIXI;
        if (!PIXI?.Assets) break;

        const stageInfo = STAGE_REGISTRY[targetStageIdx];
        const jsonUrl  = `${stageInfo.path}${stageInfo.jsonName}.json`;
        const atlasUrl = `${stageInfo.path}${stageInfo.atlasName}.atlas`;

        const jsonResponse = await fetchWithTimeout(jsonUrl, { rawResponse: true, timeoutMs: 0 });
        if (!jsonResponse.raw.ok) {
          console.warn(`[SpineViewer] Emergency load attempt ${attempt}: JSON 404`);
          continue;
        }
        const rawJson = await jsonResponse.raw.json();

        const atlasResponse = await fetchWithTimeout(atlasUrl, { rawResponse: true, timeoutMs: 0 });
        if (!atlasResponse.raw.ok) {
          console.warn(`[SpineViewer] Emergency load attempt ${attempt}: Atlas 404`);
          continue;
        }
        const atlasText = await atlasResponse.raw.text();
        const atlasDir  = atlasUrl.substring(0, atlasUrl.lastIndexOf('/') + 1);

        const tempAtlas  = new spineCore.TextureAtlas(atlasText);
        const pageNames  = tempAtlas.pages.map((p: any) => p.name);

        for (const pageName of pageNames) {
          const fullUrl = atlasDir + pageName;
          const pixiTex = await PIXI.Assets.load(fullUrl).catch(() => null);
          if (pixiTex) {
            const { SpineTexture } = await import('@esotericsoftware/spine-pixi-v8').catch(() => ({ SpineTexture: null }));
            if (!SpineTexture) continue;
            const spineTex = SpineTexture.from(pixiTex.source ?? pixiTex);
            const page = tempAtlas.pages.find((p: any) => p.name === pageName);
            if (page) page.setTexture(spineTex);
          }
        }

        rawJson.physics = [];
        if (rawJson.data) rawJson.data.physics = [];
        const atlasLoader  = new spineCore.AtlasAttachmentLoader(tempAtlas);
        const skeletonJson = new spineCore.SkeletonJson(atlasLoader);
        const skeletonData = skeletonJson.readSkeletonData(rawJson);
        (skeletonData as any).physics = [];

        const { Spine } = await import('@esotericsoftware/spine-pixi-v8').catch(() => ({ Spine: null }));
        if (!Spine) continue;

        const stageSpine = new Spine({ skeletonData, autoUpdate: false }) as unknown as SpineHandle;
        const skel: any = (stageSpine as any).skeleton;
        if (skel) {
          skel.physics = [];
          const origUWT = skel.updateWorldTransform.bind(skel);
          skel.updateWorldTransform = (physics: any) => {
            try { return physics == null ? origUWT(null) : origUWT(physics); }
            catch { (skel as any).updateCache?.(); }
          };
        }

        (stageSpine as any).x = 0;
        (stageSpine as any).y = stageInfo.yOffset;
        (stageSpine as any).scale.set(1);
        (stageSpine as any).alpha = 0;
        (stageSpine as any).visible = false;
        (stageSpine as any).zIndex = 10;
        (stageSpine as any).autoUpdate = true;

        for (const slot of (stageSpine as any).skeleton?.slots ?? []) {
          if (RESIDUAL_SLOTS.has(slot.data?.name)) {
            slot.color?.set(0, 0, 0, 0);
          }
        }

        try {
          skel.setBonesToSetupPose?.();
          skel.setSlotsToSetupPose?.();
          eradicateResidualSlots(stageSpine as unknown as SpineHandle, 'emergency-load');
          if (typeof skel.updateWorldTransform === 'function') {
            try { skel.updateWorldTransform(null); }
            catch { skel.updateCache?.(); }
          } else {
            skel.updateCache?.();
          }
        } catch { /* non-fatal */ }

        stageListenerRefs.current[targetStageIdx] = (stageSpine as any).state?.addListener?.(_makeGlobalListener(targetStageIdx));
        const root = rootContainerRef.current;
        if (root) root.addChild(stageSpine as any);
        spinesRef.current[targetStageIdx] = stageSpine;

        console.log(`[SpineViewer] Emergency load SUCCESS: stage ${targetStageIdx} (attempt ${attempt})`);
        return true;

      } catch (err) {
        console.warn(`[SpineViewer] Emergency load attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
      }
    }

    console.error(`[SpineViewer] Emergency load FAILED after ${MAX_RETRIES} retries — stage ${targetStageIdx} unavailable. Current stage retained.`);
    return false;
  }, []);

  // ── A2: Visibility Sovereignty — centralized stage-index-driven enforcer ──────
  // Enforces that ONLY the activeStageIdx spine is visible.
  // 'morphing' state: no visibility forcing — let the crossfade animate naturally.
  //
  // PHASE 7 (T5): also snaps the halo to its anchor for the new stage and
  // forces a PIXI layout recalc. The "halo disappears until window resize"
  // regression was caused by:
  //   1. The crossfade completing without writing halo.y to the new anchor;
  //   2. The halo's PIXI transform cache being stale relative to its position.
  // Both are addressed below — `handleResizeRef.current()` recalculates the
  // baseY + anchor and `dispatchEvent('resize')` is a belt-and-suspenders
  // signal that re-runs any external resize listeners.
  useEffect(() => {
    if (activeStageIdx === -1) return; // morphing in progress — let crossfade run

    for (let i = 0; i < STAGE_REGISTRY.length; i++) {
      const spine = spinesRef.current[i];
      if (!spine) continue;
      const isActive = i === activeStageIdx;
      (spine as any).visible = isActive;
      (spine as any).alpha   = isActive ? 1 : 0;
    }

    // Halo repositioning is handled exclusively by applyHaloTransform in:
    //   - transitionToForm (on form switch, before crossfade)
    //   - handleResize (on window resize)
    //   - safelySyncHaloTransform (called by both above as finalizer)
    // The visibility effect NO LONGER writes halo.y directly — that caused
    // a stale haloBaseYRef to override the correct position after a form switch.
    handleResizeRef.current?.();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('repark:halo-reflow'));
    }
  }, [activeStageIdx]);

  // ── A4: Form Switch Controller — maps FormId → stageIdx via STAGE_REGISTRY
  useEffect(() => {
    if (!engineReady) return;

    // Guard: mid-transition
    if (activeStageIdx === -1) return;

    const targetStageIdx = STAGE_REGISTRY.findIndex(s => s.id === currentForm);
    if (targetStageIdx === -1) return; // Unknown form — no-op

    // No-op: already in target stage
    if (targetStageIdx === activeStageIdx) return;

    // Check if target stage is loaded
    const targetSpine = spinesRef.current[targetStageIdx];
    if (!targetSpine) {
      // Stage not loaded — REPARK v7.0: trigger emergency load with retry
      console.warn(`[SpineViewer] Stage ${targetStageIdx} (${currentForm}) not loaded — triggering emergency load...`);
      emergencyLoadStage(targetStageIdx).then((ok) => {
        if (ok) {
          console.log(`[SpineViewer] Emergency load succeeded — triggering form switch to stage ${targetStageIdx}`);
          transitionToFormRef.current?.(targetStageIdx);
        } else {
          console.error(`[SpineViewer] Form switch to ${currentForm} FAILED — stage ${targetStageIdx} unavailable.`);
        }
      });
      return;
    }

    transitionToFormRef.current?.(targetStageIdx);
  }, [currentForm, engineReady, activeStageIdx, emergencyLoadStage]);

  // Fallback mask
  // P0 2026-08-26: Fallback shows when Stage 1 Character is not truly ready.
  // P0 2026-08-26: was `hasSpineError || !assetsLoaded || !engineReady`
  // — assetsLoaded was set on ANY layer success (BG/Halo), causing false positives.
  // — now gated on stage1Ready (characterSpine !== null confirmed by PIXI render).
  const showFallback = hasSpineError || !stage1Ready || !engineReady;

  // ── canTrigger — Atomic Action Guard ──────────────────────────────────────────
  const canTrigger = useCallback((): boolean => {
    return !animationLockRef.current;
  }, []);

  // ── Expose triggerAttack + forceResetAllModels ─────────────────────────────
  useImperativeHandle(ref, () => ({
    triggerAttack,
    canTrigger,
    forceResetAllModels,
  }), [triggerAttack, canTrigger, forceResetAllModels]);

  return (
    // CHARACTER_CLICK_HITAREA_FIX:
    // The root div is now pointer-events: AUTO so the PIXI canvas (a
    // direct child) receives pointer events. All overlay siblings below
    // MUST be pointer-events: none so they don't block clicks — they
    // remain visual-only (loading flashes, grain, ambient auras).
    <div className="fixed inset-0 w-full h-full" ref={containerRef}>

      {/* GLASS PLATE FIX: z-[40] interaction overlay, bounded to character body area.
          Sits above the PIXI canvas (z-0) but below the HUD layer (z-[100]).
          Native DOM pointer handling — no PIXI hit testing required.
          Cursor changes on hover for immediate visual feedback. */}
      <div
        className="absolute top-[15%] bottom-[25%] left-[25%] right-[25%] z-[40] cursor-pointer"
        style={{ pointerEvents: 'auto' }}
        onClick={(e) => {
          e.stopPropagation();
          onCharacterClick?.(activeStageIdx);
        }}
      />

      {/* Fallback mask — P0 FALLBACK VISIBILITY FIX:
          Replaced weak grayscale+opacity-50 <img> with SuccubusSilhouette component.
          SuccubusSilhouette uses brightness(0) + purple/pink drop-shadow glow + float animation
          + pulsing rings — matching the designed Phase 1 silhouette aesthetic.
          Explicit z-[25] ensures silhouette renders above PIXI canvas (z-0).
          pointer-events-none keeps it non-interactive. */}
      {showFallback && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[25]">
          <SuccubusSilhouette size={280} />
        </div>
      )}

      <div className="absolute inset-0" style={{ zIndex: 0 }} />

      <AnimatePresence>
        {stage1Ready && (
          <motion.div
            key="spine-ready"
            initial={{ opacity: 0, filter: 'blur(12px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
            className="absolute inset-0 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Ambient auras */}
      <div
        className="absolute bottom-[14%] left-1/2 -translate-x-1/2 w-[220px] h-[44px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 100%, rgba(155,92,255,0.18) 0%, transparent 70%)',
          filter: 'blur(10px)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 80%, rgba(155,92,255,0.07) 0%, transparent 50%)',
        }}
      />

      {/* Grain overlay */}
      <svg
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          pointerEvents: 'none', zIndex: 5,
          mixBlendMode: 'overlay', opacity: 0.035,
        }}
      >
        <filter id="grain-filter">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain-filter)" />
      </svg>

      {/* Bottom gradient mask */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          height: '20%',
          background: 'linear-gradient(to top, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.12) 60%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 6,
        }}
      />

      <style jsx>{`
        @keyframes spineOrbPulse {
          0%, 100% { opacity: 0.7; transform: scale(0.95); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes spineDotBlink {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes spineDotPulse {
          0%, 100% { transform: scale(0.6); opacity: 0.4; }
          50% { transform: scale(1.2); opacity: 1; }
        }
        @keyframes spineFlash {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes spineFallbackFlash {
          0%   { opacity: 0; transform: scale(0.6); }
          20%  { opacity: 1; transform: scale(1.1); }
          100% { opacity: 0; transform: scale(1.4); }
        }
        @keyframes spineFallbackShake {
          0%   { transform: translateX(0)    translateY(0); }
          10%  { transform: translateX(-8px) translateY(4px); }
          20%  { transform: translateX(8px)  translateY(-4px); }
          30%  { transform: translateX(-6px) translateY(3px); }
          40%  { transform: translateX(6px)  translateY(-3px); }
          50%  { transform: translateX(-4px) translateY(2px); }
          60%  { transform: translateX(4px)  translateY(-2px); }
          70%  { transform: translateX(-2px) translateY(1px); }
          80%  { transform: translateX(2px)  translateY(-1px); }
          100% { transform: translateX(0)    translateY(0); }
        }
      `}</style>
    </div>
  );
});

// ── SSR-safe export ───────────────────────────────────────────────────────────
_SpineViewerWithDisplayName.displayName = 'SpineViewerInner';

export const SpineViewer = dynamic(
  () => Promise.resolve({ default: _SpineViewerWithDisplayName }),
  { ssr: false }
);
