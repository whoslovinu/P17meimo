'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useRewardStore } from '@/lib/rewardStore';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Shanghai';

export function nowUtc8() { return dayjs().tz(TZ); }
export function ts(day: string | Date | number) { return dayjs(day).tz(TZ); }

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BannerItem {
  id: string;
  imageUrl: string;
  targetActivityId: string | null;
  activityName: string | null;
  sortWeight: number;
  isEnabled: boolean;
  showCountdown: boolean;
  activityStatus?: 'upcoming' | 'active' | 'ended';
  /** ISO timestamp — TC-BN-10 */
  startTime?: string;
  /** ISO timestamp — TC-BN-09 */
  endTime?: string;
}

export interface CarouselConfig {
  isCarouselEnabled: boolean;
  carouselInterval: number;
}

// ── Status ────────────────────────────────────────────────────────────────────

type BannerStatus = 'upcoming' | 'active' | 'ended';

function getBannerStatus(banner: BannerItem): BannerStatus {
  if (banner.activityStatus) return banner.activityStatus;
  // TC-BN-09 / TC-BN-14: use dayjs.tz for consistent UTC+8 time boundaries
  const now = nowUtc8();
  if (banner.startTime) {
    const start = ts(banner.startTime);
    if (now.isBefore(start)) return 'upcoming';
  }
  if (!banner.endTime) return 'active';
  const end = ts(banner.endTime);
  return now.isAfter(end) ? 'ended' : 'active';
}

// ── Countdown ────────────────────────────────────────────────────────────────

