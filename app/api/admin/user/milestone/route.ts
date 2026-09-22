/**
 * POST /api/admin/users/milestone — Force-unlock OR lock a milestone reward.
 *
 * Migrated from Supabase → AWS RDS via lib/db/pg.ts.
 *
 * Body shape:
 *   { action: 'unlock', userId: string, milestoneId: number }
 *   { action: 'lock',   userId: string, milestoneId: number }
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { logAdminAction, getClientIp, getOperatorId } from '@/lib/auditLog';
import { z } from 'zod';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

function nowUtc8(): string {
  return dayjs().tz('Asia/Shanghai').toISOString();
}

const MilestoneBodySchema = z.object({
  action: z.enum(['unlock', 'lock']),
  userId: z.string().min(1),
  milestoneId: z.number().int().positive(),
});

type MilestoneBody = z.infer<typeof MilestoneBodySchema>;

export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  let body: MilestoneBody;
  try {
    const raw = await req.json();
    const parsed = MilestoneBodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues.map((e) => e.message).join('; '),
          },
        },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const { action, userId, milestoneId } = body;
  const operatorId = getOperatorId(req);
  const ip = getClientIp(req);

  const pool = getPostgresPool();

  try {
    // 1. Fetch prior state for audit delta
    const prevResult = await pool.query<{
      is_claimed: boolean;
      is_locked: boolean;
      claimed_at: string | null;
    }>(
      `SELECT is_claimed, is_locked, claimed_at
         FROM public.milestone_rewards
        WHERE user_id = $1 AND milestone_id = $2
        LIMIT 1`,
      [userId, milestoneId]
    );
    const prev = prevResult.rows[0];
    const prevClaimed = Boolean(prev?.is_claimed);
    const prevLocked = Boolean(prev?.is_locked);

    const now = nowUtc8();

    if (action === 'unlock') {
      await pool.query(
        `INSERT INTO public.milestone_rewards
           (user_id, milestone_id, is_claimed, is_locked, claimed_at)
         VALUES ($1, $2, true, false, $3)
         ON CONFLICT (user_id, milestone_id) DO UPDATE SET
           is_claimed = true,
           is_locked = false,
           claimed_at = EXCLUDED.claimed_at`,
        [userId, milestoneId, now]
      );

      logAdminAction({
        route: '/api/admin/users/milestone',
        action: 'force_unlock_milestone',
        operatorId,
        targetUserId: userId,
        clientIp: ip,
        success: true,
        fieldName: 'is_claimed',
        oldValue: { is_claimed: prevClaimed, is_locked: prevLocked },
        newValue: { is_claimed: true, is_locked: false, claimed_at: now },
      });

      return NextResponse.json({
        ok: true,
        data: {
          user_id: userId,
          milestone_id: milestoneId,
          is_claimed: true,
          is_locked: false,
          claimed_at: now,
        },
      });
    }

    // action === 'lock'
    await pool.query(
      `INSERT INTO public.milestone_rewards
         (user_id, milestone_id, is_claimed, is_locked)
       VALUES ($1, $2, false, true)
       ON CONFLICT (user_id, milestone_id) DO UPDATE SET
         is_locked = true`,
      [userId, milestoneId]
    );

    logAdminAction({
      route: '/api/admin/users/milestone',
      action: 'lock_milestone',
      operatorId,
      targetUserId: userId,
      clientIp: ip,
      success: true,
      fieldName: 'is_locked',
      oldValue: { is_locked: prevLocked },
      newValue: { is_locked: true },
    });

    return NextResponse.json({
      ok: true,
      data: {
        user_id: userId,
        milestone_id: milestoneId,
        is_claimed: prevClaimed,
        is_locked: true,
        claimed_at: prev?.claimed_at ?? null,
      },
    });
  } catch (err) {
    console.error('[ADMIN:MILESTONE] error:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'DATABASE_ERROR', message: `Failed to ${action} milestone` } },
      { status: 500 }
    );
  }
}