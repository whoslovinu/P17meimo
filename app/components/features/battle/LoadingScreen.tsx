'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { ChevronLeft, RefreshCw, AlertTriangle } from 'lucide-react';
import { SuccubusSilhouette } from './SuccubusSilhouette';
// V3 PHASE 1 — loadSpineAssets now routes through the shared resource loader.
// Same JSON/atlas/PNG pages are ALSO requested by SpineViewer; the loader
// guarantees one underlying acquisition per normalized URL regardless of
// how many callers race. The previous direct fetchWithTimeout chain was a
// SECOND acquisition path that the loader replaces.
import { ensure as ensureResource, logDiagnosticsTable } from './battleResourceLoader';
import { shipBattleTrace } from './battleTraceShipper';
import { shipDiag } from '@/app/lib/diagShipper';

interface LoadingStage {
  progress: number;
  label: string;
  delayRange: [number, number];
}

const LOADING_STAGES: LoadingStage[] = [
  { progress: 8,  label: '初始化渲染引擎…',    delayRange: [280, 550] },
  { progress: 20, label: '加载角色纹理…',    delayRange: [280, 550] },
  { progress: 38, label: '解析骨骼与网格数据…', delayRange: [280, 550] },
  { progress: 54, label: '加载纹理贴图…',       delayRange: [280, 550] },
  { progress: 78, label: '加载纹理贴图…',       delayRange: [280, 550] },
  { progress: 88, label: '绑定动作序列…',        delayRange: [280, 550] },
  { progress: 95, label: '加载背景资源…',        delayRange: [280, 550] },
  { progress: 100,label: '加载完成！',           delayRange: [0, 0] },
];

const WATCHDOG_TIMEOUT_MS = 15000;
const TRANSITION_DELAY_MS = 480;
const STORAGE_KEY = 'hasLoadedSpine';
const MIN_LOADING_TIME_MS = 2000;
const ASSET_LOAD_TIMEOUT_MS = 12000;

interface LoadingScreenProps {
  onComplete: (error?: boolean) => void;
  onForceEnter?: () => void;
  onTimeout?: () => void;
  /**
   * P1-43 HOTFIX: dedicated back-navigation handler. LoadingScreen owns the
   * z-9999 overlay, so the TopNav back button (z-100) is unreachable while
   * this screen is mounted. We render the back affordance inside the overlay
   * AND inside the timeout screen, and route the click through this prop so
   * BattleLayout's safe-fallback (backUrl → mainStationHomeUrl) runs.
   */
  onBack?: () => void;
  isAssetLoaded?: boolean;
  /**
   * P0 2026-08-25: Real Ready Gate.
   *
   * When true, the WebGL canvas has rendered its first frame (SpineViewer
   * wired app.renderer.on('afterrender', ...) → parent sets this).
   *
   * LoadingScreen WILL NOT dismiss via the normal 100% path until this
   * flips true. If the fake timer reaches stage 100 before this fires,
   * we reschedule ourselves until it does. forceEnter is also gated
   * by this signal — you cannot bypass into an empty battle.
   *
   * Defaults to true to preserve existing behavior for any caller that
   * does not opt in (BattleLayout passes false until ready).
   */
  isCanvasRendered?: boolean;
  /**
   * P0 2026-08-26: Set to true when Stage 1 character failed to mount
   * (characterSpine === null). Used to distinguish "角色资源加载失败" from
   * a generic network timeout in the error UI.
   */
  isStage1Failed?: boolean;
}

function randomDelay(range: [number, number]): number {
  return Math.random() * (range[1] - range[0]) + range[0];
}

function loadSpineAssets(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Spine asset load timeout'));
    }, ASSET_LOAD_TIMEOUT_MS);

    let resolved = false;
    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      ok ? resolve() : reject(new Error('Spine asset load failed'));
    };

    // V3 PHASE 1 — every acquisition now flows through BattleResourceLoader.
    // The loader handles IDB cache + network + single-flight, so this function
    // no longer needs to call fetchWithTimeout directly. Static Spine assets
    // are large (1–5MB) so timeoutMs=0 is preserved — Loader inherits the
    // value. LoadingScreen's outer timeout still surfaces via onTimeout.
    (async () => {
      try {
        // 1. JSON — pre-warm the loader so SpineViewer's later request hits
        //    the in-flight cache instead of triggering a fresh fetch.
        const jsonRes = await ensureResource('/H501/idle_01/idle_1.json?v=1', { timeoutMs: 0 });
        if (jsonRes.blob.size === 0) { finish(false); return; }

        // 2. Atlas — actually consumed (page-name parsing below).
        const atlasRes = await ensureResource('/H501/idle_01/idle_1.atlas?v=1', { timeoutMs: 0 });
        if (atlasRes.blob.size === 0) { finish(false); return; }
        const atlasText = await atlasRes.blob.text();

        const pageNames: string[] = [];
        for (const line of atlasText.split('\n')) {
          const match = line.match(/^(\S+\.png)\s*$/i);
          if (match) pageNames.push(match[1]);
        }
        if (pageNames.length === 0) { finish(false); return; }

        // 3. Atlas PNG pages — also pre-warmed for SpineViewer.
        const base = '/H501/idle_01/';
        const pageResults = await Promise.all(
          pageNames.map((name) => ensureResource(`${base}${name}?v=1`, { timeoutMs: 0 }))
        );
        if (pageResults.some((r) => r.blob.size === 0)) { finish(false); return; }

        finish(true);
      } catch {
        finish(false);
      }
    })();
  });
}

