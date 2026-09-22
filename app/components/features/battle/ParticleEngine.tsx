'use client';

import { useState, useEffect } from 'react';

// ════════════════════════════════════════════════════════════════════════════════
// PARTICLE ENGINE — Section 2.8
// Exposes `spawnParticles(type, x%, y%)`.
// Gold burst → item_hand (Pink Weapon). Blue burst → item_phallus (Blue Weapon).
// Physics: radial outward velocity, light gravity, fade-out over 600ms.
//
// ARCHITECTURE FIX (V5.3):
//  - RAF lifecycle now fully owned by useParticles() cleanup.
//  - Reference-counted stop: RAF only cancels when listeners.size === 0.
//  - Component unmount → CPU/Memory usage drops to 0.
// ════════════════════════════════════════════════════════════════════════════════

export type ParticleType = 'gold' | 'blue';

interface Particle {
  id: string;
  type: ParticleType;
  x: number;      // viewport %
  y: number;      // viewport %
  vx: number;     // px/frame
  vy: number;     // px/frame
  size: number;   // px
  life: number;   // 0–1 (1 = just spawned, 0 = dead)
  decay: number;   // how fast life decreases per frame
}

const _particles: Particle[] = [];
let _rafId: number | null = null;
type Listener = (particles: Particle[]) => void;
const _listeners = new Set<Listener>();

const GRAVITY = 0.25; // px/frame² downward pull
const DEFAULT_DECAY = 0.028; // life reduction per frame (~600ms at 60fps)

const COLORS = {
  gold: [
    'radial-gradient(circle, #FFD700 0%, #FFA500 50%, transparent 100%)',
    'radial-gradient(circle, #FFE55C 0%, #FFB347 50%, transparent 100%)',
    'radial-gradient(circle, #FFFACD 0%, #FFD700 50%, transparent 100%)',
  ],
  blue: [
    'radial-gradient(circle, #60A5FA 0%, #3B82F6 50%, transparent 100%)',
    'radial-gradient(circle, #93C5FD 0%, #60A5FA 50%, transparent 100%)',
    'radial-gradient(circle, #BFDBFE 0%, #93C5FD 50%, transparent 100%)',
  ],
};

const _notify = () => {
  _listeners.forEach((fn) => fn([..._particles]));
};

const _tick = () => {
  for (let i = _particles.length - 1; i >= 0; i--) {
    const p = _particles[i];
    p.vy += GRAVITY;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= p.decay;
    if (p.life <= 0) {
      _particles.splice(i, 1);
    }
  }
  _notify();
  _rafId = requestAnimationFrame(_tick);
};

/**
 * Internal: starts RAF loop only if no loop is currently running.
 * RAF is reference-counted — caller must pair with _stopRafIfIdle().
 */
const _ensureRaf = () => {
  if (_rafId === null) {
    _rafId = requestAnimationFrame(_tick);
  }
};

/**
 * Internal: stops RAF loop when no listeners remain.
 * Called by useParticles cleanup after removing the last listener.
 */
const _stopRafIfIdle = () => {
  if (_listeners.size === 0 && _rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
    _particles.length = 0;
  }
};

/**
 * Spawn a radial particle burst at viewport-relative position (x%, y%).
 * @param type 'gold' → Pink Weapon (item_hand). 'blue' → Blue Weapon (item_phallus).
 */
export const spawnParticles = (type: ParticleType, x: number, y: number): void => {
  _ensureRaf();
  const count = 16;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const speed = 3 + Math.random() * 5;
    const id = `p_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`;
    _particles.push({
      id,
      type,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2, // slight upward bias
      size: 4 + Math.random() * 6,
      life: 1,
      decay: DEFAULT_DECAY + Math.random() * 0.01,
    });
  }
};

/**
 * useParticles — React hook with FULL RAF lifecycle ownership.
 * Cleanup guarantees: CPU drops to 0, Memory drops to 0 on unmount.
 */
export function useParticles(): Particle[] {
  const [particles, setParticles] = useState<Particle[]>(_particles);
  useEffect(() => {
    const handler: Listener = (p) => setParticles(p);
    _listeners.add(handler);

    // Start RAF if this is the first listener
    _ensureRaf();

    return () => {
      _listeners.delete(handler);
      // FIX P-02: Stop RAF when last listener leaves
      _stopRafIfIdle();
    };
  }, []);
  return particles;
}

/** Place once at BattleLayout root. Renders all active particles. */
export function ParticleLayer() {
  const particles = useParticles();

  return (
    <>
      {particles.map((p) => {
        const colorIdx = Math.floor(
          Math.abs(p.id.charCodeAt(2) ?? 0) % COLORS[p.type].length
        );
        return (
          <div
            key={p.id}
            className="fixed pointer-events-none"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: COLORS[p.type][colorIdx],
              borderRadius: '50%',
              transform: `translate(-50%, -50%)`,
              opacity: Math.max(0, p.life),
              boxShadow: `0 0 ${p.size * 1.5}px ${COLORS[p.type][0]}`,
              zIndex: 199,
              transition: 'none',
            }}
          />
        );
      })}
    </>
  );
}
