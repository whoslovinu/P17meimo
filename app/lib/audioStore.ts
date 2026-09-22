/**
 * audioStore.ts — Zustand dual-track audio state
 *
 * Replaces the old global `_muted` singleton in AudioManager with a proper
 * React-friendly state machine that supports two independent audio tracks:
 *
 *   Track 1 — BGM  (Music): looped, auto-plays on stage change
 *   Track 2 — Voice (SFX): one-shot clips triggered by game events
 *
 * Defaults:
 *   isBgmMuted  = true   ← BGM is OFF by default (client requirement)
 *   isVoiceMuted = false
 *   bgmVolume    = 0.5   ← BGM suppressed to 50% (acoustic ducking)
 *   voiceVolume  = 1.0
 *
 * Autoplay policy reconciliation:
 *   isAudioContextReady = false  ← browser blocks audio until first user interaction
 *   Once the user clicks/taps, the AudioContext is resumed and this flag is set true.
 *   The UI (TopNav) reads this flag to honestly reflect whether audio will play.
 */

'use client';

import { create } from 'zustand';

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY_AUDIO = 'repark_audio_state_v2';

interface PersistedAudio {
  isBgmMuted:   boolean;
  isVoiceMuted: boolean;
  bgmVolume:    number;
  voiceVolume:  number;
}

function loadPersisted(): PersistedAudio {
  if (typeof window === 'undefined') {
    return { isBgmMuted: true, isVoiceMuted: false, bgmVolume: 0.5, voiceVolume: 1.0 };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUDIO);
    if (raw) return JSON.parse(raw) as PersistedAudio;
  } catch { /* noop */ }
  return { isBgmMuted: true, isVoiceMuted: false, bgmVolume: 0.5, voiceVolume: 1.0 };
}

function persist(s: PersistedAudio): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_AUDIO, JSON.stringify(s));
  } catch { /* noop */ }
}

// ── Store interface ───────────────────────────────────────────────────────────

export interface AudioState {
  // Track state
  isBgmMuted:   boolean;
  isVoiceMuted: boolean;
  bgmVolume:    number; // 0.0 – 1.0
  voiceVolume:  number; // 0.0 – 1.0

  // Browser autoplay policy reconciliation.
  // Set to true ONLY after the AudioContext transitions to 'running' state.
  // The UI MUST read this to honestly reflect whether audio will actually play —
  // localStorage isBBgmMuted:false alone is NOT sufficient because the browser
  // may still be blocking audio.
  isAudioContextReady: boolean;

  // BGM actions
  toggleBgm:       () => void;
  setBgmVolume:    (v: number) => void;
  setBgmMuted:     (v: boolean) => void;
  setAudioContextReady: (ready: boolean) => void;

  // Voice actions
  toggleVoice:      () => void;
  setVoiceVolume:   (v: number) => void;
  setVoiceMuted:    (v: boolean) => void;
}

export const useAudioStore = create<AudioState>((set, get) => {
  const initial = loadPersisted();

  return {
    // ── Initial state ────────────────────────────────────────────────────────
    isBgmMuted:   initial.isBgmMuted,
    isVoiceMuted: initial.isVoiceMuted,
    bgmVolume:    initial.bgmVolume,
    voiceVolume:  initial.voiceVolume,

    // isAudioContextReady is always false on first load.
    // BattleLayout.tsx sets it true after the first user interaction.
    isAudioContextReady: false,

    // ── BGM ────────────────────────────────────────────────────────────────
    toggleBgm: () => {
      const next = !get().isBgmMuted;
      set({ isBgmMuted: next });
      persist({ ...get(), isBgmMuted: next });
    },

    setBgmVolume: (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      set({ bgmVolume: clamped });
      persist({ ...get(), bgmVolume: clamped });
    },

    setBgmMuted: (v: boolean) => {
      set({ isBgmMuted: v });
      persist({ ...get(), isBgmMuted: v });
    },

    setAudioContextReady: (ready: boolean) => {
      set({ isAudioContextReady: ready });
      // Note: isAudioContextReady is NOT persisted — it resets on each new
      // page session since every page load requires a fresh user interaction.
    },

    // ── Voice ──────────────────────────────────────────────────────────────
    toggleVoice: () => {
      const next = !get().isVoiceMuted;
      set({ isVoiceMuted: next });
      persist({ ...get(), isVoiceMuted: next });
    },

    setVoiceVolume: (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      set({ voiceVolume: clamped });
      persist({ ...get(), voiceVolume: clamped });
    },

    setVoiceMuted: (v: boolean) => {
      set({ isVoiceMuted: v });
      persist({ ...get(), isVoiceMuted: v });
    },
  };
});

// ── Convenience non-hook accessor (for AudioManager / non-React code) ─────────
// AudioManager needs to read state without triggering React re-renders.
export const getAudioState = (): Omit<AudioState,
  'toggleBgm' | 'setBgmVolume' | 'setBgmMuted' |
  'setAudioContextReady' | 'toggleVoice' | 'setVoiceVolume' | 'setVoiceMuted'
> => {
  const s = useAudioStore.getState();
  return {
    isBgmMuted:   s.isBgmMuted,
    isVoiceMuted: s.isVoiceMuted,
    bgmVolume:    s.bgmVolume,
    voiceVolume:  s.voiceVolume,
    isAudioContextReady: s.isAudioContextReady,
  };
};
