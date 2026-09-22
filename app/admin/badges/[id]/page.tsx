'use client';

/**
 * /admin/badges/[id] — Edit an existing badge (Phase 2).
 *
 * Loads the badge (allowing inactive rows via raw probe), then renders the
 * shared BadgeEditorForm. Submits to PUT /api/admin/badge/[id].
 */

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/app/admin/lib/adminApi';
import { BadgeEditorForm, type BadgeFormValues } from '../BadgeEditorForm';

interface BadgeRow {
  id: number;
  name: string;
  thumbnail: string;
  description: string;
  is_active: boolean;
}

export default function AdminBadgeEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const numericId = /^-?\d+$/.test(id) ? Number(id) : null;

  const [badge,    setBadge]    = useState<BadgeRow | null>(null);
  const [loadErr,  setLoadErr]  = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (numericId === null) {
      setLoadErr('勋章 ID 格式错误');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch(`/api/admin/badge/${numericId}`);
        const body = await res.json();
        if (cancelled) return;
        if (!body.ok) {
          setLoadErr(body.error?.message ?? '加载勋章失败');
        } else {
          setBadge(body.data as BadgeRow);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : '加载勋章失败';
        setLoadErr(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [numericId]);

  const handleSubmit = async (values: BadgeFormValues) => {
    if (numericId === null) return;
    const res = await adminFetch(`/api/admin/badge/${numericId}`, {
      method: 'PUT',
      body: JSON.stringify(values),
    });
    const body = await res.json();
    if (!body.ok) {
      throw new Error(body.error?.message ?? '保存勋章失败');
    }
    const updated = body.data as BadgeRow;
    toast.success(`勋章 ${updated.name} 已保存`);
    setBadge(updated);
  };

  return (
    <div>
      <header className="admin-page-header">
        <div>
          <button
            onClick={() => router.push('/admin/badges')}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mb-2"
          >
            <ArrowLeft size={12} />
            返回勋章列表
          </button>
          <h1 className="admin-page-title">
            {loading ? '加载中…' : badge ? `编辑勋章 · ${badge.name}` : '编辑勋章'}
          </h1>
          <p className="admin-page-desc">
            修改勋章的名称、缩略图、描述和启用状态
          </p>
        </div>
      </header>

      <div className="admin-card">
        {loading ? (
          <div className="py-12 text-center text-zinc-500 text-sm">加载中…</div>
        ) : loadErr ? (
          <div className="py-12 text-center text-red-400 text-sm">{loadErr}</div>
        ) : badge ? (
          <BadgeEditorForm
            mode="edit"
            initial={{
              id:          badge.id,
              name:        badge.name,
              thumbnail:   badge.thumbnail,
              description: badge.description,
              is_active:   badge.is_active,
            }}
            onSubmit={handleSubmit}
            onCancel={() => router.push('/admin/badges')}
          />
        ) : null}
      </div>
    </div>
  );
}
