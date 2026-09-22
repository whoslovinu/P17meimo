/**
 * BGMController.tsx — Phase-Aware BGM Engine (Binary Volume Control)
 *
 * Drives two BGM tracks based on the active game stage:
 *   Stage 1 (idx 0) + Stage 2 (idx 1) → /audio/bgm/bgm_1.mp3
 *   Stage 3 (idx 2) + Stage 4 (idx 3) → /audio/bgm/bgm_2.mp3
 *
 * Key design decisions:
 *   - Two Howl instances (bgm1, bgm2), both loop: true.
 *   - Only one plays at a time — inactive track is kept at volume 0.
 *   - BINARY VOLUME CONTROL: No .fade() calls — stage switches use instant
 *     volume changes to eliminate race conditions during rapid stage transitions.
 *   - All volume/mute state is derived from audioStore — the single source of truth.
 *   - AudioContext readiness is enforced: .play() is gated on isAudioContextReady.
 *
 * Usage: <BGMController activeStageIdx={activeStageIdx} />
 */

'use client';

import { useEffect, useRef } from 'react';
import { Howl, Howler } from 'howler';
import { useAudioStore } from '@/app/lib/audioStore';

const BGM_TRACKS = {
  1: '/audio/bgm/bgm_1.mp3',
  2: '/audio/bgm/bgm_2.mp3',
} as const;

type BgmTrackKey = keyof typeof BGM_TRACKS;

function stageToBgmKey(stageIdx: number): BgmTrackKey {
  return stageIdx <= 1 ? 1 : 2;
}

/** Applies the full binary volume state to both Howl instances. */
function applyBinaryVolume(
  bgm1: Howl,
  bgm2: Howl,
  isBgmMuted: boolean,
  bgmVolume: number,
  activeKey: BgmTrackKey
): void {
  if (isBgmMuted) {
    bgm1.volume(0);
    bgm2.volume(0);
    bgm1.mute(true);
    bgm2.mute(true);
  } else {
    bgm1.mute(false);
    bgm2.mute(false);
    bgm1.volume(activeKey === 1 ? bgmVolume : 0);
    bgm2.volume(activeKey === 2 ? bgmVolume : 0);
  }
}

interface BGMControllerProps {
  activeStageIdx: number;
}

export function BGMController({ activeStageIdx }: BGMControllerProps) {
  const bgm1Ref         = useRef<Howl | null>(null);
  const bgm2Ref         = useRef<Howl | null>(null);
  const activeTrackRef  = useRef<BgmTrackKey>(1);

  // ── Initialize Howl instances once (on mount) ──────────────────────────────
  useEffect(() => {
    const forceUnlock = (howl: Howl) => {
      howl.once('unlock', () => {
        const ctx = (howl as unknown as { _ctx?: { state: string; resume: () => Promise<void> } })._ctx;
        if (ctx && ctx.state !== 'running') {
          ctx.resume().catch(() => { /* already running */ });
        }
      });
    };

    const bgm1 = new Howl({
      src:    [BGM_TRACKS[1]],
      loop:   true,
      volume: 0,
      html5:  true,
      onplayerror: (_id, err) => {
        console.warn('[BGMController] bgm_1 play error:', err);
        forceUnlock(bgm1);
      },
    });

    const bgm2 = new Howl({
      src:    [BGM_TRACKS[2]],
      loop:   true,
      volume: 0,
      html5:  true,
      onplayerror: (_id, err) => {
        console.warn('[BGMController] bgm_2 play error:', err);
        forceUnlock(bgm2);
      },
    });

    forceUnlock(bgm1);
    forceUnlock(bgm2);

    bgm1Ref.current = bgm1;
    bgm2Ref.current = bgm2;

    const { isBgmMuted, bgmVolume, isAudioContextReady } = useAudioStore.getState();

    if (isBgmMuted) {
      bgm1.mute(true);
      bgm2.mute(true);
    } else if (isAudioContextReady) {
      // Context ready + user wants BGM — begin playback
      bgm1.volume(bgmVolume);
      bgm2.volume(0);
      bgm1.play();
      bgm2.play();
    } else {
      // AudioContext not yet confirmed running — mute until first user interaction
      bgm1.mute(true);
      bgm2.mute(true);
    }

    return () => {
      Howler.unload();
      bgm1Ref.current = null;
      bgm2Ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── React to stage changes — binary volume switch (no fade) ─────────────────
  useEffect(() => {
    const bgm1 = bgm1Ref.current;
    const bgm2 = bgm2Ref.current;
    if (!bgm1 || !bgm2) return;

    const targetKey = stageToBgmKey(activeStageIdx);
    activeTrackRef.current = targetKey;

    const { isBgmMuted, bgmVolume } = useAudioStore.getState();
    applyBinaryVolume(bgm1, bgm2, isBgmMuted, bgmVolume, targetKey);
  }, [activeStageIdx]);

  // ── React to audioStore changes — mute toggle, volume drag, AudioContext ─────
  useEffect(() => {
    const unsubscribe = useAudioStore.subscribe((state, prevState) => {
      const bgm1 = bgm1Ref.current;
      const bgm2 = bgm2Ref.current;
      if (!bgm1 || !bgm2) return;

      // AudioContext became ready: kick off playback if BGM is on
      if (state.isAudioContextReady && !prevState.isAudioContextReady) {
        if (!state.isBgmMuted) {
          bgm1.mute(false);
          bgm2.mute(false);
          applyBinaryVolume(bgm1, bgm2, false, state.bgmVolume, activeTrackRef.current);
          if (!bgm1.playing()) bgm1.play();
          if (!bgm2.playing()) bgm2.play();
        }
        return;
      }

      // Mute toggle: muted→unmuted must also kick off playback so BGM actually
      // starts (the mount effect gates .play() on isAudioContextReady at that
      // moment, but later toggle-unmute needs to replay if both tracks idle).
      if (state.isBgmMuted !== prevState.isBgmMuted) {
        applyBinaryVolume(bgm1, bgm2, state.isBgmMuted, state.bgmVolume, activeTrackRef.current);
        if (!state.isBgmMuted && state.isAudioContextReady) {
          if (!bgm1.playing()) bgm1.play();
          if (!bgm2.playing()) bgm2.play();
        }
        return;
      }

      // Volume drag (only when unmuted)
      if (state.bgmVolume !== prevState.bgmVolume && !state.isBgmMuted) {
        applyBinaryVolume(bgm1, bgm2, false, state.bgmVolume, activeTrackRef.current);
      }
    });

    return unsubscribe;
  }, []);

  return null;
}
