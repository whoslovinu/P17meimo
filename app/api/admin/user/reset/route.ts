/**
 * POST /api/admin/user/reset — Reset inventory or progress for a user.
 *
 * Migrated from Supabase → AWS RDS via lib/db/pg.ts.
 *
 * Body: { user_id: string, type: 'inventory' | 'progress' | 'all' }
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { resetActivityInventory } from '@/lib/db/pg';

interface ResetPayload {
  user_id: string;
  type: 'inventory' | 'progress' | 'all';
}

export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    const payload: ResetPayload = await req.json();
    const { user_id, type } = payload;

    if (!user_id) {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing user_id' } },
        { status: 400 }
      );
    }

    const pool = getPostgresPool();

    if (type === 'inventory' || type === 'all') {
      await pool.query(
        `INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
         VALUES ($1, 0, 0, 0)
         ON CONFLICT (user_id) DO UPDATE SET
           item_hand_count = 0,
           item_phallus_count = 0,
           updated_at = NOW()`,
        [user_id]
      );
      // REPARK 7.0 (2026-09-22): Also reset all per-activity inventory rows.
      // This is the "global reset" semantic: all activities' inventories are wiped.
      await resetActivityInventory(user_id);
      console.log(`[USER RESET] Reset inventory for ${user_id}`);
    }

    if (type === 'progress' || type === 'all') {
      const today = new Date().toISOString().split('T')[0]!;
      await pool.query(
        `INSERT INTO public.user_daily_tasks (user_id, date, daily_energy_consumed, daily_money_recharged)
         VALUES ($1, $2, 0, 0)
         ON CONFLICT (user_id, date) DO UPDATE SET
           daily_energy_consumed = 0,
           daily_money_recharged = 0`,
        [user_id, today]
      );

      // Delete prior claim markers (milestones tied to user)
      await pool.query(
        `DELETE FROM public.milestone_rewards WHERE user_id = $1`,
        [user_id]
      );

      console.log(`[USER RESET] Reset progress for ${user_id}`);
    }

    return NextResponse.json({
      ok: true,
      data: { reset: true, type, user_id },
    });
  } catch (error) {
    console.error('[POST /api/admin/user/reset] Error:', error);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to reset user data' } },
      { status: 500 }
    );
  }
}