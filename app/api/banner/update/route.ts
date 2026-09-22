/**
 * PUT    /api/banner/update?id=<id>  — update banner row
 * DELETE /api/banner/update?id=<id>  — delete banner row
 *
 * Migrated from Supabase → AWS RDS via lib/db/activitiesPg.ts/bannerDb.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { updateBanner, deleteBanner } from '@/app/api/admin/activity/update/bannerDb';

export async function PUT(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Banner ID required' } },
        { status: 400 }
      );
    }

    const body = await req.json();

    const updates: Record<string, unknown> = {};
    if (body.image_url !== undefined) updates.imageUrl = body.image_url;
    if (body.redirect_id !== undefined) updates.targetActivityId = body.redirect_id || null;
    if (body.redirect_type !== undefined) updates.targetActivityId = body.redirect_id || null;
    if (body.is_active !== undefined) updates.isEnabled = body.is_active;
    if (body.show_countdown !== undefined) updates.showCountdown = body.show_countdown;
    if (body.sort_order !== undefined) updates.sortWeight = body.sort_order;

    const updated = await updateBanner(id, updates as Parameters<typeof updateBanner>[1]);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Banner not found' } },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    console.error('[BANNER:UPDATE:PUT] error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Failed to update banner',
        },
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Banner ID required' } },
        { status: 400 }
      );
    }
    const ok = await deleteBanner(id);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Banner not found' } },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[BANNER:UPDATE:DELETE] error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Failed to delete banner',
        },
      },
      { status: 500 }
    );
  }
}