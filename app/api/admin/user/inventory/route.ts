/**
 * POST /api/admin/user/inventory — Upsert a user's inventory counts.
 * Migrated from Supabase → AWS RDS via lib/db/pg.ts.
 *
 * FIX H-1: Bounded numeric inputs.
 *   - Both item counts are clamped to [0, MAX_ITEM_PER_TYPE].
 *   - Anything outside that range is rejected with HTTP 400 (no silent coercing).
 *   - Default MAX is conservative; an operator can raise it via env if a
 *     campaign legitimately hands out absurd amounts.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { logAdminAction } from '@/lib/auditLog';
import { getClientIp, getOperatorId } from '@/lib/auditLog';

const DEFAULT_MAX_ITEM_PER_TYPE = 999_999;

function clampBoundary(value: unknown, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max || !Number.isInteger(n)) {
    throw new Error(`item count must be an integer in [0, ${max}]`);
  }
  return n;
}

export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    const { userId, item_hand_count, item_phallus_count } = body;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'userId is required' } },
        { status: 400 }
      );
    }

    const maxPerType = Number.parseInt(
      process.env.ADMIN_INVENTORY_MAX_PER_TYPE ?? String(DEFAULT_MAX_ITEM_PER_TYPE),
      10
    ) || DEFAULT_MAX_ITEM_PER_TYPE;

    let sanitizedHand: number;
    let sanitizedPhallus: number;
    try {
      sanitizedHand    = clampBoundary(item_hand_count,    maxPerType);
      sanitizedPhallus = clampBoundary(item_phallus_count, maxPerType);
    } catch (boundErr) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'BAD_REQUEST',
            message: boundErr instanceof Error ? boundErr.message : 'Invalid item count',
          },
        },
        { status: 400 }
      );
    }

    const pool = getPostgresPool();
    const clientIp = getClientIp(req);
    const operatorId = getOperatorId(req);
    await pool.query(
      `INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (user_id) DO UPDATE SET
         item_hand_count = EXCLUDED.item_hand_count,
         item_phallus_count = EXCLUDED.item_phallus_count,
         updated_at = NOW()`,
      [userId, sanitizedHand, sanitizedPhallus]
    );

    logAdminAction({
      route: '/api/admin/user/inventory',
      action: 'update_inventory',
      operatorId,
      targetUserId: userId,
      clientIp,
      success: true,
      newValue: { item_hand_count: sanitizedHand, item_phallus_count: sanitizedPhallus },
    });

    return NextResponse.json({
      ok: true,
      data: {
        user_id: userId,
        item_hand_count: sanitizedHand,
        item_phallus_count: sanitizedPhallus,
      },
    });
  } catch (error) {
    console.error('[ADMIN] Inventory update error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update inventory' } },
      { status: 500 }
    );
  }
}
