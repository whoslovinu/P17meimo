import { NextResponse } from 'next/server';
import { getPostgresPool } from '@/lib/db/postgres';
import { getActiveActivity } from '@/lib/db/pg';

/**
 * GET /api/battle/leaderboard
 *
 * Real-time CURRENT-ACTIVITY damage leaderboard from AWS RDS PostgreSQL.
 *
 * REPARK 7.0 (2026-08-24): The leaderboard is now ACTIVITY-SCOPED. The
 * source is `user_activity_stats.total_damage WHERE activity_id = active`,
 * NOT the global `user_inventory.total_damage_dealt`. Rationale: the product
 * decision is "排行榜 = 当前活动排行榜" — a leaderboard must strictly reflect
 * the current active activity. A player with large lifetime damage from a
 * prior activity must not appear on the current-activity leaderboard.
 *
 * Schema:
 *   users               (id UUID, nickname TEXT, avatar TEXT)
 *   user_activity_stats (user_id UUID → users.id, activity_id BIGINT, total_damage BIGINT)
 *   activities          (id BIGINT, config->>'isGlobalEnabled' BOOLEAN)
 *
 * Empty / no-active-activity contract: returns `{ entries: [], users: [] }`.
 * NO global fallback. The leaderboard is always strictly activity-scoped.
 *
 * Cache-Control: s-maxage=10 so CDN/proxy can cache for 10s,
 * but client always revalidates (no-store in fetch).
 */

export const dynamic = 'force-dynamic';

const LIMIT = 50;

interface LeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  avatar: string;
  totalDamage: number;
}

interface LeaderboardResponse {
  ok: true;
  data: {
    entries: LeaderboardEntry[];
    // Parallel view matching the Playwright assertion `data.users`.
    users: LeaderboardEntry[];
    fetchedAt: string;
  };
}

interface LeaderboardError {
  ok: false;
  error: { code: string; message: string };
}

export async function GET(): Promise<NextResponse<LeaderboardResponse | LeaderboardError>> {
  const start = Date.now();

  try {
    const pool = getPostgresPool();

    // REPARK 7.0 (2026-08-24): Resolve the CURRENT active activity. If none,
    // return an empty leaderboard — never fall back to the global inventory.
    // The leaderboard must strictly represent the active activity.
    const activeActivity = await getActiveActivity();
    if (!activeActivity) {
      console.log(`[LEADERBOARD] No active activity — returning empty leaderboard (${Date.now() - start}ms)`);
      return NextResponse.json(
        {
          ok: true,
          data: { entries: [], users: [], fetchedAt: new Date().toISOString() },
        } satisfies LeaderboardResponse,
        {
          status: 200,
          headers: {
            'Cache-Control': 's-maxage=10, stale-while-revalidate=30',
          },
        }
      );
    }

    // Activity-scoped query. Uses idx_user_activity_stats_activity_damage
    // (activity_id, total_damage DESC) for an index-only ORDER BY scan.
    const rows = await pool.query<{
      user_id: string;
      nickname: string;
      avatar: string;
      total_damage: string; // returned as string by pg BIGINT
    }>(
      `
      SELECT
        uas.user_id,
        COALESCE(NULLIF(u.nickname, ''), '神秘玩家')   AS nickname,
        COALESCE(NULLIF(u.avatar,  ''), '👤')          AS avatar,
        uas.total_damage
      FROM public.user_activity_stats uas
      LEFT JOIN public.users u ON u.id = uas.user_id
      WHERE uas.activity_id = $1
        AND uas.total_damage > 0
      ORDER BY uas.total_damage DESC
      LIMIT $2
      `,
      [activeActivity.id, LIMIT]
    );

    const entries: LeaderboardEntry[] = rows.rows.map((row, idx) => ({
      rank: idx + 1,
      userId: row.user_id,
      nickname: row.nickname,
      avatar: row.avatar,
      totalDamage: parseInt(row.total_damage, 10),
    }));

    const elapsed = Date.now() - start;
    console.log(`[LEADERBOARD] activity=${activeActivity.id} (${activeActivity.name}) — ${entries.length} entries in ${elapsed}ms`);

    // Frontend (LeaderboardSheet) consumes `entries`; the Playwright suite and
    // LOCAL_TESTING_CHECKLIST expect `users`. Emit both so neither side breaks.
    const users = entries.map((e) => ({
      rank: e.rank,
      userId: e.userId,
      nickname: e.nickname,
      avatar: e.avatar,
      totalDamage: e.totalDamage,
    }));

    return NextResponse.json(
      {
        ok: true,
        data: {
          entries,
          users,
          fetchedAt: new Date().toISOString(),
        },
      } satisfies LeaderboardResponse,
      {
        status: 200,
        headers: {
          // Allow CDN/proxy to cache for 10s; browser always gets fresh via fetch no-store
          'Cache-Control': 's-maxage=10, stale-while-revalidate=30',
        },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[LEADERBOARD] DB error:', msg);

    // Tunnel down — return empty leaderboard instead of 500 so UI stays graceful
    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('getaddrinfo')
    ) {
      console.warn('[LEADERBOARD] DB unavailable — returning empty leaderboard');
      return NextResponse.json(
        {
          ok: true,
          data: { entries: [], users: [], fetchedAt: new Date().toISOString() },
        } satisfies LeaderboardResponse,
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: '排行榜加载失败，请稍后重试' },
      } satisfies LeaderboardError,
      { status: 500 }
    );
  }
}
