'use client';

/**
 * app/components/features/battle/LeaderboardSheet.tsx
 * V5.17 | Agent 1 [Cyber-Blacksmith]
 *
 * Real-time global damage leaderboard — live AWS RDS data.
 * Top-3: Gold / Silver / Bronze visual accents.
 * Ranks 4-50: elegant compact list.
 *
 * NOTE: This component does NOT create its own portal or AnimatePresence.
 * SubPageModal wraps it in a portal + AnimatePresence at the outer level.
 * Rendering a portal inside a portal with AnimatePresence causes exit/visible
 * animation conflicts under React StrictMode double-mount.
 */

import { useCallback, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Crown } from 'lucide-react';
import { fetchWithTimeout, FetchError } from '@/app/lib/fetchWithTimeout';

// ── API types ──────────────────────────────────────────────────────────────────

interface LeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  avatar: string;
  totalDamage: number;
}

interface LeaderboardData {
  entries: LeaderboardEntry[];
  fetchedAt: string;
}

// ── Spring physics config (mirrors TaskSheet.tsx) ───────────────────────────────
// NOTE: Animation variants removed — SubPageModal provides the portal + animation shell.
// LeaderboardSheet now only renders content, not a portal wrapper.

// ── Medal badge component ──────────────────────────────────────────────────────

const MEDAL_STYLES: Record<1 | 2 | 3, { gradient: string; glow: string; label: string }> = {
  1: {
    gradient: 'linear-gradient(135deg, #FFD700, #FFA500)',
    glow: '0 0 20px rgba(255,215,0,0.5), 0 0 40px rgba(255,165,0,0.2)',
    label: '🥇',
  },
  2: {
    gradient: 'linear-gradient(135deg, #C0C0C0, #A0A8B0)',
    glow: '0 0 16px rgba(192,192,192,0.4)',
    label: '🥈',
  },
  3: {
    gradient: 'linear-gradient(135deg, #CD7F32, #A0522D)',
    glow: '0 0 14px rgba(205,127,50,0.4)',
    label: '🥉',
  },
};

function MedalBadge({ rank }: { rank: 1 | 2 | 3 }) {
  const s = MEDAL_STYLES[rank];
  return (
    <div
      className="flex items-center justify-center rounded-full w-9 h-9 shrink-0"
      style={{ background: s.gradient, boxShadow: s.glow }}
    >
      <span className="text-base leading-none">{s.label}</span>
    </div>
  );
}

// ── Rank badge for 4-50 ───────────────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-full w-7 h-7 shrink-0 text-xs font-bold"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: '#8b949e',
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {rank}
    </div>
  );
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function LeaderboardRow({ entry, isTop3 }: { entry: LeaderboardEntry; isTop3: boolean }) {
  if (isTop3) {
    return (
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: entry.rank * 0.06 }}
        className="flex items-center gap-3 p-4 rounded-2xl"
        style={{
          background:
            entry.rank === 1
              ? 'rgba(255,215,0,0.08)'
              : entry.rank === 2
              ? 'rgba(192,192,192,0.06)'
              : 'rgba(205,127,50,0.06)',
          border:
            entry.rank === 1
              ? '1px solid rgba(255,215,0,0.25)'
              : entry.rank === 2
              ? '1px solid rgba(192,192,192,0.2)'
              : '1px solid rgba(205,127,50,0.2)',
        }}
      >
        <MedalBadge rank={entry.rank as 1 | 2 | 3} />
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            fontSize: entry.rank === 1 ? '1.4rem' : '1.2rem',
          }}
        >
          {entry.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-semibold truncate pr-2"
            style={{
              color: entry.rank === 1 ? '#FFD700' : entry.rank === 2 ? '#C0C0C0' : '#CD7F32',
            }}
          >
            {entry.nickname}
          </p>
          {entry.rank === 1 && (
            <p className="text-[10px] text-amber-400/60 mt-0.5 flex items-center gap-1">
              <Crown size={10} />
              消耗电量排行榜冠军
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p
            className="text-sm font-bold"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: entry.rank === 1 ? '#FFD700' : entry.rank === 2 ? '#C0C0C0' : '#CD7F32',
            }}
          >
            {entry.totalDamage.toLocaleString()}
          </p>
          <p className="text-[10px] text-white/30">点伤害</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: (entry.rank - 3) * 0.025 }}
      className="flex items-center gap-3 px-2 py-2.5 rounded-xl"
      style={{ background: 'rgba(255,255,255,0.02)' }}
    >
      <RankBadge rank={entry.rank} />
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0"
        style={{ background: 'rgba(255,255,255,0.05)' }}
      >
        {entry.avatar}
      </div>
      <p className="flex-1 text-xs text-white/70 truncate">{entry.nickname}</p>
      <p
        className="text-xs font-semibold shrink-0"
        style={{ fontFamily: "'JetBrains Mono', monospace", color: '#9b5cff' }}
      >
        {entry.totalDamage.toLocaleString()}
        <span className="text-[10px] text-white/30 ml-1">点伤害</span>
      </p>
    </motion.div>
  );
}

// ── Skeleton rows ──────────────────────────────────────────────────────────────

