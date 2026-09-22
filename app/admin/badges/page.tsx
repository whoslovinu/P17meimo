'use client';

/**
 * /admin/badges — Phase 2 (2026-09-02) Badge Admin CRUD list page.
 *
 * Scope:
 *   - list all badges (active + inactive)
 *   - search by name / id
 *   - filter by active state (all / active / inactive)
 *   - inline activate / deactivate buttons
 *   - create new badge → /admin/badges/new
 *   - edit badge → /admin/badges/[id]
 *
 * Out of scope (Phase 3):
 *   - batch import / clone / history audit
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  Plus,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Edit3,
  Image as ImageIcon,
  Power,
  PowerOff,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/app/admin/lib/adminApi';

interface BadgeRow {
  id: number;
  name: string;
  thumbnail: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type StatusFilter = 'all' | 'active' | 'inactive';

export default function AdminBadgesListPage() {
  const router = useRouter();
  const [badges, setBadges]       = useState<BadgeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pendingId, setPendingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminFetch('/api/admin/badge');
      const body = await res.json();
      if (!body.ok) {
        throw new Error(body.error?.message ?? '加载勋章列表失败');
      }
      setBadges((body.data ?? []) as BadgeRow[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载勋章列表失败';
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return badges.filter((b) => {
      if (statusFilter === 'active' && !b.is_active) return false;
      if (statusFilter === 'inactive' && b.is_active) return false;
      if (!term) return true;
      if (b.name.toLowerCase().includes(term)) return true;
      return String(b.id).includes(term);
    });
  }, [badges, search, statusFilter]);

  const stats = useMemo(() => {
    let active = 0;
    let inactive = 0;
    for (const b of badges) {
      if (b.is_active) active += 1;
      else inactive += 1;
    }
    return { total: badges.length, active, inactive };
  }, [badges]);

  const handleToggle = useCallback(
    async (badge: BadgeRow) => {
      const action = badge.is_active ? 'deactivate' : 'activate';
      const next   = !badge.is_active;
      setPendingId(badge.id);
      try {
        const res = await adminFetch(`/api/admin/badge/${badge.id}/${action}`, {
          method: 'POST',
        });
        const body = await res.json();
        if (!body.ok) {
          throw new Error(body.error?.message ?? `${action} 失败`);
        }
        toast.success(next ? `${badge.name} 已激活` : `${badge.name} 已停用`);
        setBadges((prev) =>
          prev.map((b) => (b.id === badge.id ? { ...b, is_active: next } : b))
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : `${action} 失败`;
        toast.error(message);
      } finally {
        setPendingId(null);
      }
    },
    []
  );

  return (
    <div>
      <header className="admin-page-header">
        <div>
          <h1 className="admin-page-title">勋章管理</h1>
          <p className="admin-page-desc">
            管理活动里程碑奖励引用的勋章图鉴 · 共 {stats.total} 个
            （{stats.active} 启用 / {stats.inactive} 停用）
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => load()}
            disabled={isLoading}
            className="admin-btn admin-btn-secondary admin-btn-sm"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            刷新
          </button>
          <Link
            href="/admin/badges/new"
            className="admin-btn admin-btn-primary admin-btn-sm"
          >
            <Plus size={13} />
            新建勋章
          </Link>
        </div>
      </header>

      <div className="admin-card">
        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="按名称或 ID 搜索"
              className="admin-input w-full pl-9"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 p-1">
            {(['all', 'active', 'inactive'] as StatusFilter[]).map((key) => {
              const labelMap: Record<StatusFilter, string> = {
                all: '全部',
                active: '启用',
                inactive: '停用',
              };
              const active = statusFilter === key;
              return (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    active
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {labelMap[key]}
                </button>
              );
            })}
          </div>
        </div>

        {isLoading && badges.length === 0 ? (
          <div className="py-12 text-center text-zinc-500 text-sm">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-zinc-500 text-sm">
            {badges.length === 0 ? '暂无勋章,点击右上角"新建勋章"开始' : '没有匹配的勋章'}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((badge) => (
              <BadgeCard
                key={badge.id}
                badge={badge}
                pending={pendingId === badge.id}
                onToggle={() => handleToggle(badge)}
                onEdit={() => router.push(`/admin/badges/${badge.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

interface BadgeCardProps {
  badge:    BadgeRow;
  pending:  boolean;
  onToggle: () => void;
  onEdit:   () => void;
}

function BadgeCard({ badge, pending, onToggle, onEdit }: BadgeCardProps) {
  return (
    <div
      className={`relative rounded-lg border p-3 transition-colors ${
        badge.is_active
          ? 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-600'
          : 'border-zinc-800/50 bg-zinc-900/20 opacity-60'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-14 h-14 shrink-0 rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800 flex items-center justify-center">
          {badge.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={badge.thumbnail}
              alt={badge.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                const target = e.currentTarget;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent && !parent.querySelector('.badge-img-fallback')) {
                  const fallback = document.createElement('div');
                  fallback.className = 'badge-img-fallback text-zinc-600';
                  parent.appendChild(fallback);
                }
              }}
            />
          ) : (
            <ImageIcon size={20} className="text-zinc-600" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-zinc-500">ID {badge.id}</span>
            {!badge.is_active && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-700 text-zinc-400">
                已停用
              </span>
            )}
          </div>
          <h3 className="font-semibold text-zinc-100 text-sm mt-0.5 truncate">
            {badge.name}
          </h3>
          {badge.description && (
            <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2">
              {badge.description}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1">
        <button
          onClick={onToggle}
          disabled={pending}
          title={badge.is_active ? '停用' : '激活'}
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
        >
          {badge.is_active ? <PowerOff size={14} /> : <Power size={14} />}
        </button>
        <button
          onClick={onEdit}
          title="编辑"
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        >
          <Edit3 size={14} />
        </button>
      </div>
    </div>
  );
}
