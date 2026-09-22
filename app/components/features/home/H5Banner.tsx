'use client';

/**
 * H5Banner.tsx — Sovereign Banner Entry (V5.3)
 *
 * Implements PRD Sections 9.1–9.6 and Test Cases TC-BN-01 through TC-BN-15.
 *
 * Key design decisions:
 *  - embla-carousel + embla-carousel-autoplay for swipeable auto-scroll
 *  - Badge is OUTSIDE the carousel track (z-10, absolute top-right) so it
 *    never scrolls out of view — TC-BN-02, TC-BN-06
 *  - 500ms click-debounce lock prevents double-navigating — TC-BN-04, TC-BN-15
 *  - Countdown engine uses dayjs.tz (UTC+8) — TC-BN-07, TC-BN-14
 *  - Banners with endTime < now are filtered before render — TC-BN-09
 *  - Empty array returns null immediately — TC-BN-12
 *  - Skeleton shown while `isLoading` prop is true — TC-BN-13
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import Autoplay from 'embla-carousel-autoplay';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useRewardStore } from '@/lib/rewardStore';
import { Skeleton } from '@/components/ui/skeleton';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Shanghai';
function nowTz() { return dayjs().tz(TZ); }
function ts(d: string | Date | number) { return dayjs(d).tz(TZ); }

// ── Types ────────────────────────────────────────────────────────────────────

export interface BannerItem {
  id: string;
  imageUrl: string;
  targetActivityId: string | null;
  activityName: string | null;
  sortWeight: number;
  isEnabled: boolean;
  showCountdown: boolean;
  activityStatus?: 'upcoming' | 'active' | 'ended';
  startTime?: string;
  endTime?: string;
}

export interface CarouselConfig {
  isCarouselEnabled: boolean;
  carouselInterval: number;
}

export interface H5BannerProps {
  banners: BannerItem[];
  config: CarouselConfig;
  /** Show skeleton loader while true */
  isLoading?: boolean;
}

// ── Status helpers ───────────────────────────────────────────────────────────

type BannerStatus = 'upcoming' | 'active' | 'ended';

function getBannerStatus(banner: BannerItem): BannerStatus {
  if (banner.activityStatus) return banner.activityStatus;
  const now = nowTz();
  if (banner.startTime) {
    const start = ts(banner.startTime);
    if (now.isBefore(start)) return 'upcoming';
  }
  if (!banner.endTime) return 'active';
  return now.isAfter(ts(banner.endTime)) ? 'ended' : 'active';
}

// ── Countdown hook (TC-BN-07, TC-BN-14) ───────────────────────────────────────

