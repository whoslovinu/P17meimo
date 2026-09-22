'use client';

import { useState, useEffect, useRef } from 'react';

// ════════════════════════════════════════════════════════════════════════════════
// FLOATING DAMAGE ENGINE — Section 2.7
// Exposes a global `spawnFloatingDamage(amount, x, y)` function.
// Each spawn creates a DOM element that auto-unmounts after 900ms.
// Uses absolute positioning relative to the viewport.
//
// ARCHITECTURE FIX (V5.3):
//  - Added purgeFloatingDamages() for explicit cleanup.
//  - useFloatingDamages cleanup clears all pending entries on unmount.
//  - Module-level arrays are deterministic on every spawn cycle.
// ════════════════════════════════════════════════════════════════════════════════

interface FloatingDamageEntry {
  id: string;
  amount: number;
  x: number;
  y: number;
}

const _entries: FloatingDamageEntry[] = [];
type Listener = (entries: FloatingDamageEntry[]) => void;
const _listeners = new Set<Listener>();

const _notify = () => {
  _listeners.forEach((fn) => fn([..._entries]));
};

/**
 * Spawn a floating damage number at the given viewport-relative (x%, y%).
 * The element auto-removes after 900ms.
 */
export const spawnFloatingDamage = (amount: number, x: number, y: number): string => {
  const id = `fd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  _entries.push({ id, amount, x, y });
  _notify();
  setTimeout(() => {
    const idx = _entries.findIndex((e) => e.id === id);
    if (idx !== -1) { _entries.splice(idx, 1); _notify(); }
  }, 900);
  return id;
};

/**
 * Purge all pending floating damage entries.
 * Called by useFloatingDamages cleanup to ensure CPU/Memory drops to 0 on unmount.
 */
export const purgeFloatingDamages = (): void => {
  _entries.length = 0;
  _notify();
};

/**
 * useFloatingDamages — React hook with explicit lifecycle cleanup.
 */
export function useFloatingDamages(): FloatingDamageEntry[] {
  const [entries, setEntries] = useState<FloatingDamageEntry[]>(_entries);
  useEffect(() => {
    const handler: Listener = (e) => setEntries(e);
    _listeners.add(handler);
    return () => {
      _listeners.delete(handler);
      // FIX: purge remaining entries when last listener unmounts
      if (_listeners.size === 0) {
        purgeFloatingDamages();
      }
    };
  }, []);
  return entries;
}

/**
 * FloatingDamageLayer — place once at BattleLayout root.
 * Renders all active floating damage numbers at viewport-relative positions.
 */
export function FloatingDamageLayer() {
  const entries = useFloatingDamages();

  return (
    <>
      {entries.map((entry) => (
        <FloatingDamageNumber
          key={entry.id}
          id={entry.id}
          amount={entry.amount}
          x={entry.x}
          y={entry.y}
        />
      ))}
    </>
  );
}

function FloatingDamageNumber({ amount, x, y }: { id: string; amount: number; x: number; y: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  const jitterX = (Math.random() - 0.5) * 8;
  const jitterY = (Math.random() - 0.5) * 6;
  const viewportScale = Math.max(0.72, Math.min(1.05, window.innerWidth / 390));
  const damageScale = viewportScale * 0.96;

  return (
    <span
      ref={ref}
      className="fixed pointer-events-none select-none"
      style={{
        left: `calc(${x}% + ${jitterX}px)`,
        top: `calc(${y}% + ${jitterY}px)`,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 'clamp(34px, 9.2vw, 58px)',
        fontWeight: 'bold',
        fontStyle: 'italic',
        letterSpacing: '-0.03em',
        color: '#FF4D9D',
        WebkitTextStroke: '2.5px rgba(255,255,255,0.92)',
        textShadow: `
          0 0 6px rgba(255,77,157,0.55),
          0 0 14px rgba(255,77,157,0.28),
          0 2px 2px rgba(18,10,24,0.5)
        `,
        filter: 'drop-shadow(0 2px 2px rgba(255,45,135,0.5))',
        lineHeight: 1,
        zIndex: 200,
        animation: 'fdRise 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        transform: `translate(-50%, -50%) scale(${damageScale})`,
        transformOrigin: 'center center',
      }}
    >
      -{amount}
      <style>{`
        @keyframes fdRise {
          0%   { opacity: 0; transform: translate(-50%, -50%) translateY(6px) scale(${damageScale * 0.92}); }
          12%  { opacity: 1; transform: translate(-50%, -50%) translateY(-4px) scale(${damageScale}); }
          100% { opacity: 0; transform: translate(-50%, -50%) translateY(-56px) scale(${damageScale * 0.82}); }
        }
      `}</style>
    </span>
  );
}
