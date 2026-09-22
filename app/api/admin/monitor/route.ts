/**
 * GET /api/admin/monitor — Server-side data aggregator for the real-time monitor page.
 * ─────────────────────────────────────────────────────────────────────────────
 * REPARK P0 2026-07-30:
 *
 * Problem 1 — Client-side double-fetch: the monitor page was calling
 *   fetch('/api/boss/status')   → hits Redis
 *   fetch('/api/battle/init')  → hits Redis + PG
 *   on the client, causing extra latency and potential race conditions.
 *
 * Problem 2 — "无法获取 Boss 状态": the page read `data.current_hp` from
 *   /api/boss/status which returns `data.current` (camelCase).  The field
 *   mismatch caused redisHp to always be undefined → "N/A".
 *
 * This route fixes both by aggregating data server-side and returning a single
 * typed response.  The monitor page calls ONE endpoint instead of two.
 *
 * Response shape:
 *   {
 *     ok: true,
 *     data: {
 *       redis:  { currentHp: number | null, maxHp: number | null },
 *       postgres: { currentHp: number | null, maxHp: number | null, lastUpdatedAt: string | null },
 *       activeActivity: { name: string | null, start_time: string | null, end_time: string | null },
 *       drift: number,   // redis.currentHp - postgres.currentHp (null → 0)
 *       isHealthy: boolean, // Math.abs(drift) <= 1
 *       checkedAt: string   // ISO timestamp
 *     }
 *   }
 *
 * Error: { ok: false, error: { code, message } }
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getBossHpAndMaxFromCache } from '@/lib/redis';
import { getBossStatus, getActiveActivity } from '@/lib/db/pg';

export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    // Run Redis and Postgres reads in parallel for minimum latency.
    const [redisData, pgStatus, activity] = await Promise.all([
      getBossHpAndMaxFromCache(),
      getBossStatus(),
      getActiveActivity(),
    ]);

    const redisHp  = redisData.currentHp;
    const redisMax = redisData.maxHp;
    const pgHp     = pgStatus !== null ? Number(pgStatus.current_hp) : null;
    const pgMax    = pgStatus !== null ? Number(pgStatus.max_hp)    : null;

    // Drift: only meaningful when both sides have data.
    const drift = (redisHp !== null && pgHp !== null)
      ? redisHp - pgHp
      : 0;

    return NextResponse.json({
      ok: true,
      data: {
        redis: {
          currentHp: redisHp,
          maxHp: redisMax,
        },
        postgres: {
          currentHp: pgHp,
          maxHp: pgMax,
          lastUpdatedAt: pgStatus?.last_updated_at ?? null,
        },
        activeActivity: {
          name: activity?.name ?? null,
          start_time: activity?.start_time ?? null,
          end_time:   activity?.end_time   ?? null,
        },
        drift,
        isHealthy: Math.abs(drift) <= 1,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[ADMIN:MONITOR] aggregation failed:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      },
      { status: 500 },
    );
  }
}