function useCountdown(endTime: string | undefined, status: BannerStatus) {
  const [label, setLabel] = useState<string>('');

  useEffect(() => {
    if (!endTime || status !== 'active') {
      setLabel('');
      return;
    }

    const tick = () => {
      const now = nowTz();
      const end = ts(endTime);
      const diff = end.diff(now, 'second', true);

      if (diff <= 0) {
        setLabel('00:00:00');
        return;
      }

      const totalSec = Math.floor(diff);
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;

      if (d > 0) {
        setLabel(`${d}天 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      } else {
        setLabel(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endTime, status]);

  return label;
}

// ── ClaimBadge — framer-motion pulse, OUTSIDE carousel track (TC-BN-02, TC-BN-06)

function ClaimBadge() {
  return (
    <div
      className="absolute -top-1 right-2 z-10 flex items-center pointer-events-none"
      aria-label="有可领取奖励"
    >
      <motion.div
        animate={{ scale: [1, 1.22, 1.12, 1], opacity: [1, 1, 0.82, 1] }}
        transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity, times: [0, 0.1, 0.35, 1] }}
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

// ── Dot indicators (TC-BN-05) ─────────────────────────────────────────────────

function DotIndicator({
  total,
  active,
  onSelect,
}: {
  total: number;
  active: number;
  onSelect: (i: number) => void;
}) {
  if (total <= 1) return null;
  return (
    <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10">
      {Array.from({ length: total }).map((_, i) => (
        <button
          key={i}
          onClick={(e) => { e.stopPropagation(); onSelect(i); }}
          className="rounded-full cursor-pointer transition-all duration-200"
          style={{
            width: i === active ? 12 : 6,
            height: i === active ? 4 : 3,
            background: i === active ? '#FF2D87' : 'rgba(255,255,255,0.25)',
            boxShadow: i === active ? '0 0 6px rgba(255,45,135,0.7)' : 'none',
            border: 'none',
            padding: 0,
          }}
          aria-label={`跳转到第 ${i + 1} 个横幅`}
        />
      ))}
    </div>
  );
}

// ── Skeleton (TC-BN-13) ───────────────────────────────────────────────────────

function BannerSkeleton() {
  return (
    <div
      className="relative w-full rounded-[14px] overflow-hidden"
      style={{
        height: 84,
        background: 'linear-gradient(135deg, #1A1225 0%, #1E0E1E 100%)',
        border: '2px solid #FF2D87',
        boxShadow: '0 0 15px rgba(255,45,135,0.4)',
      }}
    >
      <div className="absolute inset-0 flex items-center gap-3 px-4">
        <div
          className="flex-shrink-0 rounded-xl animate-pulse"
          style={{ width: 44, height: 44, background: 'rgba(255,107,53,0.2)' }}
        />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 rounded" style={{ width: '60%', background: 'rgba(240,232,255,0.1)' }} />
          <Skeleton className="h-2 rounded" style={{ width: '35%', background: 'rgba(255,255,255,0.06)' }} />
        </div>
        <div
          className="flex-shrink-0 rounded-xl animate-pulse"
          style={{ width: 60, height: 44, background: 'rgba(255,45,135,0.15)' }}
        />
      </div>
    </div>
  );
}

// ── Single banner card ───────────────────────────────────────────────────────

function BannerCard({
  banner,
  onTap,
}: {
  banner: BannerItem;
  onTap: () => void;
}) {
  const status = getBannerStatus(banner);
  const countdown = useCountdown(banner.endTime, status);
  const showControls = banner.showCountdown && status !== 'ended';

  const countdownLabel =
    status === 'upcoming' ? '即将开始'
    : status === 'ended' ? ''
    : countdown || '';

  return (
    <div
      onClick={onTap}
      className="relative flex-shrink-0 w-full cursor-pointer select-none"
      style={{
        height: 84,
        background: 'linear-gradient(135deg, #1A1225 0%, #1E0E1E 100%)',
        border: '2px solid #FF2D87',
        borderRadius: 14,
        boxShadow: '0 0 15px rgba(255,45,135,0.4), inset 0 0 20px rgba(255,45,135,0.06)',
        overflow: 'hidden',
      }}
    >
      {banner.imageUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${banner.imageUrl})`, opacity: 0.35 }}
        />
      )}

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
        {/* Logo: 44x44, rounded-xl, orange-to-gold gradient */}
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

        {/* Right: CTA capsule pill + countdown */}
        {showControls && (
          <div className="flex-shrink-0 flex flex-col items-center gap-1">
            <div
              className="rounded-[22px] px-3 py-1.5 text-[11px] font-bold text-white whitespace-nowrap"
              style={{
                background: 'linear-gradient(135deg, #FF2D87, #9B5CFF)',
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

// ── H5Banner main export ─────────────────────────────────────────────────────

export function H5Banner({ banners, config, isLoading = false }: H5BannerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const hasUnclaimed = useRewardStore((s) => s.hasUnclaimed);
  const router = useRouter();

  // TC-BN-04 / TC-BN-15: 500ms debounce lock prevents multi-instance navigation
  const navLockRef = useRef(false);

  // TC-BN-09: Filter out ended banners before rendering
  const visibleBanners = banners.filter((b) => getBannerStatus(b) !== 'ended');

  // Derived values needed by hooks — computed before any conditional returns
  const isSingle = visibleBanners.length <= 1;
  const intervalMs = (config.carouselInterval ?? 5) * 1000;

  // embla-carousel with Autoplay plugin
  const autoplayOptions =
    !isSingle && config.isCarouselEnabled
      ? { delay: intervalMs, stopOnInteraction: true, stopOnMouseEnter: true }
      : false;

  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: !isSingle, skipSnaps: true, containScroll: false },
    autoplayOptions ? [Autoplay(autoplayOptions)] : []
  );

  // Sync selected scroll position → activeIndex
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setActiveIndex(emblaApi.selectedScrollSnap());
    emblaApi.on('select', onSelect);
    return () => { emblaApi.off('select', onSelect); };
  }, [emblaApi]);

  // Manual navigation via dots
  const scrollTo = useCallback(
    (i: number) => {
      if (!emblaApi || isSingle) return;
      emblaApi.scrollTo(i, true);
    },
    [emblaApi, isSingle]
  );

  // TC-BN-04 / TC-BN-15: Debounced navigation handler
  const handleNavigate = useCallback(
    (banner: BannerItem) => {
      if (navLockRef.current) return;
      navLockRef.current = true;
      setTimeout(() => { navLockRef.current = false; }, 500);

      if (banner.targetActivityId) {
        router.push(`/battle?activityId=${banner.targetActivityId}`);
      }
    },
    [router]
  );

  // TC-BN-12: Empty banners → return null immediately (no whitespace)
  if (!isLoading && visibleBanners.length === 0) return null;

  // TC-BN-13: Skeleton while loading
  if (isLoading) return <BannerSkeleton />;

  return (
    <div className="relative w-full mt-4">
      {/* TC-BN-02 / TC-BN-06: Claim badge — OUTSIDE carousel track, fixed top-right */}
      {hasUnclaimed && <ClaimBadge />}

      {/* Carousel viewport */}
      <div
        ref={emblaRef}
        className="overflow-hidden"
        style={{ borderRadius: 14, height: 84 }}
      >
        <div className="flex h-full">
          {visibleBanners.map((banner) => (
            <div key={banner.id} className="flex-[0_0_100%] min-w-0 px-0.5">
              <BannerCard
                banner={banner}
                onTap={() => handleNavigate(banner)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* TC-BN-05: Dot indicators — hidden for single banner */}
      <DotIndicator
        total={visibleBanners.length}
        active={activeIndex}
        onSelect={scrollTo}
      />
    </div>
  );
}
