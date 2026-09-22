import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { deactivateBadge, getBadgeById } from '@/lib/db/pg';

/**
 * POST /api/admin/badge/[id]/deactivate — soft-delete a badge.
 *
 * REPARK Phase 2 (2026-09-02): per product decision Q3, badges are NEVER
 * hard-deleted. This endpoint flips is_active from true → false. The row
 * remains in public.badges so historical milestone_rewards rows that
 * reference it stay resolvable, and the admin can re-activate it later
 * via /activate without changing its ID.
 *
 * Body: empty.
 *
 * Response 200:
 *   { ok: true, data: { id: number, is_active: false } }
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

  // ── Existence check ─────────────────────────────────────────────────────
  let existing;
  try {
    existing = await getBadgeById(numericId);
    if (!existing) {
      // May be inactive — probe raw row.
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
      // Already inactive — idempotent success.
      return NextResponse.json({
        ok: true,
        data: { id: numericId, is_active: false },
      });
    }
  } catch (err) {
    console.error('[admin/badge/[id]/deactivate] DB lookup failed', err);
    return NextResponse.json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '勋章查询失败' },
    }, { status: 500 });
  }
  void existing; // existence verified

  // ── Flip is_active=false ────────────────────────────────────────────────
  let deactivated: boolean;
  try {
    deactivated = await deactivateBadge(numericId);
  } catch (err) {
    console.error('[admin/badge/[id]/deactivate] DB update failed', err);
    return NextResponse.json({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '勋章停用失败' },
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    data: { id: numericId, is_active: false, changed: deactivated },
  });
}
