'use client';

interface SuccubusSilhouetteProps {
  size?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 1: "Real Meimo" Silhouette
// Asset priority:
//   1. /meimo-silhouette.png  — user-provided high-quality assembled character
//   2. /spine/assets/boss/idle_1.png — primary atlas page (fallback)
//
// CSS silhouette technique:
//   brightness(0)  → pure black, no colour bleed
//   drop-shadow    → purple glow halo (Section 1.2 spec: 15px spread)
//
// Float animation: 3s ease-in-out translateY 0 → -10px
// ═══════════════════════════════════════════════════════════════════════════════
const SILHOUETTE_PRIMARY  = '/meimo-silhouette.png';
const SILHOUETTE_FALLBACK = '/spine/assets/boss/idle_1.png';

export function SuccubusSilhouette({ size = 240 }: SuccubusSilhouetteProps) {
  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width:     size,
        height:    size,
        animation: 'meimoFloat 3s ease-in-out infinite',
      }}
    >
      {/* Primary layer — user-provided assembled character */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={SILHOUETTE_PRIMARY}
        alt="Meimo silhouette"
        className="pointer-events-none select-none"
        style={{
          width:     '100%',
          height:   '100%',
          objectFit: 'contain',
          // Section 1.2 spec: brightness(0) + drop-shadow(0 0 15px #A855F7)
          filter: 'brightness(0) drop-shadow(0 0 15px rgba(168,85,247,0.9)) drop-shadow(0 0 30px rgba(168,85,247,0.4))',
        }}
        draggable={false}
        onError={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          if (img.src !== window.location.origin + SILHOUETTE_FALLBACK) {
            img.src = SILHOUETTE_FALLBACK;
          }
        }}
      />

      {/* Inner accent glow — tighter pink halo for depth */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={SILHOUETTE_PRIMARY}
        alt=""
        className="absolute pointer-events-none select-none"
        style={{
          width:     '100%',
          height:    '100%',
          objectFit: 'contain',
          filter:   'brightness(0) drop-shadow(0 0 6px rgba(236,72,153,0.8))',
          opacity:  0.55,
        }}
        draggable={false}
        onError={(e) => {
          const img = e.currentTarget as HTMLImageElement;
          if (img.src !== window.location.origin + SILHOUETTE_FALLBACK) {
            img.src = SILHOUETTE_FALLBACK;
          }
        }}
      />

      {/* Pulsing ambient ring — concentric, staggered */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset:       '8%',
          border:      '1px solid rgba(168,85,247,0.35)',
          animation:   'meimoRing 2.5s ease-in-out infinite',
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset:       '4%',
          border:      '1px solid rgba(236,72,153,0.2)',
          animation:   'meimoRing 2.5s ease-in-out infinite 1.25s',
        }}
      />

      <style>{`
        @keyframes meimoFloat {
          0%, 100% { transform: translateY(0);    }
          50%       { transform: translateY(-10px); }
        }
        @keyframes meimoRing {
          0%, 100% { transform: scale(1);    opacity: 0.3; }
          50%       { transform: scale(1.15); opacity: 0.08; }
        }
      `}</style>
    </div>
  );
}
