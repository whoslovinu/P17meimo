/**
 * TopNav.tsx — Top navigation bar with countdown, audio toggles, and rules.
 *
 * Phase 3: Volume sliders for BGM and Voice tracks.
 *   - The two audio buttons are now split-button widgets:
 *     - Click the icon: toggle mute on/off.
 *     - The vertical slider under each button always shows the current volume
 *       and lets the user drag it. Dragging the slider while muted also
 *       auto-unmutes (REPARK 70/30 — sound the user actively touched means
 *       they want audio).
 *   - Slider values are persisted via the existing audioStore.
 *   - We also expose a "Speaker" / "Mic" small hint label inside the popover
 *     so the slider is identifiable.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, HelpCircle, Sparkles, Trophy, Music, Mic } from 'lucide-react';
import { openModal } from '@/app/lib/modalStore';
import { useIsClient } from '@/app/lib/useIsClient';
import { useAudioStore } from '@/app/lib/audioStore';
import { VolumePopover } from './VolumePopover';
import { env } from '@/lib/env';
import type { ActivityStatus } from './types';

const TOPNAV_ANIMATION_STYLE = `
  @keyframes expiredBadgePulse {
    0%, 100% { box-shadow: 0 0 24px rgba(255,45,135,0.4), inset 0 0 12px rgba(255,45,135,0.1); }
    50% { box-shadow: 0 0 36px rgba(255,45,135,0.65), inset 0 0 16px rgba(255,45,135,0.2); }
  }
`;

/** Which audio popover is currently open. Mutually exclusive. */
type OpenPopover = 'bgm' | 'voice' | null;

interface TopNavProps {
  endTime?: number;
  onBack?: () => void;
  serverOffsetMs?: number;
  activityStatus?: ActivityStatus;
  /** Callback to open a modal. Routes through BattleLayout's debounce/cooldown gate. */
  onOpenModal?: (page: 'task' | 'reward' | 'rules' | 'leaderboard', e?: React.SyntheticEvent) => void;
}

interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

function useCountdown(endTime: number, serverOffsetMs: number): Countdown {
  const [countdown, setCountdown] = useState<Countdown>(() => {
    const now = serverOffsetMs !== 0 ? Date.now() + serverOffsetMs : Date.now();
    const diff = endTime - now;
    if (diff <= 0) {
      return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
    }
    return {
      days: Math.floor(diff / 86_400_000),
      hours: Math.floor((diff % 86_400_000) / 3_600_000),
      minutes: Math.floor((diff % 3_600_000) / 60_000),
      seconds: Math.floor((diff % 60_000) / 1_000),
      expired: false,
    };
  });

  useEffect(() => {
    const tick = (): Countdown => {
      const now = serverOffsetMs !== 0 ? Date.now() + serverOffsetMs : Date.now();
      const diff = endTime - now;
      if (diff <= 0) {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
      }
      return {
        days: Math.floor(diff / 86_400_000),
        hours: Math.floor((diff % 86_400_000) / 3_600_000),
        minutes: Math.floor((diff % 3_600_000) / 60_000),
        seconds: Math.floor((diff % 60_000) / 1_000),
        expired: false,
      };
    };

    setCountdown(tick());
    const id = window.setInterval(() => setCountdown(tick()), 1000);
    return () => window.clearInterval(id);
  }, [endTime, serverOffsetMs]);

  return countdown;
}

const pad = (n: number) => String(n).padStart(2, '0');

function CountdownSkeleton() {
  return (
    <div
      className="flex items-center gap-1 sm:gap-1.5 px-2 py-1.5 sm:px-3 sm:py-2 rounded-full pointer-events-auto"
      style={{
        background: 'rgba(155,92,255,0.15)',
        border: '1px solid rgba(155,92,255,0.35)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 0 20px rgba(155,92,255,0.2)',
      }}
    >
      <Sparkles size={12} color="rgba(196,165,255,0.8)" />
      <span className="text-[2.5vw] sm:text-[10px] text-purple-300/70 font-medium whitespace-nowrap">距结束</span>
      <div className="flex items-center gap-[1px] sm:gap-0.5">
        <NumberBox value="00" />
        <Separator />
        <NumberBox value="00" />
        <Separator />
        <NumberBox value="00" />
        <Separator />
        <NumberBox value="00" />
      </div>
      <span className="hidden sm:inline text-[9px] text-purple-300/50">后结束</span>
    </div>
  );
}

