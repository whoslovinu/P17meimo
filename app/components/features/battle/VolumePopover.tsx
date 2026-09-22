/**
 * VolumePopover — floating vertical slider that anchors UNDER a BGM / Voice
 * button. Rendered with `position: absolute` so it does NOT push the parent
 * nav-bar layout. Visibility is fully controlled by the parent via `visible`.
 *
 * REPARK 6.0 P0: Custom Pointer Slider
 * ─────────────────────────────────────
 * The previous implementation used a native `<input type="range">` with
 * WebKit's `writing-mode: vertical-lr` and hacked the thumb into the
 * center via CSS `padding-block` + `transform: translateX`. Browser
 * differences (Safari vs Chromium vs Firefox) and the rotated coordinate
 * space made the thumb drift diagonally and never truly center on the
 * track.
 *
 * This rewrite replaces the native input with a pure-CSS custom slider:
 *   - Track:      `relative w-1.5 h-36` container, fixed geometry.
 *   - Fill:       absolutely positioned bottom-anchored div whose height
 *                 equals `volume%`. Tracks the slider value 1:1.
 *   - Thumb:      absolutely positioned div centered with
 *                 `left-1/2 -translate-x-1/2`. Its vertical center is
 *                 exactly on the track's center line at every position.
 *   - Hit-area:   a transparent layer covering the full track height that
 *                 captures pointer events for click and drag.
 *
 * Because the thumb is a child of a `relative` parent with `left-1/2
 * -translate-x-1/2`, its horizontal center is mathematically pinned to
 * the track's centerline. There is no rotated coordinate space, no
 * browser-quirk padding math, and no transform drift — the thumb is
 * geometrically guaranteed to sit dead-center on the track.
 *
 * Lifecycle:
 *   - visible=true  → popover fades in (180ms)
 *   - visible=false → popover removed from the visual flow entirely (display: none)
 *
 * The parent is responsible for:
 *   1. Toggling `visible` (e.g., on second click / outside-click / Escape).
 *   2. Anchoring this popover under the button.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';

interface VolumePopoverProps {
  value: number;          // 0..1
  onChange: (v: number) => void;
  accentColor: string;    // any CSS color string (used for fill gradient)
  disabled?: boolean;
  /** Whether the popover is currently shown. Default false. */
  visible?: boolean;
  /** Slot for the parent button; rendered inside the popover header. */
  header?: React.ReactNode;
}

const TRACK_HEIGHT_PX = 144; // h-36

export function VolumePopover({
  value,
  onChange,
  accentColor,
  disabled = false,
  visible = false,
  header,
}: VolumePopoverProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const handleChangeFromPoint = useCallback(
    (clientY: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const clampedY = Math.max(rect.top, Math.min(rect.bottom, clientY));
      // 0 = bottom (max), 1 = top (min). Invert: bottom of track = full volume.
      const fraction = 1 - (clampedY - rect.top) / rect.height;
      const next = Math.max(0, Math.min(1, fraction));
      onChange(next);
    },
    [onChange]
  );

  // Dismiss on Escape
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && trackRef.current?.contains(focused)) {
          focused.blur();
        }
        // The parent owns visibility — bubble Escape up so it can close us.
        // We dispatch a custom event the parent listens for.
        window.dispatchEvent(new CustomEvent('repark:close-volume-popover'));
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [visible]);

  // Pointer move / up handlers — registered globally only while dragging,
  // so the slider follows the cursor even when it leaves the track bounds.
  useEffect(() => {
    if (!visible) return;
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      handleChangeFromPoint(e.clientY);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [visible, handleChangeFromPoint]);

  const pct = Math.round(value * 100);

  if (!visible) {
    // Inert placeholder. Pointer-events disabled so it cannot intercept clicks.
    return (
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
    );
  }

  return (
    <div
      role="dialog"
      aria-label="音量调节"
      className="flex flex-col items-center justify-end gap-2 px-3 py-3 rounded-2xl pointer-events-auto"
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.9)',
        border: `1px solid ${disabled ? 'rgba(255,100,100,0.35)' : 'rgba(255,255,255,0.1)'}`,
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        boxShadow: `0 8px 28px rgba(0,0,0,0.55), 0 0 16px ${disabled ? 'rgba(255,100,100,0.18)' : `${accentColor}33`}`,
        opacity: disabled ? 0.55 : 1,
        transition: 'opacity 0.18s, box-shadow 0.18s',
        minWidth: '52px',
        zIndex: 50,
        animation: 'volumePopoverIn 180ms ease-out',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {header}

      {/*
        Custom vertical slider.  Geometry:
          - container: 24px wide × 144px tall (h-36 w-6), perfectly symmetric
          - track:    6px wide (`w-1.5`), centered horizontally with `mx-auto`
          - thumb:    16px circle (`w-4 h-4`), centered on the track via
                      `left-1/2 -translate-x-1/2` — mathematical certainty,
                      no rotated coord-space hack.
      */}
      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="音量"
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(e) => {
          if (disabled) return;
          e.preventDefault();
          draggingRef.current = true;
          handleChangeFromPoint(e.clientY);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            onChange(Math.min(1, value + 0.05));
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            onChange(Math.max(0, value - 0.05));
          } else if (e.key === 'Home') {
            e.preventDefault();
            onChange(1);
          } else if (e.key === 'End') {
            e.preventDefault();
            onChange(0);
          }
        }}
        className="relative w-1.5 bg-zinc-800 rounded-full mx-auto"
        style={{
          height: `${TRACK_HEIGHT_PX}px`,
          cursor: disabled ? 'not-allowed' : 'pointer',
          touchAction: 'none',
        }}
      >
        {/* Fill — bottom-anchored, height tracks `volume%`. */}
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 right-0 rounded-full pointer-events-none"
          style={{
            height: `${pct}%`,
            background: `linear-gradient(180deg, ${accentColor} 0%, ${accentColor}cc 100%)`,
            transition: draggingRef.current ? 'none' : 'height 0.12s ease-out',
            boxShadow: `0 0 8px ${accentColor}88`,
          }}
        />

        {/* Thumb — center-pinned via left-1/2 -translate-x-1/2.
            bottom: calc(pct% - 8px) places the 16px circle so its CENTER
            sits at the same y as the top of the fill bar. */}
        <div
          aria-hidden="true"
          className="absolute rounded-full bg-white border-2 shadow-lg pointer-events-none"
          style={{
            width: '16px',
            height: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: `calc(${pct}% - 8px)`,
            borderColor: accentColor,
            boxShadow: `0 0 8px ${accentColor}cc, 0 2px 4px rgba(0,0,0,0.5), inset 0 0 2px rgba(255,255,255,0.4)`,
            transition: draggingRef.current ? 'none' : 'bottom 0.12s ease-out',
          }}
        />
      </div>

      <span
        className="text-[9px] font-bold tabular-nums"
        style={{
          color: disabled ? 'rgba(255,100,100,0.85)' : `${accentColor}`,
          letterSpacing: '0.04em',
        }}
      >
        {pct}%
      </span>

      <style jsx>{`
        @keyframes volumePopoverIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
