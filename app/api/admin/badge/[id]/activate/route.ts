import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { activateBadge, getBadgeById } from '@/lib/db/pg';

/**
 * POST /api/admin/badge/[id]/activate — re-activate a soft-deleted badge.
 *
 * REPARK Phase 2 (2026-09-02): per product decision Q3, badges are never
 * hard-deleted. This endpoint flips is_active from false → true so a
 * previously deactivated badge becomes usable again without changing its ID.
 *
 * Body: empty.
 *
 * Response 200:
 *   { ok: true, data: { id: number, is_active: true } }
 *
 * Errors:
 *   400 BAD_REQUEST — malformed ID
 *   404 NOT_FOUND   — no row with that ID
 *   500 INTERNAL_ERROR
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const trimmed = id.trim();

  if (!trimmed || !/^-?\d+$/.test(trimmed)) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: '勋章 ID 必须是数字' },
    }, { status: 400 });
  }
  const numericId = Number(trimmed);

  // ── Existence check (works for both active and inactive rows) ───────────
  try {
    const existing = await getBadgeById(numericId);
    if (!existing) {
      // getBadgeById filters is_active=true — for an inactive row, do a
      // raw probe to distinguish 404 from already-active.
      const pool = (await import('@/lib/db/postgres')).getPostgresPool();
      const probe = await pool.query<{ is_active: boolean }>(
        'SELECT is_active FROM public.badges WHERE id = $1 LIMIT 1',
        [numericId]
      );
      if (probe.rows.length === 0) {
        return NextResponse.json({
          ok: false,
          error: { code: 'NOT_FOUND', message: '勋章 ID 不存在' },
        }, { status: 404 });
      }
      // Already active — idempotent success.
      return NextResponse.json({
        ok: true,
        data: { id: numericId, is_active: true },
      });
    }
  } catch (err) {
    console.error('[admin/badge/[id]/activate] DB lookup failed', err);
    return NextResponse.json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '勋章查询失败' },
    }, { status: 500 });
  }

  // ── Flip is_active=true ─────────────────────────────────────────────────
  let activated: boolean;
  try {
    activated = await activateBadge(numericId);
  } catch (err) {
    console.error('[admin/badge/[id]/activate] DB update failed', err);
    return NextResponse.json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '勋章激活失败' },
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: { id: numericId, is_active: true, changed: activated },
  });
}
