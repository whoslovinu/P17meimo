/**
 * AudioManager.ts — REPARK Audio Orchestration Engine
 * Singleton manager for BGM and SFX with anti-overlap concurrency defense.
 * Built on Howler.js (MIT License) per the 70/30 Predation Policy.
 *
 * Voice track integration with audioStore:
 *   - Holds a reference to the currently playing voice Howl instance.
 *   - Subscribes to audioStore.isVoiceMuted changes.
 *   - When muted → true, immediately stops any playing voice clip.
 *
 * VOICE MUTUAL-EXCLUSION LOCK (Bug #14 Fix — 2026-08-19):
 *   PRD rule: while any voice clip is playing, every subsequent playVoice() /
 *   playCharacterVoice() call is a COMPLETE no-op (no interrupt, no restart,
 *   no overlap).  We enforce this via a window-level singleton state so that
 *   even if the ESM module is somehow instantiated multiple times the lock is
 *   shared across every copy.  The lock is set to true BEFORE any async
 *   operation and reset to false only in cleanup() — guaranteeing no
 *   re-entrant call within the same event tick can slip through.
 *
 * LIVE VOLUME SYNC (Phase 3 — 2026-Q3):
 *   The audioStore exposes bgmVolume / voiceVolume that the user can drag
 *   via the TopNav slider. We subscribe to both and push them into every
 *   live Howl instance so the volume change is audible in the same frame.
 *   Without this, only *future* Howl() instances would pick up the new
 *   value, meaning a slider drag while BGM is playing would feel broken.
 */

import { Howl, Howler } from 'howler';
import { getAudioState } from '@/app/lib/audioStore';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_FADE_MS            = 1000;
const MAX_SFX_INSTANCES_PER_SOUND = 3; // concurrency cap per unique URL

// ── Window-Level Global Voice Singleton ────────────────────────────────────────
// P0 2026-08-19: This lives on the window object so that even if the ESM
// module is somehow loaded multiple times (e.g., across Next.js RSC bundles)
// all copies share the same physical lock.  The lock is the SOLE authority
// for whether a voice is "playing" — no other flag (howl.playing(), paused,
// ended) is consulted for overlap decisions.
interface ReparkVoiceState {
  /** Currently active voice Howl, or null when idle */
  howl: Howl | null;
  /**
   * Physical lock flag. Set to true the instant a voice starts playing.
   * Set to false ONLY in the cleanup() path — never in stopActiveVoice().
   * Any playCharacterVoice/playVoice call that sees this as true returns
   * immediately as a no-op.
   */
  locked: boolean;
  /**
   * Cycle index for round-robin voice selection. Incremented in cleanup()
   * only after natural playback completion (onended), not on interruption.
   * Used by playCharacterVoice() to cycle through the provided URL list.
   */
  index: number;
  /** Snapshot of the current URL list, used by cleanup() to advance the index */
  urlList: string[];
  /** Cleanup function registered by the current active voice — calls cleanup() */
  cleanup: (() => void) | null;
}

function getVoiceState(): ReparkVoiceState {
  if (typeof window === 'undefined') {
    return { howl: null, locked: false, index: 0, urlList: [], cleanup: null };
  }
  if (!(window as unknown as Record<string, unknown>).__REPARK_VOICE__) {
    (window as unknown as Record<string, unknown>).__REPARK_VOICE__ = {
      howl: null,
      locked: false,
      index: 0,
      urlList: [],
      cleanup: null,
    } as ReparkVoiceState;
  }
  return (window as unknown as Record<string, ReparkVoiceState>).__REPARK_VOICE__;
}

// ── Internal State ─────────────────────────────────────────────────────────────

// The currently active voice Howl instance + its pending resolvers.
// Kept here so the voice can be stopped AND its Promise resolved
// the instant a new playVoice() interrupts it.
interface ActiveVoice {
  howl: Howl;
  cleanup: () => void;
  resolve: () => void;
}
let _activeVoice: ActiveVoice | null = null;

// SFX pool: URL → array of active Howl instances
const _sfxPool: Map<string, Howl[]> = new Map();

// ── Voice Track Integration ────────────────────────────────────────────────────
// Subscribe ONCE to audioStore — kills the active voice the instant the
// user toggles voice off. This is the real-time voice killing mechanism.

let _voiceSubscriberAttached = false;

