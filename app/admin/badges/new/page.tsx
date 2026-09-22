'use client';

/**
 * /admin/badges/new — Create a new badge (Phase 2).
 *
 * Submits to POST /api/admin/badge. On success, navigates to /admin/badges.
 *
 * NOTE: This is a thin client wrapper. The shared form lives in
 * BadgeEditorForm; this page only wires the submit + cancel handlers.
 */

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminFetch } from '@/app/admin/lib/adminApi';
import { BadgeEditorForm, type BadgeFormValues } from '../BadgeEditorForm';

export default function AdminBadgeNewPage() {
  const router = useRouter();

  const handleSubmit = async (values: BadgeFormValues) => {
    const res = await adminFetch('/api/admin/badge', {
      method: 'POST',
      body: JSON.stringify({
        name: values.name,
        thumbnail: values.thumbnail,
        description: values.description,
        is_active: values.is_active,
      }),
    });
    const body = await res.json();
    if (!body.ok) {
      throw new Error(body.error?.message ?? '创建勋章失败');
    }
    const created = body.data as { id: number; name: string };
    toast.success(`勋章 ${created.name} (ID ${created.id}) 已创建`);
    router.push('/admin/badges');
    router.refresh();
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
          <h1 className="admin-page-title">新建勋章</h1>
          <p className="admin-page-desc">
            ID 将由系统自动分配 (BIGSERIAL) · 创建后不可修改 ID
          </p>
        </div>
      </header>

      <div className="admin-card">
        <BadgeEditorForm
          mode="create"
          onSubmit={handleSubmit}
          onCancel={() => router.push('/admin/badges')}
        />
      </div>
    </div>
  );
}
