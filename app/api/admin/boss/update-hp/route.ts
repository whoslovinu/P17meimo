/**
 * POST /api/admin/boss/update-hp
 *
 * Migrated from Supabase → AWS RDS via lib/db/pg.ts.
 * Updates both Redis cache and PostgreSQL with safety guards.
 */

import { NextResponse } from 'next/server';
import { getRedisClient, REDIS_KEYS } from '@/lib/redis';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { logAdminAction } from '@/lib/auditLog';
import { updateBossStatus } from '@/lib/db/pg';

const MIN_HP = 0;
const MAX_HP_CAP = 10_000_000;

function sanitizeHp(value: number, defaultVal: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultVal;
  }
  return Math.max(MIN_HP, Math.min(value, MAX_HP_CAP));
}

export async function POST(req: Request) {
  const clientIp =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const authError = await requireAdminAuth(req);
  if (authError) {
    logAdminAction({
      route: '/api/admin/boss/update-hp',
      action: 'UPDATE_HP',
      clientIp,
      success: false,
      error: 'Auth failed',
    });
    return authError;
  }

  try {
    const body = await req.json();
    const { currentHp, maxHp } = body;

    if (typeof currentHp !== 'number' || typeof maxHp !== 'number') {
      logAdminAction({
        route: '/api/admin/boss/update-hp',
        action: 'UPDATE_HP',
        clientIp,
        success: false,
        error: 'Invalid HP values',
      });
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid HP values' } },
        { status: 400 }
      );
    }

    const sanitizedMaxHp = sanitizeHp(maxHp, 100000);
    let sanitizedHp = Math.min(sanitizeHp(currentHp, 0), sanitizedMaxHp);
    sanitizedHp = Math.max(sanitizedHp, MIN_HP);

    // 1. Update Redis (best-effort, non-fatal)
    let redisUpdated = false;
    try {
      const redis = getRedisClient();
      await redis.set(REDIS_KEYS.BOSS_HP, String(sanitizedHp));
      await redis.set(REDIS_KEYS.BOSS_MAX_HP, String(sanitizedMaxHp));
      redisUpdated = true;
    } catch (redisErr) {
      console.error('[ADMIN] Redis update failed:', redisErr);
    }

    // 2. Persist to PostgreSQL — throws on DB error
    try {
      await updateBossStatus(sanitizedHp, sanitizedMaxHp);
    } catch (dbErr) {
      console.error('[ADMIN] PostgreSQL update failed:', dbErr);
      if (!redisUpdated) {
        logAdminAction({
          route: '/api/admin/boss/update-hp',
          action: 'UPDATE_HP',
          clientIp,
          success: false,
          error: 'Both Redis and DB unavailable',
        });
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'Both Redis and Database unavailable',
            },
          },
          { status: 503 }
        );
      }
      console.warn('[ADMIN] Redis updated but DB failed. HP may be inconsistent.');
    }

    logAdminAction({
      route: '/api/admin/boss/update-hp',
      action: 'UPDATE_HP',
      clientIp,
      success: true,
    });

    return NextResponse.json({
      ok: true,
      data: { currentHp: sanitizedHp, maxHp: sanitizedMaxHp },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[ADMIN] Update HP error:', error);
    logAdminAction({
      route: '/api/admin/boss/update-hp',
      action: 'UPDATE_HP',
      clientIp,
      success: false,
      error: errorMsg,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update HP' } },
      { status: 500 }
    );
  }
}