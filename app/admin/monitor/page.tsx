'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/app/admin/lib/adminApi';
import toast from 'react-hot-toast';
import {
  RefreshCw, ShieldAlert, HeartPulse, Database, RotateCcw, X,
  AlertTriangle, CheckCircle2, Activity,
} from 'lucide-react';

interface BossStats {
  currentHp: number;
  maxHp: number;
  version: number;
  lastUpdatedAt: string;
}

interface SyncStatus {
  redisHp: number | null;
  postgresHp: number | null;
  drift: number | null;
  isHealthy: boolean;
}

const DEFAULT_MAX_HP = 100000;

export default function AdminMonitorPage() {
  const [bossStats, setBossStats]   = useState<BossStats | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isLoading, setIsLoading]   = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const [isResetting, setIsResetting] = useState(false);
  const [isSyncing,   setIsSyncing]   = useState(false);
  const [resetTarget, setResetTarget] = useState<{ currentHp: string; maxHp: string } | null>(null);

  // P0 2026-07-30: call the new unified /api/admin/monitor endpoint instead of
  // two separate client-side fetch() calls.  One round-trip, no race conditions,
  // no field-mismatch bugs.
  const fetchStats = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/monitor');
      const data = await res.json();

      if (!data.ok) {
        toast.error(data.error?.message ?? '监控数据刷新失败');
        return;
      }

      const d = data.data;

      // Boss stats from the unified response.
      if (d.redis.currentHp !== null && d.redis.maxHp !== null) {
        setBossStats({
          currentHp: d.redis.currentHp,
          maxHp:     d.redis.maxHp,
          version:   0,
          lastUpdatedAt: d.checkedAt,
        });
      }

      setSyncStatus({
        redisHp:    d.redis.currentHp,
        postgresHp: d.postgres.currentHp,
        drift:      d.drift ?? 0,
        isHealthy:  d.isHealthy ?? true,
      });

      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      toast.error('监控数据刷新失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(() => fetchStats(), 5000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const handleReset = useCallback(async () => {
    if (!resetTarget) return;
    const currentHp = Number(resetTarget.currentHp);
    const maxHp     = Number(resetTarget.maxHp);
    if (!Number.isFinite(currentHp) || !Number.isFinite(maxHp) || maxHp <= 0) {
      toast.error('数值无效，请输入合法的 HP');
      return;
    }
    setIsResetting(true);
    try {
      const res = await adminFetch('/api/admin/boss/update-hp', {
        method: 'POST',
        body: JSON.stringify({ currentHp, maxHp }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(`Boss HP 已更新为 ${currentHp.toLocaleString()} / ${maxHp.toLocaleString()}`);
        setResetTarget(null);
        await fetchStats();
      } else {
        toast.error(data.error?.message ?? '重置失败');
      }
    } catch {
      toast.error('网络错误，重置失败');
    } finally {
      setIsResetting(false);
    }
  }, [resetTarget, fetchStats]);

  const handleForceSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await adminFetch('/api/admin/boss/update-hp', {
        method: 'POST',
        body: JSON.stringify({
          currentHp: syncStatus?.postgresHp ?? DEFAULT_MAX_HP,
          maxHp:     bossStats?.maxHp        ?? DEFAULT_MAX_HP,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success('已强制以 PostgreSQL 为准同步到 Redis');
        await fetchStats();
      } else {
        toast.error(data.error?.message ?? '同步失败');
      }
    } catch {
      toast.error('网络错误，同步失败');
    } finally {
      setIsSyncing(false);
    }
  }, [syncStatus, bossStats, fetchStats]);

  // Safe-render guards
  const safeCurrentHp = typeof bossStats?.currentHp === 'number' ? bossStats.currentHp : 0;
  const safeMaxHp    = typeof bossStats?.maxHp === 'number' && bossStats.maxHp > 0 ? bossStats.maxHp : 1;
  const hpPercent    = (safeCurrentHp / safeMaxHp) * 100;
  const hpIsLow      = hpPercent <= 25;
  const hpIsMid      = hpPercent > 25 && hpPercent <= 50;

  return (
    <div>
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">实时监控</h1>
          <p className="admin-page-desc">
            系统状态监控，最后更新：{lastRefresh.toLocaleTimeString()}
          </p>
        </div>
        <button onClick={() => fetchStats()} className="admin-btn admin-btn-secondary admin-btn-sm">
          <RefreshCw size={13} />
          刷新
        </button>
      </header>

      {/* Boss HP Status */}
      <div className="admin-card">
        <div className="flex items-center gap-2 mb-4">
          <HeartPulse size={15} className="text-zinc-500" />
          <h2 className="admin-card-title !mb-0 !pb-0">Boss 状态</h2>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500 py-4">
            <RefreshCw size={14} className="animate-spin" />加载中…
          </div>
        ) : bossStats ? (
          <>
            <div className="mb-4">
              <div className="flex justify-between mb-2 text-sm">
                <span className="text-zinc-300">
                  HP：<span className="font-mono">{safeCurrentHp.toLocaleString()}</span> / <span className="font-mono">{safeMaxHp.toLocaleString()}</span>
                </span>
                <span className={`font-mono font-medium ${hpIsLow ? 'text-red-400' : hpIsMid ? 'text-zinc-400' : 'text-zinc-100'}`}>
                  {hpPercent.toFixed(1)}%
                </span>
              </div>
              <div className="h-2.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                <div
                  className={`h-full transition-all duration-300 ${
                    hpIsLow ? 'bg-red-500' : hpIsMid ? 'bg-zinc-400' : 'bg-zinc-100'
                  }`}
                  style={{ width: `${hpPercent}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider">当前 HP</div>
                <div className="mt-1 font-mono text-lg text-zinc-100">{safeCurrentHp.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider">最大 HP</div>
                <div className="mt-1 font-mono text-lg text-zinc-100">{safeMaxHp.toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider">版本号</div>
                <div className="mt-1 font-mono text-lg text-zinc-100">{bossStats.version}</div>
              </div>
            </div>
          </>
        ) : (
          <div className="admin-alert admin-alert-error">无法获取 Boss 状态</div>
        )}
      </div>

      {/* Sync Status */}
      <div className="admin-card">
        <div className="flex items-center gap-2 mb-4">
          <Database size={15} className="text-zinc-500" />
          <h2 className="admin-card-title !mb-0 !pb-0">Redis ↔ PostgreSQL 同步状态</h2>
        </div>

        {syncStatus ? (
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  syncStatus.isHealthy ? 'bg-zinc-100' : 'bg-red-500'
                }`}
              />
              <span className={`text-sm font-medium ${syncStatus.isHealthy ? 'text-zinc-100' : 'text-red-400'}`}>
                {syncStatus.isHealthy ? '健康' : '数据不一致'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider">Redis HP</div>
                <div className="mt-1 font-mono text-sm text-zinc-100">
                  {syncStatus.redisHp?.toLocaleString() ?? 'N/A'}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider">PostgreSQL HP</div>
                <div className="mt-1 font-mono text-sm text-zinc-100">
                  {syncStatus.postgresHp?.toLocaleString() ?? 'N/A'}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="text-[11px] text-zinc-500 uppercase tracking-wider">数据漂移</div>
                <div className={`mt-1 font-mono text-sm ${
                  Math.abs(syncStatus.drift ?? 0) <= 1 ? 'text-zinc-100' : 'text-red-400'
                }`}>
                  {syncStatus.drift ?? 0}
                </div>
              </div>
            </div>

            {!syncStatus.isHealthy && (
              <div className="mt-4 flex items-start gap-3">
                <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-zinc-400 mb-2">
                    检测到 Redis 与 PostgreSQL 数据漂移。点击下方按钮将强制以 DB 为准同步到 Redis。
                  </p>
                  <button
                    onClick={handleForceSync}
                    disabled={isSyncing}
                    className="admin-btn admin-btn-secondary admin-btn-sm"
                  >
                    {isSyncing ? <RefreshCw size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    强制以 DB 同步到 Redis
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-zinc-500 py-4">
            <RefreshCw size={14} className="animate-spin" />加载中…
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="admin-card">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={15} className="text-zinc-500" />
          <h2 className="admin-card-title !mb-0 !pb-0">快速操作</h2>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => fetchStats()} className="admin-btn admin-btn-secondary">
            <RefreshCw size={13} />刷新数据
          </button>
          <button
            onClick={() => setResetTarget({
              currentHp: String(safeMaxHp),
              maxHp:     String(safeMaxHp),
            })}
            className="admin-btn admin-btn-danger"
          >
            <ShieldAlert size={13} />重置 Boss HP
          </button>
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {resetTarget && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3 text-zinc-100">
              <ShieldAlert size={16} className="text-red-400" />
              <h3 className="admin-modal-title">重置 Boss HP</h3>
            </div>
            <p className="admin-modal-desc">
              此操作将立即覆盖 Boss 血量。下方可指定具体数值（默认重置为满血）。
            </p>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="admin-label">当前 HP</label>
                <input
                  type="number"
                  min={0}
                  value={resetTarget.currentHp}
                  onChange={(e) => setResetTarget((p) => p ? { ...p, currentHp: e.target.value } : p)}
                  className="admin-input"
                />
              </div>
              <div>
                <label className="admin-label">最大 HP</label>
                <input
                  type="number"
                  min={1}
                  value={resetTarget.maxHp}
                  onChange={(e) => setResetTarget((p) => p ? { ...p, maxHp: e.target.value } : p)}
                  className="admin-input"
                />
              </div>
            </div>

            <div className="admin-modal-actions">
              <button
                onClick={() => setResetTarget(null)}
                disabled={isResetting}
                className="admin-btn admin-btn-secondary"
              >
                <X size={13} />取消
              </button>
              <button
                onClick={handleReset}
                disabled={isResetting}
                className="admin-btn admin-btn-danger"
              >
                {isResetting ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}