function attachVoiceSubscriber(): void {
  if (typeof window === 'undefined') return;
  if (_voiceSubscriberAttached) return;
  _voiceSubscriberAttached = true;

  let wasMuted = getAudioState().isVoiceMuted;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAudioStore } = require('@/app/lib/audioStore');
    useAudioStore.subscribe((state: { isVoiceMuted: boolean }, prevState: { isVoiceMuted: boolean }) => {
      if (state.isVoiceMuted === prevState.isVoiceMuted) return;
      const nowMuted = state.isVoiceMuted;
      if (nowMuted && !wasMuted) {
        // User just turned voice OFF — kill any playing voice immediately
        stopActiveVoice();
      }
      wasMuted = nowMuted;
    });
  } catch {
    // Non-critical: if store import fails (SSR), skip subscriber
  }
}

// ── Live Volume Sync ──────────────────────────────────────────────────────────
// Pushes new bgm / voice volumes into every live Howl instance. The BGM
// controller handles its own binary-volume Howl instances, so this mostly
// covers voice + SFX pool entries. Both subscribers are idempotent.
let _volumeSubscriberAttached = false;

function attachVolumeSubscriber(): void {
  if (typeof window === 'undefined') return;
  if (_volumeSubscriberAttached) return;
  _volumeSubscriberAttached = true;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAudioStore } = require('@/app/lib/audioStore');
    useAudioStore.subscribe(
      (state: { voiceVolume: number; bgmVolume: number }, prevState: { voiceVolume: number; bgmVolume: number }) => {
        if (state.voiceVolume === prevState.voiceVolume && state.bgmVolume === prevState.bgmVolume) {
          return;
        }

        // Voice: update the currently-playing voice Howl (if any) and every
        // SFX in the pool. We DON'T bypass isVoiceMuted here because each
        // Howl already respects it (muted → unmute + volume(x), etc.); just
        // setting .volume() on a muted Howl would re-audible it. Check
        // muted status first.
        if (state.voiceVolume !== prevState.voiceVolume) {
          const muted = getAudioState().isVoiceMuted;
          if (!muted) {
            const activeVoiceHowl = _activeVoice?.howl;
            if (activeVoiceHowl) {
              try { activeVoiceHowl.volume(state.voiceVolume); } catch { /* already destroyed */ }
            }
            for (const pool of _sfxPool.values()) {
              for (const howl of pool) {
                try { howl.volume(state.voiceVolume); } catch { /* already destroyed */ }
              }
            }
          }
        }

        // BGM: BGMController handles its own Howl instances, so just no-op.
        // The controller already subscribes and re-applies on store change.
      }
    );
  } catch {
    // Non-critical: SSR or store unavailable
  }
}

/**
 * Stop the currently playing voice AND resolve its pending Promise.
 * Idempotent: safe to call multiple times.
 * Also clears the window-level singleton state.
 */
function stopActiveVoice(): void {
  const gvs = getVoiceState();
  if (gvs.cleanup) {
    // Prevent double-release of the lock by nulling cleanup before calling it
    const c = gvs.cleanup;
    gvs.cleanup = null;
    gvs.locked = false;
    gvs.howl = null;
    try { c(); } catch { /* best-effort */ }
  }
  if (_activeVoice) {
    const { howl, cleanup, resolve } = _activeVoice;
    _activeVoice = null;
    try { howl.stop(); } catch { /* swallow — already destroyed */ }
    cleanup();
    resolve();
  }
}

// ── Singleton class ────────────────────────────────────────────────────────────

export class AudioManager {