export function LoadingScreen({ onComplete, onForceEnter, onTimeout, onBack, isAssetLoaded = false, isCanvasRendered = true, isStage1Failed = false }: LoadingScreenProps) {
  const [currentStage, setCurrentStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const [isGone, setIsGone] = useState(false);
  const [isTimeout, setIsTimeout] = useState(false);
  const [displayPercent, setDisplayPercent] = useState(0);

  const progressSpring = useSpring(0, { stiffness: 100, damping: 20, bounce: 0, restDelta: 0.01 });
  const progressBarWidth = useTransform(progressSpring, [0, 100], ['0%', '100%']);

  const hydratedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const hasCompletedRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedProgressRef = useRef({ stage: 0, progress: 0 });
  const loadingStartRef = useRef<number>(0);
  const resumeFromSavedRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    const unsub = progressSpring.on('change', (v: number) => {
      setDisplayPercent(Math.round(v));
    });
    return unsub;
  }, [progressSpring]);

  useEffect(() => {
    const clamped = Math.min(100, Math.max(0, progress));
    const current = progressSpring.get();
    progressSpring.set(Math.max(current, clamped));
  }, [progress, progressSpring]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    };
  }, []);

  const startWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = setTimeout(() => {
      if (mountedRef.current && !hasCompletedRef.current && savedProgressRef.current.progress < 100) {
        setIsTimeout(true);
        onTimeout?.();
      }
    }, WATCHDOG_TIMEOUT_MS);
  }, [onTimeout]);

  const advance = useCallback((stageIdx: number) => {
    if (!mountedRef.current || hasCompletedRef.current) return;
    if (loadingStartRef.current === 0) {
      loadingStartRef.current = Date.now();
    }

    const stage = LOADING_STAGES[stageIdx];
    if (!stage) return;

    setCurrentStage(stageIdx);
    setProgress(stage.progress);
    savedProgressRef.current = { stage: stageIdx, progress: stage.progress };

    if (stage.progress === 100) {
      // P0 2026-08-25: Real Ready Gate — do NOT dismiss LoadingScreen
      // until PIXI confirms a rendered frame. The fake timer may reach
      // 100% before the renderer has drawn anything (race condition
      // between asset fetch completion and GPU upload + first frame).
      // If isCanvasRendered is still false, reschedule ourselves in a
      // short polling interval until it flips. LoadingScreen never
      // unmounts over a blank canvas.
      console.log('[TRACE][LoadingScreen] progress=100', { ts: Date.now(), isCanvasRendered });
      shipBattleTrace('[LoadingScreen] progress=100', {
        battleInit: false,
        isSpineLoaded: isAssetLoaded,
        isStage2Loaded: isAssetLoaded,
        isStage3Loaded: isAssetLoaded,
        isStage4Loaded: isAssetLoaded,
        isAssetLoaded,
        isCurrentModelRendered: isCanvasRendered,
        isReadyForLiveView: isAssetLoaded && isCanvasRendered,
      });
      if (!isCanvasRendered) {
        console.warn('[TRACE][LoadingScreen] dismiss-blocked-no-canvas', { ts: Date.now() });
        shipBattleTrace('[LoadingScreen] dismiss-blocked-no-canvas', {
          battleInit: false,
          isSpineLoaded: isAssetLoaded,
          isStage2Loaded: isAssetLoaded,
          isStage3Loaded: isAssetLoaded,
          isStage4Loaded: isAssetLoaded,
          isAssetLoaded,
          isCurrentModelRendered: isCanvasRendered,
          isReadyForLiveView: isAssetLoaded && isCanvasRendered,
        });
        timerRef.current = setTimeout(() => advance(stageIdx), 200);
        return;
      }

      timerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        const elapsedTime = Date.now() - loadingStartRef.current;
        const remainingTime = Math.max(0, MIN_LOADING_TIME_MS - elapsedTime);
        timerRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          console.log('[TRACE][LoadingScreen] exit-start', { ts: Date.now() });
          shipBattleTrace('[LoadingScreen] exit-start', {
            battleInit: false,
            isSpineLoaded: isAssetLoaded,
            isStage2Loaded: isAssetLoaded,
            isStage3Loaded: isAssetLoaded,
            isStage4Loaded: isAssetLoaded,
            isAssetLoaded,
            isCurrentModelRendered: isCanvasRendered,
            isReadyForLiveView: isAssetLoaded && isCanvasRendered,
          });
          setIsExiting(true);
          timerRef.current = setTimeout(() => {
            if (!mountedRef.current) return;
            sessionStorage.setItem(STORAGE_KEY, 'true');
            hasCompletedRef.current = true;
            console.log('[TRACE][LoadingScreen] gone=true', { ts: Date.now() });
            shipBattleTrace('[LoadingScreen] gone=true', {
              battleInit: false,
              isSpineLoaded: isAssetLoaded,
              isStage2Loaded: isAssetLoaded,
              isStage3Loaded: isAssetLoaded,
              isStage4Loaded: isAssetLoaded,
              isAssetLoaded,
              isCurrentModelRendered: isCanvasRendered,
              isReadyForLiveView: isAssetLoaded && isCanvasRendered,
            });
            setIsGone(true);
            // P1-43 FINAL: dedicated semantic event proving the loading
            // screen dismissed. Pairs with [P1-43] first-frame-confirmed
            // from SpineViewer so we can correlate recovery path → outcome.
            try {
              shipDiag('stage1-trace', 'info',
                `[P1-43] loading-dismissed ts=${Date.now()}` +
                (typeof document !== 'undefined' ? ` visibilityState=${document.visibilityState}` : ''));
            } catch { /* swallow */ }
            console.log('[TRACE][LoadingScreen] onComplete', { ts: Date.now() });
            shipBattleTrace('[LoadingScreen] onComplete', {
              battleInit: false,
              isSpineLoaded: isAssetLoaded,
              isStage2Loaded: isAssetLoaded,
              isStage3Loaded: isAssetLoaded,
              isStage4Loaded: isAssetLoaded,
              isAssetLoaded,
              isCurrentModelRendered: isCanvasRendered,
              isReadyForLiveView: isAssetLoaded && isCanvasRendered,
            });
            onComplete();
          }, TRANSITION_DELAY_MS);
        }, remainingTime);
      }, TRANSITION_DELAY_MS);
      return;
    }

    const delay = randomDelay(stage.delayRange);
    timerRef.current = setTimeout(() => advance(stageIdx + 1), delay);
  }, [onComplete]);

  const resumeFromSaved = useCallback(() => {
    if (hasCompletedRef.current || isTimeout) return;
    const { stage, progress: savedProgress } = savedProgressRef.current;
    setCurrentStage(stage);
    setProgress(savedProgress);
    const delay = randomDelay([200, 400]);
    timerRef.current = setTimeout(() => advance(stage + 1), delay);
  }, [advance, isTimeout]);

  resumeFromSavedRef.current = resumeFromSaved;

  useEffect(() => {
    if (!isAssetLoaded || hasCompletedRef.current || isExiting) return;

    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }

    const targetStageIdx = LOADING_STAGES.findIndex((s) => s.progress === 100);
    if (targetStageIdx === -1) return;

    progressSpring.set(100);
    setCurrentStage(targetStageIdx);
    setProgress(100);
    savedProgressRef.current = { stage: targetStageIdx, progress: 100 };

    timerRef.current = setTimeout(() => {
      if (!mountedRef.current || hasCompletedRef.current) return;
      advance(targetStageIdx);
    }, 100);
  }, [advance, isAssetLoaded, isExiting, progressSpring]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (watchdogRef.current) clearTimeout(watchdogRef.current);
        if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
      } else {
        if (!hasCompletedRef.current && !isExiting && !isTimeout) {
          resumeFromSavedRef.current?.();
        }
        if (!isTimeout && !hasCompletedRef.current) {
          if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = setTimeout(() => {
            if (mountedRef.current && !hasCompletedRef.current) {
              setIsTimeout(true);
              onTimeout?.();
            }
          }, WATCHDOG_TIMEOUT_MS);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isExiting, isTimeout, onTimeout]);

  useEffect(() => {
    if (isExiting || hasCompletedRef.current) return;

    startWatchdog();
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    timeoutTimerRef.current = setTimeout(() => {
      if (mountedRef.current && !hasCompletedRef.current) {
        setIsTimeout(true);
        onTimeout?.();
      }
    }, WATCHDOG_TIMEOUT_MS);

    loadSpineAssets()
      .then(() => {
        // V3 PHASE 1 — dev-only diagnostic dump.
        // In dev mode this prints the per-URL network/cache/resolve counts
        // so QA can verify networkStarts <= 1 per normalized URL. No-op in
        // production builds (the helper short-circuits on NODE_ENV).
        logDiagnosticsTable('LoadingScreen loadSpineAssets complete');
      })
      .catch(() => {
        console.error('[LoadingScreen] Spine asset fetch failed during loading validation');
      });

    timerRef.current = setTimeout(() => advance(0), 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
    };
  }, [advance, isExiting, onTimeout, startWatchdog]);

  const handleRetry = () => {
    hasCompletedRef.current = false;
    setIsTimeout(false);
    setIsExiting(false);
    setCurrentStage(0);
    setProgress(0);
    savedProgressRef.current = { stage: 0, progress: 0 };
    loadingStartRef.current = 0;
    progressSpring.set(0);
  };

  const handleExit = (withError = false) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);

    if (withError && onForceEnter) {
      // P0 2026-08-25: Real Ready Gate — block forceEnter into blank canvas.
      // The user may click "仍然进入" during the timeout screen even when
      // the WebGL canvas has never rendered. Forcing past this point drops
      // them into an empty battle (the exact P0 symptom). We refuse the
      // bypass unless PIXI has already drawn a frame.
      if (!isCanvasRendered) {
        console.warn('[LoadingScreen] forceEnter BLOCKED — canvas has no confirmed render. Will not dismiss into empty battle.');
        return;
      }
      onForceEnter();
      return;
    }

    sessionStorage.setItem(STORAGE_KEY, 'true');
    onComplete(withError);
  };

  // P1-43 HOTFIX: dedicated back handler that fires regardless of canvas /
  // loading / retry state. Routing through `onBack` lets BattleLayout decide
  // the safe target (backUrl → mainStationHomeUrl) without LoadingScreen
  // inventing a route. Falls back to a hard `window.history.length` check
  // so users who arrived with a deep-link still have an escape route even
  // when the parent forgot to wire `onBack`.
  const handleBack = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);

    if (onBack) {
      try {
        onBack();
        return;
      } catch { /* fall through to local fallback */ }
    }

    // Local fallback — keep the user moving even if the parent did not
    // wire onBack. Prefer history.back() (true "back"), else navigate to "/".
    try {
      if (typeof window !== 'undefined' && window.history && window.history.length > 1) {
        window.history.back();
      } else if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    } catch { /* swallow */ }
  };

  if (!hydratedRef.current) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
        style={{ background: 'linear-gradient(180deg, #030306 0%, #050510 50%, #030306 100%)' }}
      />
    );
  }

  if (isGone) return null;

  const stage = LOADING_STAGES[currentStage];

  if (isTimeout) {
    // P0 2026-08-26: Distinguish Stage 1 character failure from generic timeout.
    // Both surfaces the same screen but with different copy so users know what failed.
    const isCharacterFailure = isStage1Failed;
    return (
      <div
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
        style={{
          background: 'linear-gradient(180deg, #030306 0%, #050510 50%, #030306 100%)',
          opacity: isExiting ? 0 : 1,
          transition: 'opacity 0.3s ease-out',
        }}
      >
        {/* P1-43 HOTFIX: back affordance on the timeout screen. Without this,
            users hitting the 15s watchdog have no escape route — the z-9999
            overlay covers the TopNav back button, and the only buttons here
            were 仍然进入 / 重试. */}
        <button
          onClick={handleBack}
          aria-label="返回"
          className="absolute top-4 left-4 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 border border-white/20 backdrop-blur-xl hover:bg-white/20 active:bg-white/30 active:scale-90 transition-all duration-150 cursor-pointer z-20"
        >
          <ChevronLeft size={18} className="text-white/90" />
        </button>
        <div className="flex flex-col items-center gap-6">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <AlertTriangle size={28} className="text-red-400" />
          </div>
          <div className="text-center">
            {isCharacterFailure ? (
              <>
                <h2 className="text-white text-base font-medium mb-2">角色资源加载失败</h2>
                <p className="text-white/40 text-sm">Stage 1 角色模型纹理加载失败，请检查网络后重试</p>
              </>
            ) : (
              <>
                <h2 className="text-white text-base font-medium mb-2">网络加载超时</h2>
                <p className="text-white/40 text-sm">加载时间过长，请检查网络后重试</p>
              </>
            )}
          </div>
          <div className="flex flex-col gap-3 w-56">
            <button
              onClick={() => handleExit(true)}
              className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium text-base bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:opacity-90 active:scale-95 transition-all cursor-pointer shadow-lg shadow-purple-500/30"
            >
              <span>仍然进入</span>
            </button>
            <button
              // P1-43 HOTFIX: the previous handleRetry only reset LoadingScreen
              // local state and left the Spine first-frame chain broken. A real
              // recovery requires a fresh page mount, so reload the document.
              onClick={() => {
                try { window.location.reload(); } catch { /* swallow */ }
              }}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-white/10 border border-white/20 text-white/70 hover:bg-white/20 active:scale-95 transition-all cursor-pointer"
            >
              <RefreshCw size={16} />
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #030306 0%, #050510 50%, #030306 100%)',
        opacity: isExiting ? 0 : 1,
        transition: isExiting ? 'opacity 0.3s ease-out, pointer-events 0s 0.3s' : 'opacity 0s',
        pointerEvents: isExiting ? 'none' : 'auto',
      }}
    >
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div style={{ position: 'absolute', top: '15%', left: '20%', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(168,85,247,0.18) 0%, transparent 65%)', borderRadius: '50%', filter: 'blur(100px)', animation: 'breatheOrb 4s ease-in-out infinite', transformOrigin: '60% 40%' }} />
        <div style={{ position: 'absolute', bottom: '10%', right: '15%', width: '500px', height: '500px', background: 'radial-gradient(circle, rgba(236,72,153,0.15) 0%, transparent 65%)', borderRadius: '50%', filter: 'blur(100px)', animation: 'breatheOrb 4s ease-in-out infinite 2s', transformOrigin: '40% 60%' }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(100,50,200,0.08) 0%, transparent 60%)', filter: 'blur(60px)', animation: 'breatheOrb 4s ease-in-out infinite 1s', transformOrigin: '50% 50%' }} />
      </div>

      <button
        onClick={handleBack}
        aria-label="返回"
        className="absolute top-4 left-4 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 border border-white/20 backdrop-blur-xl hover:bg-white/20 active:bg-white/30 active:scale-90 transition-all duration-150 cursor-pointer z-20"
      >
        <ChevronLeft size={18} className="text-white/90" />
      </button>

      <p
        className="absolute top-5 left-1/2 -translate-x-1/2 text-sm font-bold tracking-widest z-20"
        style={{
          background: 'linear-gradient(90deg, #A855F7, #EC4899)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        ⚡ MEIMODU
      </p>

      <div className="relative mb-10">
        <SuccubusSilhouette size={175} />
      </div>

      <h1 className="text-base font-medium tracking-widest mb-10 text-white/80" style={{ letterSpacing: '0.2em' }}>
        魅魔来袭，召唤挑战
      </h1>

      <div className="relative w-56 mb-6">
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <motion.div
            className="h-full rounded-full relative overflow-hidden"
            style={{
              width: progressBarWidth,
              background: 'linear-gradient(90deg, #A855F7 0%, #EC4899 100%)',
              boxShadow: '0 0 12px rgba(168,85,247,0.6)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: '-40%',
                width: '30%',
                height: '100%',
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                animation: 'sweep 1.5s linear infinite',
              }}
            />
          </motion.div>
        </div>
      </div>

      <div className="text-center mb-3" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '11px', color: 'rgba(200,180,255,0.6)' }}>
        {displayPercent}%
      </div>

      <div className="text-center" style={{ fontSize: '11px', color: 'rgba(180,160,220,0.45)', letterSpacing: '0.1em' }}>
        {stage?.label ?? '初始化中…'}
      </div>

      <div className="flex items-center gap-1.5 mt-6">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: 'linear-gradient(90deg, #A855F7, #EC4899)',
              boxShadow: '0 0 6px rgba(168,85,247,0.6)',
              animation: 'dotPulse 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>

      <div className="absolute bottom-10 flex justify-center w-full">
        <button
          onClick={() => window.location.reload()}
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-white/10 border border-white/20 text-white/80 hover:bg-white/20 active:scale-95 transition-all cursor-pointer"
        >
          <RefreshCw size={16} />
          <span>重试 / Retry</span>
        </button>
      </div>

      <style>{`
        @keyframes breatheOrb {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50% { transform: scale(1.1); opacity: 1; }
        }
        @keyframes sweep {
          0% { left: -40%; }
          100% { left: 120%; }
        }
        @keyframes dotPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.7); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