function SkeletonRow({ rank }: { rank: number }) {
  return (
    <div className="flex items-center gap-3 px-2 py-2.5">
      <div
        className="w-7 h-7 rounded-full animate-pulse shrink-0"
        style={{ background: 'rgba(255,255,255,0.06)' }}
      />
      <div
        className="w-8 h-8 rounded-full animate-pulse shrink-0"
        style={{ background: 'rgba(255,255,255,0.05)' }}
      />
      <div
        className="flex-1 h-4 rounded animate-pulse"
        style={{ background: 'rgba(255,255,255,0.05)', width: `${60 + (rank % 3) * 15}%` }}
      />
    </div>
  );
}

// ── Main sheet component ───────────────────────────────────────────────────────

interface LeaderboardSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LeaderboardSheet({ isOpen, onClose }: LeaderboardSheetProps) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch on open
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);

    const controller = new AbortController();

    fetchWithTimeout('/api/battle/leaderboard', {
      signal: controller.signal,
      timeoutMs: 8000,
    })
      .then((result) => {
        const json = result.data as { ok: boolean; data?: { entries?: LeaderboardEntry[]; total_count?: number }; error?: { message: string } } | null;
        if (json?.ok && json.data) {
          setData(json.data as LeaderboardData);
        } else {
          setError(json?.error?.message ?? '加载失败');
        }
      })
      .catch((e) => {
        if (e instanceof FetchError && (e.payload.kind === 'ABORTED' || e.name === 'AbortError')) {
          return;
        }
        console.error('[LeaderboardSheet] Fetch Error:', {
          kind: e instanceof FetchError ? e.payload.kind : 'unknown',
          elapsedMs: e instanceof FetchError ? e.payload.elapsedMs : -1,
          url: '/api/battle/leaderboard',
        });
        if (e instanceof FetchError && e.payload.kind === 'TIMEOUT') {
          setError(`请求超时（${e.payload.elapsedMs.toFixed(0)}ms），请检查网络`);
        } else {
          setError(`网络异常：${e instanceof Error ? e.message : '未知错误'}`);
        }
      })
      .finally(() => setLoading(false));

    return () => {
      controller.abort();
    };
  }, [isOpen]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const top3 = data?.entries.slice(0, 3) ?? [];
  const rest = data?.entries.slice(3) ?? [];

  return (
    <div className="w-full flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 border-b shrink-0"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🏆</span>
          <div>
            <h2 className="text-sm font-bold text-white">电量排行榜</h2>
            <p className="text-[10px] text-white/35">
              {data
                ? `全服玩家 · ${data.entries.length} 人上榜 · ${new Date(data.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 更新`
                : '实时更新中…'}
            </p>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <X size={15} className="text-white/60" />
        </button>
      </div>

      {/* Content — flex-1 + overflow-y-auto so the list actually scrolls. */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2 leaderboard-scroll"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
        }}
      >
        <style>{`
          .leaderboard-scroll::-webkit-scrollbar {
            width: 3px;
          }
          .leaderboard-scroll::-webkit-scrollbar-track {
            background: rgba(255,255,255,0.03);
            border-radius: 2px;
          }
          .leaderboard-scroll::-webkit-scrollbar-thumb {
            background: rgba(155,92,255,0.5);
            border-radius: 2px;
          }
          .leaderboard-scroll::-webkit-scrollbar-thumb:hover {
            background: rgba(155,92,255,0.8);
          }
          .leaderboard-scroll {
            scrollbar-width: thin;
            scrollbar-color: rgba(155,92,255,0.5) rgba(255,255,255,0.03);
          }
        `}</style>

        {/* Top 3 */}
        {loading && top3.length === 0 ? (
          <>
            {[1, 2, 3].map((r) => (
              <SkeletonRow key={r} rank={r} />
            ))}
          </>
        ) : top3.length > 0 ? (
          <div className="space-y-2 mb-2">
            {top3.map((entry) => (
              <LeaderboardRow key={entry.userId} entry={entry} isTop3 />
            ))}
          </div>
        ) : null}

        {/* Ranks 4+ */}
        {rest.length > 0 && (
          <>
            <div
              className="text-[10px] font-semibold text-white/30 uppercase tracking-wider px-2 pt-1 pb-0.5"
            >
              其他玩家
            </div>
            {loading && rest.length === 0 ? (
              <>
                {[4, 5, 6, 7, 8].map((r) => (
                  <SkeletonRow key={r} rank={r} />
                ))}
              </>
            ) : rest.length > 0 ? (
              rest.map((entry) => (
                <LeaderboardRow key={entry.userId} entry={entry} isTop3={false} />
              ))
            ) : null}
          </>
        )}

        {/* Empty state */}
        {!loading && data?.entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <span className="text-4xl mb-3">📭</span>
            <p className="text-sm text-white/40">暂无排行数据</p>
            <p className="text-xs text-white/20 mt-1">玩家开始攻击后将显示排行榜</p>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center justify-center py-10">
            <span className="text-3xl mb-3">⚠️</span>
            <p className="text-sm text-red-400">{error}</p>
            <p className="text-xs text-white/30 mt-1">请检查网络后下拉重试</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 pb-4 pt-1 shrink-0">
        <p className="text-center text-[10px] text-white/15">
          仅显示前 50 名 · 关闭后再次打开将重新拉取
        </p>
      </div>
    </div>
  );
}