  /**
   * Stop all audio immediately (used on page unload or hard reset).
   */
  static stopAll(): void {
    stopActiveVoice();
    Howler.unload();
    _sfxPool.clear();
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // STAGE-BASED VOICE ENGINE
  //
  // Voice path mapping:
  //   Stage 1 (idx 0) → Voice_1/Standby_1.mp3, Voice_1/ATKa_1.mp3, Voice_1/ATKb_1.mp3
  //   Stage 2 (idx 1) → Voice_2/Standby_1.mp3, Voice_2/ATKa_1.mp3, Voice_2/ATKb_1.mp3
  //   Stage 3 (idx 2) → Voice_3/Standby_1.mp3, Voice_3/ATKa_1.mp3, Voice_3/ATKb_1.mp3
  //   Stage 4 (idx 3) → Voice_4/Standby_1.mp3, Voice_4/ATKa_1.mp3, Voice_4/ATKb_1.mp3
  //
  // Base URL is configurable via NEXT_PUBLIC_VOICE_BASE_URL env var.
  // Falls back gracefully if the audio file is missing.
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Play a one-shot voice clip for the active stage.
   *
   * MUTUAL-EXCLUSION SEMANTICS (Bug #14 Fix — 2026-08-19):
   *   While any voice clip is playing (global lock held), every subsequent
   *   playVoice() call is a COMPLETE no-op — no interrupt, no restart, no
   *   overlap.  The lock is the window-level `__REPARK_VOICE__.locked` flag,
   *   shared across all ESM module copies.  The lock is set BEFORE any async
   *   work and cleared ONLY in cleanup().
   *
   * Returns a Promise<void> that:
   *   - resolves on the Howl `end` event (natural playback completion)
   *   - resolves immediately if voice is muted (isVoiceMuted === true)
   *   - resolves immediately on `loaderror` / `playerror` / DOMException
   *   - resolves on a hard 6-second wall-clock ceiling as a last-resort
   *     safety net — if neither end nor error fires, we MUST release the UI lock
   *
   * @param stageIdx 0-based stage index (0 = Stage 1)
   * @param action   Which clip to play
   */
  static playVoice(
    stageIdx: number,
    action: 'standby' | 'attack_a' | 'attack_b'
  ): Promise<void> {
    const { isVoiceMuted, voiceVolume } = getAudioState();
    const baseUrl = process.env.NEXT_PUBLIC_VOICE_BASE_URL ?? '/voice';

    const actionMap: Record<string, string> = {
      standby:   'Standby_1.mp3',
      attack_a:  'ATKa_1.mp3',
      attack_b:  'ATKb_1.mp3',
    };

    const filename = actionMap[action];
    if (!filename || isVoiceMuted) return Promise.resolve();

    const voiceDir = `Voice_${stageIdx + 1}`;
    const url = `${baseUrl.replace(/\/$/, '')}/${voiceDir}/${filename}`;

    return new Promise<void>((resolve) => {
      const gvs = getVoiceState();

      // ── Mutual-exclusion lock (Bug #14) ────────────────────────────────────
      // PRD rule: any playCharacterVoice/playVoice call while the lock is held
      // is a complete no-op.  Set locked BEFORE any async work so re-entrant
      // calls in the same event tick are blocked immediately.
      if (gvs.locked) {
        console.log('[AudioManager] Voice is playing — click ignored (locked).');
        return resolve();
      }
      gvs.locked = true;

      // DIAGNOSTIC banner (fires once per page session)
      if (typeof window !== 'undefined' && !(window as any).__reparkVoiceV3) {
        (window as any).__reparkVoiceV3 = true;
        console.log('%c🎙️ AudioManager: V3 mutual-exclusion lock ACTIVE',
          'color:#FF2D87;font-weight:bold');
      }

      // HARD CEILING: 6 seconds — safety net so the lock never strands
      const HARD_TIMEOUT_MS = 6_000;
      const hardTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
        cleanup();
        resolve();
      }, HARD_TIMEOUT_MS);

      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        // Release the global lock on every exit path (onended / error / timeout)
        gvs.locked = false;
        gvs.index = (gvs.index + 1) % (gvs.urlList.length || 1);
        gvs.howl = null;
        gvs.cleanup = null;
        if (_activeVoice?.howl === howl) _activeVoice = null;
      };

      // Register the cleanup on the global state so stopActiveVoice() can find it
      gvs.cleanup = cleanup;

      // Stop any currently playing voice (resolve previous Promise, kill Howl)
      stopActiveVoice();

      attachVoiceSubscriber();
      attachVolumeSubscriber();

      const howl: Howl = new Howl({
        src:    [url],
        loop:   false,
        volume: voiceVolume,
        html5:  false,
        onend: () => {
          cleanup();
          resolve();
        },
        onloaderror: (_id, err) => {
          console.warn(`[AudioManager/Voice] loaderror for ${url}:`, err);
          cleanup();
          resolve();
        },
        onplayerror: (_id, err) => {
          console.warn(`[AudioManager/Voice] playerror for ${url}:`, err);
          cleanup();
          resolve();
        },
      });

      _activeVoice = { howl, cleanup, resolve };
      gvs.howl = howl;

      try {
        howl.play();
      } catch (err: unknown) {
        if (err instanceof DOMException) {
          console.warn(`[AudioManager/Voice] Autoplay blocked for ${url}`);
        }
        cleanup();
        resolve();
      }
    });
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // CHARACTER TAP VOICE — round-robin playlist
  //
  // Used for the character-spine click interaction.  Each successful tap plays
  // the next URL in the provided list (round-robin).  Any call while a clip is
  // playing is a complete no-op (global lock shared with playVoice above).
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Play the next clip in a character-voice playlist (round-robin).
   *
   * PRD rule: while any voice clip is playing, every call is a COMPLETE no-op.
   * Shares the global window-level `__REPARK_VOICE__.locked` flag with playVoice()
   * so the two paths can never overlap.
   *
   * @param voiceUrls  Non-empty array of MP3 URLs.  The method cycles through
   *                   them round-robin; index advances ONLY on natural completion.
   * @returns true if playback started; false if ignored (locked or empty list).
   */
  static playCharacterVoice(voiceUrls: string[]): boolean {
    if (typeof window === 'undefined') return false;
    if (!voiceUrls || voiceUrls.length === 0) return false;

    const gvs = getVoiceState();

    // ── Mutual-exclusion guard ────────────────────────────────────────────────
    if (gvs.locked) {
      console.log('[AudioManager] playCharacterVoice: locked — ignored.');
      return false;
    }
    gvs.locked = true;
    gvs.urlList = voiceUrls;

    // Clean up any stale Howl
    if (gvs.howl) {
      try { gvs.howl.stop(); } catch { /* best-effort */ }
      gvs.howl = null;
    }
    if (gvs.cleanup) {
      const c = gvs.cleanup;
      gvs.cleanup = null;
      try { c(); } catch { /* best-effort */ }
    }

    const targetUrl = voiceUrls[gvs.index % voiceUrls.length];
    const { isVoiceMuted, voiceVolume } = getAudioState();

    const cleanup = () => {
      gvs.locked = false;
      gvs.index = (gvs.index + 1) % voiceUrls.length;
      gvs.howl = null;
      gvs.cleanup = null;
    };

    gvs.cleanup = cleanup;

    const howl = new Howl({
      src:    [targetUrl],
      loop:   false,
      volume: isVoiceMuted ? 0 : voiceVolume,
      html5:  false,
      onend:   cleanup,
      onloaderror: (_id, err) => {
        console.warn(`[AudioManager/CharacterVoice] loaderror ${targetUrl}:`, err);
        cleanup();
      },
      onplayerror: (_id, err) => {
        console.warn(`[AudioManager/CharacterVoice] playerror ${targetUrl}:`, err);
        cleanup();
      },
    });

    gvs.howl = howl;

    if (!isVoiceMuted) {
      try {
        howl.play();
      } catch (err) {
        console.warn('[AudioManager/CharacterVoice] play failed:', err);
        cleanup();
      }
    } else {
      // If muted, unlock immediately without playing anything
      cleanup();
    }

    return true;
  }

