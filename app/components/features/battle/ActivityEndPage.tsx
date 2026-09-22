'use client';

import { motion } from 'framer-motion';
import { Trophy, Star, ArrowLeft, Crown } from 'lucide-react';

// ── Props ────────────────────────────────────────────────────────────────────────
interface ActivityEndPageProps {
  onRewardClick: (e: React.MouseEvent) => void;
  onBack: () => void;
}

// ════════════════════════════════════════════════════════════════════════════════
// TC-BT-14: Activity End Page
//
// Mandate:
//   - Full-screen overlay that mounts when countdown reaches 0.
//   - Preserves the "Progress Rewards" entry so users can claim milestones.
//   - Back button navigates home.
//   - Abyssal Black palette with spring-physics entrance animation.
// ════════════════════════════════════════════════════════════════════════════════

export function ActivityEndPage({ onRewardClick, onBack }: ActivityEndPageProps) {
  return (
    <motion.div
      key="activity-end-page"
      initial={{ opacity: 0, scale: 0.92, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -10 }}
      transition={{ type: 'spring', stiffness: 280, damping: 24, restDelta: 0.1 }}
      className="absolute inset-0 flex flex-col items-center justify-center z-[300] pointer-events-auto"
      style={{
        background: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Ambient glow behind title */}
      <div
        className="absolute top-[28%] left-1/2 -translate-x-1/2 w-[300px] h-[300px] pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(155,92,255,0.25) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />

      {/* Top: Crown icon */}
      <motion.div
        initial={{ opacity: 0, y: -30, scale: 0.6 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 20 }}
        className="relative mb-6"
      >
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(155,92,255,0.3), rgba(255,45,135,0.2))',
            border: '2px solid rgba(155,92,255,0.5)',
            boxShadow: '0 0 40px rgba(155,92,255,0.4), 0 0 80px rgba(155,92,255,0.2)',
          }}
        >
          <Crown size={36} color="rgba(196,165,255,0.9)" />
        </div>

        {/* Sparkle dots around crown */}
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{
              background: i % 2 === 0 ? '#FF2D87' : '#A855F7',
              boxShadow: i % 2 === 0 ? '0 0 8px #FF2D87' : '0 0 8px #A855F7',
              top: `${50 + 42 * Math.sin((i / 6) * 2 * Math.PI)}%`,
              left: `${50 + 42 * Math.cos((i / 6) * 2 * Math.PI)}%`,
              transform: 'translate(-50%, -50%)',
              animation: `endPageSparkle 2s ease-in-out infinite ${i * 0.3}s`,
            }}
          />
        ))}
      </motion.div>

      {/* Main Title */}
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, type: 'spring', stiffness: 260, damping: 22 }}
        className="relative text-3xl font-black tracking-widest mb-3 text-center"
        style={{
          fontFamily: "'Cinzel', 'Playfair Display', 'Times New Roman', serif",
          background: 'linear-gradient(135deg, #FDE047 0%, #FF8C00 30%, #FDE047 50%, #CA8A04 75%, #FDE047 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          filter: 'drop-shadow(0 0 16px rgba(253,224,71,0.6))',
          letterSpacing: '0.15em',
        }}
      >
        活动已结束
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-white/50 text-sm mb-10 text-center px-8"
        style={{ letterSpacing: '0.08em' }}
      >
        本次挑战已结束，感谢您的参与
      </motion.p>

      {/* Reward CTA — TC-BT-14: preserved entry point */}
      <motion.button
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, type: 'spring', stiffness: 300, damping: 22 }}
        onClick={onRewardClick}
        className="relative flex items-center gap-3 px-8 py-4 rounded-2xl mb-4 cursor-pointer"
        style={{
          touchAction: 'manipulation',
          background: 'linear-gradient(135deg, rgba(255,45,135,0.25) 0%, rgba(155,92,255,0.2) 100%)',
          border: '1.5px solid rgba(255,45,135,0.5)',
          boxShadow: '0 0 32px rgba(255,45,135,0.3), inset 0 0 16px rgba(255,45,135,0.1)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {/* Glow pulse */}
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at 50% 0%, rgba(255,45,135,0.15) 0%, transparent 60%)',
          }}
        />
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #FF2D87, #9B5CFF)',
            boxShadow: '0 0 16px rgba(255,45,135,0.5)',
          }}
        >
          <Trophy size={20} color="white" />
        </div>
        <div className="text-left">
          <div className="text-white font-semibold text-sm">进度奖励</div>
          <div className="text-white/50 text-xs">领取未完成的里程碑奖励</div>
        </div>
        <Star size={16} color="rgba(253,224,71,0.8)" className="ml-2" />
      </motion.button>

      {/* Back to Home */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.65 }}
        onClick={onBack}
        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white/40 hover:text-white/70
                   border border-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer"
        style={{ touchAction: 'manipulation' }}
      >
        <ArrowLeft size={14} />
        <span className="text-xs font-medium">返回首页</span>
      </motion.button>

      {/* Keyframes */}
      <style>{`
        @keyframes endPageSparkle {
          0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(0.8); }
          50%       { opacity: 1;   transform: translate(-50%, -50%) scale(1.2); }
        }
      `}</style>
    </motion.div>
  );
}