function useCountdown(endTime: string | undefined) {
  const [label, setLabel] = useState<string>('');

  useEffect(() => {
    if (!endTime) { setLabel(''); return; }

    const tick = () => {
      // TC-BN-09: always derive from UTC+8
      const now = nowUtc8();
      const end = ts(endTime);
      const diff = end.diff(now, 'second', true);

      if (diff <= 0) { setLabel('00:00:00'); return; }

      const totalSec = Math.floor(diff);
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;

      if (d > 0) {
        setLabel(`${d}天 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
      } else {
        setLabel(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  return label;
}

// ── Badge V3 — framer-motion badgePulse ────────────────────────────────────────

// TC-BN-02: framer-motion 2s breathing pulse. Placed OUTSIDE overflow:hidden.
function ClaimBadge() {
  return (
    <div
      className="absolute -top-0.5 right-2 z-10 flex items-center pointer-events-none"
      aria-label="有可领取奖励"
    >
      <motion.div
        animate={{
          scale: [1, 1.22, 1.12, 1],
          opacity: [1, 1, 0.82, 1],
        }}
        transition={{
          duration: 2,
          ease: 'easeInOut',
          repeat: Infinity,
          times: [0, 0.10, 0.35, 1],
        }}
        style={{
          background: '#FF2D87',
          color: 'white',
          fontSize: 9,
          fontWeight: 800,
          padding: '2px 7px 2px 8px',
          borderRadius: '4px 0 0 4px',
          lineHeight: 1.4,
          letterSpacing: '0.6px',
          boxShadow:
            '0 0 4px #FF2D87, ' +
            '0 0 16px rgba(255,45,135,0.6), ' +
            'inset 0 1px 0 rgba(255,255,255,0.3)',
          border: '1px solid rgba(255,100,150,0.4)',
        }}
      >
        可领取
      </motion.div>

      <div
        aria-hidden
        style={{
          width: 0,
          height: 0,
          borderTop: '5px solid transparent',
          borderBottom: '5px solid transparent',
          borderLeft: '6px solid #FF2D87',
          boxShadow: '2px 0 6px rgba(255,45,135,0.4)',
        }}
      />
    </div>
  );
}

// ── Dot indicators ─────────────────────────────────────────────────────────────

function DotIndicator({
  count,
  active,
  onClick,
}: {
  count: number;
  active: number;
  onClick: (i: number) => void;
}) {
  if (count <= 1) return null;
  return (
    <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
      {Array.from({ length: count }).map((_, i) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); onClick(i); }}
          className="cursor-pointer rounded-full transition-all duration-200"
          style={{
            width: i === active ? 14 : 6,
            height: i === active ? 4 : 3,
            background: i === active ? '#FF2D87' : 'rgba(255,255,255,0.25)',
            boxShadow: i === active ? '0 0 6px rgba(255,45,135,0.7)' : 'none',
            border: 'none',
            padding: 0,
          }}
          aria-label={`Go to banner ${i + 1}`}
        />
      ))}
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

// TC-BN-06: shown while parent is fetching data.
function BannerSkeleton() {
  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden"
      style={{
        height: 84,
        background: 'linear-gradient(135deg, #1A1225 0%, #1E0E1E 100%)',
        border: '2px solid #FF2D87',
        borderRadius: 14,
        boxShadow: '0 0 24px rgba(255,45,135,0.35)',
      }}
    >
      <div className="absolute inset-0 flex items-center gap-3 px-4">
        <div
          className="flex-shrink-0 rounded-xl animate-pulse"
          style={{ width: 44, height: 44, background: 'rgba(255,107,53,0.2)' }}
        />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 rounded animate-pulse" style={{ width: '60%', background: 'rgba(240,232,255,0.1)' }} />
          <div className="h-2 rounded animate-pulse" style={{ width: '35%', background: 'rgba(255,255,255,0.06)' }} />
        </div>
        <div
          className="flex-shrink-0 rounded-xl animate-pulse"
          style={{ width: 60, height: 44, background: 'rgba(255,45,135,0.15)' }}
        />
      </div>
    </div>
  );
}

// ── Banner card (single slide) ────────────────────────────────────────────────

function BannerCard({
  banner,
  onTap,
  didDragRef,
}: {
  banner: BannerItem;
  onTap: () => void;
  /** TC-BN-04/15: outer drag controller sets this when the gesture was a
   *  drag (not a tap). When true, swallow the pointerup that would otherwise
   *  count as a tap. */
  didDragRef: React.MutableRefObject<boolean>;
}) {
  const status = getBannerStatus(banner);
  // TC-BN-09: countdown only when active AND endTime exists
  const countdown = useCountdown(status === 'active' ? banner.endTime : undefined);
  const showControls = banner.showCountdown && status !== 'ended';

  const countdownLabel =
    status === 'upcoming' ? '即将开始'
    : status === 'ended' ? ''
    : countdown || '';

  // TC-BN-04 + TC-BN-15: distinguish tap from drag.
  // Browsers fire `click` after mouseup on every pointer interaction, including
  // the end of a horizontal drag — so naively wiring onClick to navigation
  // makes every swipe accidentally navigate. Track pointerdown coords and
  // only fire onTap when the pointer barely moved and was quick.
  const downPosRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const TAP_MAX_MOVE = 8;       // px
  const TAP_MAX_DURATION = 500; // ms

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    downPosRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const start = downPosRef.current;
    downPosRef.current = null;
    if (!start) return;
    // TC-BN-04/15: if the outer framer-motion drag handler already classified
    // this gesture as a drag, ignore it here.
    if (didDragRef.current) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    const dur = Date.now() - start.t;
    if (dist <= TAP_MAX_MOVE && dur <= TAP_MAX_DURATION) {
      onTap();
    }
  }, [onTap, didDragRef]);

  const handlePointerCancel = useCallback(() => {
    downPosRef.current = null;
  }, []);

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className="relative w-full cursor-pointer select-none"
      style={{
        height: 84,
        background: 'linear-gradient(135deg, #1A1225 0%, #1E0E1E 100%)',
        border: '2px solid #FF2D87',
        borderRadius: 14,
        boxShadow: '0 0 24px rgba(255,45,135,0.35), inset 0 0 20px rgba(255,45,135,0.06)',
        overflow: 'hidden',
      }}
    >
      {banner.imageUrl && banner.imageUrl.trim() !== '' && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${banner.imageUrl})`, opacity: 0.35 }}
        />
      )}

      {/* Top shimmer */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: 'linear-gradient(90deg, transparent, #FF2D87, transparent)',
          opacity: 0.6,
        }}
      />

      <div className="relative h-full flex items-center gap-3 px-4">
        {/* Logo — 44×44, 12px radius, orange-gold gradient */}
        <div
          className="flex-shrink-0 flex items-center justify-center text-white font-black"
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'linear-gradient(135deg, #FF6B35, #FFB347)',
            boxShadow: '0 2px 10px rgba(255,107,53,0.5), inset 0 1px 0 rgba(255,255,255,0.2)',
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          M
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <p
            className="text-[14px] font-extrabold text-[#F0E8FF] truncate leading-tight"
            style={{ lineHeight: 1.3 }}
          >
            {banner.activityName ?? '限时活动 · 全服挑战'}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5 truncate">
            {status === 'upcoming' ? '活动即将开始' : '点击进入活动'}
          </p>
        </div>

        {/* Right: CTA pill + countdown */}
        {showControls && (
          <div className="flex-shrink-0 flex flex-col items-center gap-1">
            <div
              className="rounded-full px-3 py-1.5 text-[11px] font-bold text-white whitespace-nowrap"
              style={{
                background: 'linear-gradient(135deg, #FF2D87 0%, #9B5CFF 100%)',
                boxShadow: '0 0 12px rgba(255,45,135,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
                letterSpacing: '0.3px',
              }}
            >
              领取电量
            </div>
            {countdownLabel && (
              <div
                className="text-[10px] text-white/45"
                style={{
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  letterSpacing: '0.4px',
                }}
              >
                {countdownLabel}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom shimmer */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 1,
          background: 'linear-gradient(90deg, transparent, #FF2D87, transparent)',
          opacity: 0.4,
        }}
      />
    </div>
  );
}

// ── Main carousel (Framer Motion spring physics) ──────────────────────────────

interface GameBannerCarouselProps {
  banners: BannerItem[];
  config: CarouselConfig;
}

export function GameBannerCarousel({ banners, config }: GameBannerCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(1); // +1 = forward, -1 = backward
  const [mounted, setMounted] = useState(false);
  const hasUnclaimed = useRewardStore((s) => s.hasUnclaimed);

  // TC-BN-15: navigation lock prevents rapid duplicate route pushes
  const navLockRef = useRef(false);

  // TC-BN-05: auto-play timer refs
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // TC-BN-05: pause timer — clears auto-play on swipe, resumes after 10s
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const router = useRouter();

  const visibleBanners = banners.filter((b) => getBannerStatus(b) === 'active');
  const isSingle = visibleBanners.length <= 1;

  useEffect(() => { setMounted(true); }, []);

  // ── Auto-play ────────────────────────────────────────────────────────────────
  // TC-BN-05: pauses for 10s after any manual interaction, then resumes.
  const startAutoPlay = useCallback(() => {
    if (autoRef.current) clearInterval(autoRef.current);
    if (isSingle || !config.isCarouselEnabled || visibleBanners.length <= 1) return;
    const intervalMs = (config.carouselInterval ?? 5) * 1000;
    autoRef.current = setInterval(() => {
      setDirection(1);
      setActiveIndex((i) => (i + 1) % visibleBanners.length);
    }, intervalMs);
  }, [isSingle, config.isCarouselEnabled, config.carouselInterval, visibleBanners.length]);

  const pauseAutoPlayAndWait = useCallback(() => {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; }
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(startAutoPlay, 10_000);
  }, [startAutoPlay]);

  useEffect(() => {
    startAutoPlay();
    return () => {
      if (autoRef.current) clearInterval(autoRef.current);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, [startAutoPlay]);

  // ── Navigation — TC-BN-15 debounce lock ──────────────────────────────────────
  const handleNavigate = useCallback((banner: BannerItem) => {
    if (navLockRef.current) return;
    navLockRef.current = true;
    setTimeout(() => { navLockRef.current = false; }, 500);

    if (banner.targetActivityId) {
      router.push(`/battle?activityId=${banner.targetActivityId}`);
    }
  }, [router]);

  const handleDotClick = useCallback((i: number) => {
    pauseAutoPlayAndWait();
    setDirection(i >= activeIndex ? 1 : -1);
    setActiveIndex(i);
  }, [activeIndex, pauseAutoPlayAndWait]);

  // TC-BN-04/15: mark that the current gesture is a drag, not a tap.
  // Any movement beyond ~5px switches this on; it stays on until the drag ends.
  // (Hoisted above handleDragEnd so the handler can reset it.)
  const didDragRef = useRef(false);
  const handleDragStart = useCallback(() => { didDragRef.current = true; }, []);

  // TC-BN-05: on swipe end, pause auto-play for 10s before resuming
  const handleDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      // TC-BN-04/15: swallow the click that mouseup would otherwise fire.
      // Pointerup-based tap detector in BannerCard also gates this, but
      // belt + suspenders: remember the drag just consumed the gesture.
      didDragRef.current = false;
      const threshold = 50;
      if (info.offset.x < -threshold) {
        setDirection(1);
        setActiveIndex((i) => (i + 1) % visibleBanners.length);
        pauseAutoPlayAndWait();
      } else if (info.offset.x > threshold) {
        setDirection(-1);
        setActiveIndex((i) => (i - 1 + visibleBanners.length) % visibleBanners.length);
        pauseAutoPlayAndWait();
      }
    },
    [visibleBanners.length, pauseAutoPlayAndWait]
  );

  // TC-BN-06: skeleton while not mounted (SSR/hydration)
  if (!mounted) return <BannerSkeleton />;
  if (visibleBanners.length === 0) return null;

  return (
    <div className="relative w-full mt-4">
      {/* ── TC-BN-02: "可领取" badge — OUTSIDE overflow:hidden, z-10 ────────── */}
      {hasUnclaimed && <ClaimBadge />}

      {/* ── TC-BN-14: spring physics, overflow clips ─────────────────────── */}
      <div
        style={{
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 0 24px rgba(255,45,135,0.3)',
          height: 84,
          position: 'relative',
        }}
      >
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={activeIndex}
            custom={direction}
            variants={{
              enter:  (d: number) => ({ x: d > 0 ? '100%' : '-100%', opacity: 0 as const }),
              center: { x: 0, opacity: 1 },
              exit:   (d: number) => ({ x: d > 0 ? '-100%' : '100%', opacity: 0 as const }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            drag={isSingle ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.08}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            style={{ height: 84, width: '100%', position: 'absolute', inset: 0 }}
            whileTap={{ cursor: 'grabbing' }}
          >
            <BannerCard
              banner={visibleBanners[activeIndex]}
              onTap={() => handleNavigate(visibleBanners[activeIndex])}
              didDragRef={didDragRef}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── TC-BN-05: dot indicators — hidden for single item ──────────────── */}
      <DotIndicator
        count={visibleBanners.length}
        active={activeIndex}
        onClick={handleDotClick}
      />
    </div>
  );
}
