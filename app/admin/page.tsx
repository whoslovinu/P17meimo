'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Users,
  Zap,
  Gem,
  TrendingUp,
  Settings,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/app/admin/lib/adminApi';

interface DashboardStats {
  totalUsers: number;
  activeUsers24h: number;
  totalDamage: number;
  bossCurrentHp: number;
  bossMaxHp: number;
  totalAttacks: number;
  milestoneClaims: number;
  pendingMilestones: number;
  activityName?: string;
  activityStartTime?: string;
  activityEndTime?: string;
  damageMin?: string;
  damageMax?: string;
  itemAName?: string;
  itemBName?: string;
  computedAt?: string;
}

const INITIAL_STATS: DashboardStats = {
  totalUsers: 0,
  activeUsers24h: 0,
  totalDamage: 0,
  bossCurrentHp: 0,
  bossMaxHp: 100000,
  totalAttacks: 0,
  milestoneClaims: 0,
  pendingMilestones: 0,
};

const STAT_CARDS = [
  { key: 'totalUsers',     label: '注册用户',  format: 'count' as const, sub: '累计' },
  { key: 'activeUsers24h', label: '活跃用户',  format: 'count' as const, sub: '24h' },
  { key: 'totalDamage',    label: '总伤害量',  format: 'count' as const, sub: '累计' },
  { key: 'totalAttacks',   label: '攻击次数',  format: 'count' as const, sub: '累计' },
  { key: 'bossHp',         label: 'BOSS HP',   format: 'hp' as const,    sub: '实时' },
  { key: 'milestoneClaims',label: '已领取奖励', format: 'milestone' as const, sub: '累计' },
];

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>(INITIAL_STATS);
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function loadStats(showLoading = false): Promise<void> {
    if (showLoading) setIsRefreshing(true);
    try {
      const res = await adminFetch('/api/admin/stats');
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error?.message ?? `HTTP ${res.status}`);
      }
      const body = await res.json();
      if (body?.ok && body?.data) {
        setStats({ ...INITIAL_STATS, ...body.data });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '刷新失败';
      toast.error(`数据刷新失败：${message}`);
    } finally {
      if (showLoading) setIsRefreshing(false);
    }
  }

  useEffect(() => {
    void loadStats();
    const id = window.setInterval(() => loadStats(false), 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
    return num.toLocaleString();
  };

  const hpPercent = stats.bossMaxHp > 0
    ? Math.max(0, Math.min(100, Math.round((stats.bossCurrentHp / stats.bossMaxHp) * 100)))
    : 0;

  return (
    <div>
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Dashboard</h1>
          <p className="admin-page-desc">后台管理概览</p>
        </div>
        <div className="flex items-center gap-3">
          {stats.computedAt && (
            <span className="text-xs text-zinc-500" title="Last server aggregation">
              数据更新于 {new Date(stats.computedAt).toLocaleTimeString('zh-CN')}
            </span>
          )}
          <button
            onClick={() => loadStats(true)}
            disabled={isRefreshing}
            className="admin-btn admin-btn-secondary admin-btn-sm"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </header>

      <div className="admin-stats-grid">
        {STAT_CARDS.map((card) => {
          let value: string;
          let subtext: string | null = null;
          if (card.format === 'hp') {
            value = `${hpPercent}%`;
            subtext = `${formatNumber(stats.bossCurrentHp)} / ${formatNumber(stats.bossMaxHp)}`;
          } else if (card.format === 'milestone') {
            value = formatNumber(stats.milestoneClaims);
            subtext = `${formatNumber(stats.pendingMilestones)} 待领`;
          } else {
            const raw = stats[card.key as keyof DashboardStats] as number;
            value = formatNumber(raw);
          }
          return (
            <div className="admin-stat-card" key={card.key}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider">{card.sub}</span>
              </div>
              <div className="admin-stat-value">{value}</div>
              <div className="admin-stat-label">
                {card.label}
                {subtext && <span className="text-zinc-600"> · {subtext}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="admin-card">
        <h2 className="admin-card-title">快捷入口</h2>
        <div className="grid grid-cols-3 gap-3">
          <Link
            href="/admin/activities"
            className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900 transition-colors"
          >
            <Settings size={20} className="text-zinc-400 mb-3" />
            <div className="text-zinc-100 font-medium text-sm mb-1">活动管理</div>
            <div className="text-xs text-zinc-500">创建、编辑和管理活动</div>
          </Link>

          <Link
            href="/admin/users"
            className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900 transition-colors"
          >
            <Users size={20} className="text-zinc-400 mb-3" />
            <div className="text-zinc-100 font-medium text-sm mb-1">用户管理</div>
            <div className="text-xs text-zinc-500">搜索、道具调整、强制解锁</div>
          </Link>

          <Link
            href="/admin/monitor"
            className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-900 transition-colors"
          >
            <Activity size={20} className="text-zinc-400 mb-3" />
            <div className="text-zinc-100 font-medium text-sm mb-1">实时监控</div>
            <div className="text-xs text-zinc-500">Redis/PG 状态、实时数据</div>
          </Link>
          {/*
            REPARK 7.0 (2026-09-11) P1-77 Phase B: Badge Management shortcut REMOVED.
            Local badge CRUD is deprecated. Milestone medalId preview now uses
            BadgeAdapter.getBadgeDetail() via /api/admin/badge/preview.
            CRUD page preserved at Phase C for rollback purposes.
          */}
        </div>
      </div>

      <div className="admin-card">
        <h2 className="admin-card-title">游戏信息</h2>
        {stats.activityName ? (
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="text-xs text-zinc-500 mb-1">活动名称</div>
              <div className="text-zinc-100 text-sm">{stats.activityName}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-1">活动时间</div>
              <div className="text-zinc-100 text-sm">
                {stats.activityStartTime} ~ {stats.activityEndTime}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-1">伤害范围</div>
              <div className="text-zinc-100 text-sm">
                {stats.damageMin} – {stats.damageMax} 点/次
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-1">道具类型</div>
              <div className="flex items-center gap-2 text-sm text-zinc-100">
                {stats.itemAName && <span>{stats.itemAName}</span>}
                {stats.itemAName && stats.itemBName && <span className="text-zinc-600">·</span>}
                {stats.itemBName && <span>{stats.itemBName}</span>}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-zinc-500 text-sm py-6 text-center">
            暂无进行中的活动
          </div>
        )}
      </div>
    </div>
  );
}