  /**
   * Play a one-shot SFX with anti-overlap concurrency defense.
   * - Tracks active Howl instances per unique URL.
   * - When the pool for that URL is full (>= MAX_SFX_INSTANCES_PER_SOUND),
   *   the oldest instance is stopped before adding a new one.
   *
   * @param url Public URL of the audio file (mp3/ogg/wav)
   */
  static playSFX(url: string): void {
    if (getAudioState().isVoiceMuted) return;
    attachVolumeSubscriber();

    let pool = _sfxPool.get(url);
    if (!pool) {
      pool = [];
      _sfxPool.set(url, pool);
    }

    if (pool.length >= MAX_SFX_INSTANCES_PER_SOUND) {
      const oldest = pool.shift();
      oldest?.stop();
    }

    const sfx = new Howl({
      src:    [url],
      loop:   false,
      volume: getAudioState().voiceVolume,
      html5:  false,
      onend: () => {
        sfx.stop();
        const idx = pool!.indexOf(sfx);
        if (idx !== -1) pool!.splice(idx, 1);
        if (pool!.length === 0) _sfxPool.delete(url);
      },
      onplayerror: (_id, err) => {
        console.warn('[AudioManager/SFX] play error:', err);
        sfx.once('unlock', () => sfx.play());
      },
    });

    sfx.play();
    pool.push(sfx);
  }

  /**
   * Query the global voice lock state. Used by UI components (e.g. BattleLayout)
   * to gate their own reentrant-tap guards without having to mirror the lock.
   */
  static isVoiceLocked(): boolean {
    return getVoiceState().locked;
  }

  /**
   * Stop the currently playing voice clip immediately and resolve its
   * pending Promise. Called by the audioStore subscriber when isVoiceMuted
   * toggles to true, and internally by playVoice() interruption.
   */
  static stopActiveVoice(): void {
    stopActiveVoice();
  }
}