export function TopNav({ endTime, onBack, serverOffsetMs = 0, activityStatus = 'LIVE', onOpenModal }: TopNavProps) {
  const isClient = useIsClient();

  // ── Audio state (from Zustand store — BGM muted by default) ─────────────────
  const isBgmMuted   = useAudioStore((s) => s.isBgmMuted);
  const isVoiceMuted  = useAudioStore((s) => s.isVoiceMuted);
  const bgmVolume    = useAudioStore((s) => s.bgmVolume);
  const voiceVolume  = useAudioStore((s) => s.voiceVolume);
  const isAudioContextReady = useAudioStore((s) => s.isAudioContextReady);
  const toggleBgm     = useAudioStore((s) => s.toggleBgm);
  const toggleVoice   = useAudioStore((s) => s.toggleVoice);
  const setBgmVolume  = useAudioStore((s) => s.setBgmVolume);
  const setVoiceVolume = useAudioStore((s) => s.setVoiceVolume);
  const setBgmMuted    = useAudioStore((s) => s.setBgmMuted);
  const setVoiceMuted  = useAudioStore((s) => s.setVoiceMuted);

  // ── Countdown ──────────────────────────────────────────────────────────────
  const fallbackEndMs = useMemo(
    () => Date.now() + 7 * 86_400_000,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const endMs: number = useMemo(() => {
    if (!isClient) return fallbackEndMs;
    if (typeof endTime === 'number' && Number.isFinite(endTime)) return endTime;
    return fallbackEndMs;
  }, [isClient, endTime, fallbackEndMs]);

  const countdown = useCountdown(endMs, serverOffsetMs);

  // ── Audio popover state ────────────────────────────────────────────────────
  // Default CLOSED — the slider must never take up flex height. Opening
  // happens on the second click of the same audio button. Pressing the
  // other audio button swaps the popover. Pressing outside / Escape closes.
  const [openPopover, setOpenPopover] = useState<OpenPopover>(null);

  // Close popover on outside click anywhere outside the audio wrappers.
  const audioWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openPopover) return;
    const handleDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (audioWrapRef.current && audioWrapRef.current.contains(target)) return;
      setOpenPopover(null);
    };
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [openPopover]);

  // Close on Escape dispatched by the popover itself.
  useEffect(() => {
    const handler = () => setOpenPopover(null);
    window.addEventListener('repark:close-volume-popover', handler);
    return () => window.removeEventListener('repark:close-volume-popover', handler);
  }, []);

  // BGM button: first click toggles mute; second click opens popover.
  // After that, clicks cycle between toggle-mute and popover.
  const handleBgmButtonClick = () => {
    if (openPopover === 'bgm') {
      // Popover already open — second tap toggles mute
      toggleBgm();
    } else {
      // Either closed or 'voice' is open — open BGM and mute toggle
      toggleBgm();
      setOpenPopover('bgm');
    }
  };
  const handleVoiceButtonClick = () => {
    if (openPopover === 'voice') {
      toggleVoice();
    } else {
      toggleVoice();
      setOpenPopover('voice');
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      window.location.href = env.mainStationHomeUrl();
    }
  };

  const handleRules = (e: React.MouseEvent) => {
    if (onOpenModal) {
      onOpenModal('rules', e);
    } else {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      openModal('rules');
    }
  };

  const handleLeaderboard = (e: React.MouseEvent) => {
    if (onOpenModal) {
      onOpenModal('leaderboard', e);
    } else {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      openModal('leaderboard');
    }
  };

  // When the user drags the slider while the track is muted, we treat that
  // as intent to listen — auto-unmute. Pure UX hygiene.
  const handleBgmVolumeChange = (v: number) => {
    setBgmVolume(v);
    if (v > 0 && isBgmMuted) setBgmMuted(false);
  };
  const handleVoiceVolumeChange = (v: number) => {
    setVoiceVolume(v);
    if (v > 0 && isVoiceMuted) setVoiceMuted(false);
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: TOPNAV_ANIMATION_STYLE }} />

      <div className="relative z-[100] flex items-center justify-between px-2 py-1.5 sm:px-4 sm:py-3 pointer-events-none gap-1.5 sm:gap-3 flex-nowrap">
        <button
          onClick={handleBack}
          aria-label="返回上一页"
          className="w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center pointer-events-auto shrink-0"
          style={{
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.2)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            transition: 'background 0.2s, transform 0.15s',
            touchAction: 'manipulation',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; }}
        >
          <ChevronLeft size={14} color="rgba(255,255,255,0.9)" />
        </button>

        {!isClient ? (
          <CountdownSkeleton />
        ) : activityStatus === 'ENDED' || countdown.expired ? (
          <div
            className="flex items-center gap-1 sm:gap-2 px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-full pointer-events-auto min-w-0 max-w-[58vw] sm:max-w-none"
            style={{
              background: 'rgba(255,45,135,0.3)',
              border: '1px solid rgba(255,45,135,0.6)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 0 24px rgba(255,45,135,0.4), inset 0 0 12px rgba(255,45,135,0.1)',
              animation: 'expiredBadgePulse 2s ease-in-out infinite',
            }}
          >
            <Sparkles size={12} color="rgba(255,150,180,0.9)" />
            <span className="text-[2.8vw] sm:text-xs text-pink-200 font-bold whitespace-nowrap">活动已结束</span>
          </div>
        ) : (
          <div
            className="flex items-center gap-1 sm:gap-2 px-2 py-1.5 sm:px-4 sm:py-2 rounded-full pointer-events-auto min-w-0 max-w-[58vw] sm:max-w-none"
            style={{
              background: 'rgba(155,92,255,0.15)',
              border: '1px solid rgba(155,92,255,0.35)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 0 20px rgba(155,92,255,0.2)',
            }}
          >
            <Sparkles size={12} color="rgba(196,165,255,0.8)" />
            <span className="hidden xs:inline text-[2.4vw] sm:text-[10px] text-purple-300/70 font-medium whitespace-nowrap">距结束</span>
            <div className="flex items-center gap-[1px] sm:gap-0.5 min-w-0">
              <NumberBox value={pad(countdown.days)} />
              <Separator />
              <NumberBox value={pad(countdown.hours)} />
              <Separator />
              <NumberBox value={pad(countdown.minutes)} />
              <Separator />
              <NumberBox value={pad(countdown.seconds)} />
            </div>
            <span className="hidden sm:inline text-[9px] text-purple-300/50 whitespace-nowrap">后结束</span>
          </div>
        )}

        <div ref={audioWrapRef} className="flex items-start gap-1 sm:gap-2 shrink-0">
          {/* ── BGM Toggle + Volume Slider ──
              Each audio cluster is a `relative` wrapper so the popover can
              float underneath via `position: absolute` without disturbing
              the flex layout of the navbar. */}
          <div className="relative flex items-center">
            <button
              onClick={handleBgmButtonClick}
              aria-label={isBgmMuted ? '开启BGM' : '关闭BGM'}
              className="w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center pointer-events-auto shrink-0"
              style={{
                background:   (!isAudioContextReady || isBgmMuted) ? 'rgba(0,0,0,0.3)' : 'rgba(155,92,255,0.25)',
                border:       `1px solid ${(!isAudioContextReady || isBgmMuted) ? 'rgba(255,100,100,0.45)' : 'rgba(155,92,255,0.55)'}`,
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                transition: 'background 0.2s, border-color 0.2s',
                touchAction: 'manipulation',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background   = 'rgba(255,255,255,0.15)';
                e.currentTarget.style.borderColor = 'rgba(155,92,255,0.7)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background   = (!isAudioContextReady || isBgmMuted) ? 'rgba(0,0,0,0.3)' : 'rgba(155,92,255,0.25)';
                e.currentTarget.style.borderColor = (!isAudioContextReady || isBgmMuted) ? 'rgba(255,100,100,0.45)' : 'rgba(155,92,255,0.55)';
              }}
            >
              <Music size={11} color={(!isAudioContextReady || isBgmMuted) ? 'rgba(255,100,100,0.65)' : 'rgba(200,160,255,0.95)'} />
            </button>
            <VolumePopover
              value={bgmVolume}
              onChange={handleBgmVolumeChange}
              accentColor="#A78BFA"
              disabled={!isAudioContextReady || isBgmMuted}
              visible={openPopover === 'bgm'}
              header={
                <span className="text-[8px] font-semibold tracking-wider" style={{ color: 'rgba(200,160,255,0.85)' }}>
                  BGM
                </span>
              }
            />
          </div>

          {/* ── Voice / SFX Toggle + Volume Slider ── */}
          <div className="relative flex items-center">
            <button
              onClick={handleVoiceButtonClick}
              aria-label={isVoiceMuted ? '开启语音' : '关闭语音'}
              className="w-6 h-6 sm:w-8 sm:h-8 rounded-full flex items-center justify-center pointer-events-auto shrink-0"
              style={{
                background:   (!isAudioContextReady || isVoiceMuted) ? 'rgba(0,0,0,0.3)' : 'rgba(45,200,135,0.2)',
                border:       `1px solid ${(!isAudioContextReady || isVoiceMuted) ? 'rgba(255,100,100,0.45)' : 'rgba(45,200,135,0.45)'}`,
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                transition: 'background 0.2s, border-color 0.2s',
                touchAction: 'manipulation',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background   = 'rgba(255,255,255,0.15)';
                e.currentTarget.style.borderColor = 'rgba(45,200,135,0.7)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background   = (!isAudioContextReady || isVoiceMuted) ? 'rgba(0,0,0,0.3)' : 'rgba(45,200,135,0.2)';
                e.currentTarget.style.borderColor = (!isAudioContextReady || isVoiceMuted) ? 'rgba(255,100,100,0.45)' : 'rgba(45,200,135,0.45)';
              }}
            >
              <Mic size={11} color={(!isAudioContextReady || isVoiceMuted) ? 'rgba(255,100,100,0.65)' : 'rgba(80,255,160,0.95)'} />
            </button>
            <VolumePopover
              value={voiceVolume}
              onChange={handleVoiceVolumeChange}
              accentColor="#34D399"
              disabled={!isAudioContextReady || isVoiceMuted}
              visible={openPopover === 'voice'}
              header={
                <span className="text-[8px] font-semibold tracking-wider" style={{ color: 'rgba(80,255,160,0.85)' }}>
                  语音
                </span>
              }
            />
          </div>

          <button
            onClick={handleRules}
            className="flex items-center gap-1 px-1.5 py-0.5 sm:gap-1.5 sm:px-2.5 sm:py-1.5 rounded-full pointer-events-auto shrink-0"
            style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,45,135,0.4)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              transition: 'background 0.2s, border-color 0.2s, transform 0.15s',
              touchAction: 'manipulation',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,45,135,0.15)';
              e.currentTarget.style.borderColor = 'rgba(255,45,135,0.7)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(0,0,0,0.4)';
              e.currentTarget.style.borderColor = 'rgba(255,45,135,0.4)';
            }}
          >
            <HelpCircle size={11} color="rgba(255,45,135,0.9)" />
            <span className="text-[10px] sm:text-xs font-semibold text-white/90 whitespace-nowrap">规则</span>
          </button>

          <button
            onClick={handleLeaderboard}
            aria-label="排行榜"
            className="flex items-center gap-1 px-1.5 py-0.5 sm:gap-1.5 sm:px-2.5 sm:py-1.5 rounded-full pointer-events-auto shrink-0"
            style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,215,0,0.4)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              transition: 'background 0.2s, border-color 0.2s, transform 0.15s',
              touchAction: 'manipulation',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,215,0,0.12)';
              e.currentTarget.style.borderColor = 'rgba(255,215,0,0.7)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(0,0,0,0.4)';
              e.currentTarget.style.borderColor = 'rgba(255,215,0,0.4)';
            }}
          >
            <Trophy size={11} color="rgba(255,215,0,0.9)" />
            <span className="text-[10px] sm:text-xs font-semibold text-white/90 whitespace-nowrap">排行榜</span>
          </button>
        </div>
      </div>
    </>
  );
}

function NumberBox({ value }: { value: string }) {
  return (
    <span
      className="text-[2.9vw] sm:text-[13px] font-bold text-white px-1 py-[2px] sm:px-1.5 sm:py-0.5 rounded pointer-events-none"
      style={{
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        minWidth: 'clamp(18px, 5.4vw, 26px)',
        textAlign: 'center',
        background: 'rgba(255,255,255,0.1)',
        border: '1px solid rgba(255,255,255,0.08)',
        lineHeight: '1.3',
      }}
    >
      {value}
    </span>
  );
}

function Separator() {
  return (
    <span
      className="text-pink-400 font-bold text-[2.8vw] sm:text-[13px] mx-[1px] sm:mx-0.5 pointer-events-none"
      style={{ lineHeight: '1.3' }}
    >
      :
    </span>
  );
}