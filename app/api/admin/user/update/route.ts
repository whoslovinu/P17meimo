/**
 * POST /api/admin/users/update — Update inventory or toggle status
 *
 * Migrated from Supabase → AWS RDS via lib/db/pg.ts.
 * Audit trail persisted to public.admin_audit_log via lib/auditLog.ts.
 *
 * Body shape:
 *   { action: 'update_inventory', userId: string, propA?: number, propB?: number }
 *   { action: 'toggle_status',   userId: string }
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { logAdminAction, getClientIp, getOperatorId } from '@/lib/auditLog';
import { ensureUserExists } from '@/lib/db/pg';

type UpdateBody =
  | { action: 'update_inventory'; userId: string; propA?: number; propB?: number }
  | { action: 'toggle_status'; userId: string };

export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  let body: UpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const { action, userId } = body;
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'userId is required' } },
      { status: 400 }
    );
  }

  const operatorId = getOperatorId(req);
  const ip = getClientIp(req);

  if (action === 'update_inventory') {
    const { propA, propB } = body;

    if (propA !== undefined && (typeof propA !== 'number' || propA < 0)) {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'propA must be a non-negative number' } },
        { status: 400 }
      );
    }
    if (propB !== undefined && (typeof propB !== 'number' || propB < 0)) {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'propB must be a non-negative number' } },
        { status: 400 }
      );
    }

    await ensureUserExists(userId);
    const pool = getPostgresPool();
    try {
      // 1. Fetch previous inventory for audit delta
      const prevResult = await pool.query<{
        item_hand_count: number;
        item_phallus_count: number;
      }>(
        `SELECT item_hand_count, item_phallus_count
           FROM public.user_inventory
          WHERE user_id = $1
          LIMIT 1`,
        [userId]
      );
      const prevPropA = Number(prevResult.rows[0]?.item_hand_count ?? 0);
      const prevPropB = Number(prevResult.rows[0]?.item_phallus_count ?? 0);

      // 2. Build dynamic UPDATE
      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (propA !== undefined) {
        sets.push(`item_hand_count = $${idx++}`);
        params.push(Math.max(0, propA));
      }
      if (propB !== undefined) {
        sets.push(`item_phallus_count = $${idx++}`);
        params.push(Math.max(0, propB));
      }
      sets.push(`updated_at = NOW()`);

      if (sets.length > 0) {
        params.push(userId);
        // INSERT row if not exists, then UPDATE
        await pool.query(
          `INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
           VALUES ($1, 0, 0, 0)
           ON CONFLICT (user_id) DO UPDATE SET ${sets.join(', ')}`,
          params
        );
      }

      // 3. Audit log
      if (propA !== undefined) {
        logAdminAction({
          route: '/api/admin/users/update',
          action: 'update_inventory',
          operatorId,
          targetUserId: userId,
          clientIp: ip,
          success: true,
          fieldName: 'propA',
          oldValue: prevPropA,
          newValue: propA,
        });
      }
      if (propB !== undefined) {
        logAdminAction({
          route: '/api/admin/users/update',
          action: 'update_inventory',
          operatorId,
          targetUserId: userId,
          clientIp: ip,
          success: true,
          fieldName: 'propB',
          oldValue: prevPropB,
          newValue: propB,
        });
      }

      // 4. Fetch the resulting row
      const updatedResult = await pool.query<{
        item_hand_count: number;
        item_phallus_count: number;
        updated_at: string;
        created_at: string;
      }>(
        `SELECT item_hand_count, item_phallus_count, updated_at, created_at
           FROM public.user_inventory
          WHERE user_id = $1
          LIMIT 1`,
        [userId]
      );
      const updated = updatedResult.rows[0];

      if (!updated) {
        return NextResponse.json({ ok: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
      }

      return NextResponse.json({
        ok: true,
        data: {
          id: userId,
          email: '',
          nickname: '',
          avatar: '👤',
          inventory: {
            propA: Number(updated.item_hand_count ?? 0),
            propB: Number(updated.item_phallus_count ?? 0),
          },
          totalDamage: 0,
          status: 'normal',
          lastLogin: updated.updated_at ?? updated.created_at,
          createdAt: updated.created_at,
        },
      });
    } catch (err) {
      console.error('[ADMIN:USER:UPDATE] inventory error:', err);
      return NextResponse.json(
        { ok: false, error: { code: 'DATABASE_ERROR', message: 'Failed to update inventory' } },
        { status: 500 }
      );
    }
  }

  if (action === 'toggle_status') {
    // FIX H-2: Persist status toggle to user_inventory.status (new column
    // added by aws_05_user_status.sql). The previous version only wrote to
    // the audit log — the toggle was a no-op visually even though it
    // appeared to succeed.
    //
    // FIX H-3: Ensure the users row exists first. user_inventory has a
    // FK to users(id); an upsert against user_inventory would otherwise
    // fail with FK violation when the user record has not been created
    // yet (e.g. fresh UUID synthesized by an admin smoke-test).
    await ensureUserExists(userId);

    const pool = getPostgresPool();
    let prevStatus = 'normal';
    let nextStatus: 'normal' | 'banned' = 'banned';

    try {
      const currentRow = await pool.query<{ status: string | null }>(
        `SELECT status FROM public.user_inventory WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      prevStatus = currentRow.rows[0]?.status ?? 'normal';
      nextStatus = prevStatus === 'banned' ? 'normal' : 'banned';

      // Ensure the row exists, then update the status column.
      await pool.query(
        `INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, status, total_damage_dealt)
         VALUES ($1, 0, 0, $2, 0)
         ON CONFLICT (user_id) DO UPDATE SET
           status = EXCLUDED.status,
           updated_at = NOW()`,
        [userId, nextStatus]
      );

      logAdminAction({
        route: '/api/admin/users/update',
        action: 'toggle_status',
        operatorId,
        targetUserId: userId,
        clientIp: ip,
        success: true,
        fieldName: 'status',
        oldValue: prevStatus,
        newValue: nextStatus,
      });

      const inv = await pool.query<{
        item_hand_count: number;
        item_phallus_count: number;
        total_damage_dealt: number;
        updated_at: string;
        created_at: string;
        status: string;
      }>(
        `SELECT item_hand_count, item_phallus_count, total_damage_dealt, updated_at, created_at, status
           FROM public.user_inventory
          WHERE user_id = $1
          LIMIT 1`,
        [userId]
      );
      const row = inv.rows[0];
      if (!row) {
        return NextResponse.json({ ok: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
      }

      return NextResponse.json({
        ok: true,
        data: {
          id: userId,
          email: '',
          nickname: '',
          avatar: '👤',
          inventory: {
            propA: Number(row.item_hand_count ?? 0),
            propB: Number(row.item_phallus_count ?? 0),
          },
          totalDamage: Number(row.total_damage_dealt ?? 0),
          status: row.status ?? nextStatus,
          lastLogin: row.updated_at ?? row.created_at,
          createdAt: row.created_at,
        },
      });
    } catch (err) {
      console.error('[ADMIN:USER:UPDATE] toggle_status error:', err);
      logAdminAction({
        route: '/api/admin/users/update',
        action: 'toggle_status',
        operatorId,
        targetUserId: userId,
        clientIp: ip,
        success: false,
        error: err instanceof Error ? err.message : 'unknown',
      });
      return NextResponse.json(
        { ok: false, error: { code: 'DATABASE_ERROR', message: 'Failed to toggle user status' } },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { ok: false, error: { code: 'BAD_REQUEST', message: 'Unknown action' } },
    { status: 400 }
  );
}