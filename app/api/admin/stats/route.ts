/**
 * GET /api/admin/stats — Aggregated dashboard metrics for the admin home page.
 *
 * FIX H-5: the admin dashboard previously rendered six cards with hard-coded
 * 0 values (no data wiring). This endpoint pulls the real numbers from
 * PostgreSQL so the UI can stop lying.
 *
 * Metrics returned:
 *   - totalUsers        count of distinct users that have ever joined
 *   - activeUsers24h    users with attack_logs in the last 24 hours
 *   - totalDamage       sum of user_inventory.total_damage_dealt
 *   - bossCurrentHp     current boss HP
 *   - bossMaxHp         boss max HP (for HP%)
 *   - totalAttacks      count of rows in attack_logs
 *   - milestoneClaims   count of milestone_rewards with is_claimed = true
 *   - pendingMilestones count of milestone_rewards with is_claimed = false
 *
 * The response also reports which cards the admin UI should display — we
 * bind the same key strings here as in `app/admin/page.tsx` so a card /
 * field name drift causes a missing key in the UI rather than a silent 0.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { getBossStatus, getActiveActivity } from '@/lib/db/pg';
import { getBossHpAndMaxFromCache } from '@/lib/redis';

export async function GET(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  try {
    const pool = getPostgresPool();

    const [
      totalUsersRow,
      activeUsers24hRow,
      totalDamageRow,
      totalAttacksRow,
      claimedRow,
      pendingRow,
    ] = await Promise.all([
      pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM public.user_inventory`),
      pool.query<{ c: string }>(
        `SELECT COUNT(DISTINCT user_id)::text AS c
           FROM public.attack_logs
          WHERE created_at >= NOW() - INTERVAL '24 hours'`
      ),
      pool.query<{ s: string | null }>(
        `SELECT COALESCE(SUM(total_damage_dealt), 0)::text AS s FROM public.user_inventory`
      ),
      pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM public.attack_logs`),
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM public.milestone_rewards WHERE is_claimed = true`
      ),
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM public.milestone_rewards WHERE is_claimed = false`
      ),
    ]);

    // P0 2026-07-30: Redis-first (hot path, real-time).  Falls back to Postgres
    // boss_status table.  NO hardcoded fallback values — if both fail, throw so
    // the Dashboard shows an error rather than a stale 10%.
    let bossCurrentHp: number;
    let bossMaxHp: number;
    try {
      const cached = await getBossHpAndMaxFromCache();
      if (cached.currentHp !== null && cached.maxHp !== null) {
        bossCurrentHp = cached.currentHp;
        bossMaxHp     = cached.maxHp;
      } else {
        // Redis miss — warm from Postgres and propagate to Redis for next caller.
        const pgStatus = await getBossStatus();
        if (!pgStatus) throw new Error('boss_status row not found');
        bossCurrentHp = Number(pgStatus.current_hp);
        bossMaxHp     = Number(pgStatus.max_hp);
        // Warm Redis so concurrent attack requests see the same value.
        const { warmBossCacheFromDb } = await import('@/lib/redis');
        await warmBossCacheFromDb(bossCurrentHp, bossMaxHp);
      }
    } catch (redisErr) {
      // Last resort — direct Postgres read.  Throws if the row is missing.
      console.warn('[ADMIN:STATS] Redis unavailable, reading from Postgres:', redisErr);
      const pgStatus = await getBossStatus();
      if (!pgStatus) {
        throw new Error('[ADMIN:STATS] Both Redis and Postgres boss_status are empty — cannot render dashboard');
      }
      bossCurrentHp = Number(pgStatus.current_hp);
      bossMaxHp     = Number(pgStatus.max_hp);
    }

    const totalUsers       = Number(totalUsersRow.rows[0]?.c ?? 0);
    const activeUsers24h   = Number(activeUsers24hRow.rows[0]?.c ?? 0);
    const totalDamage      = Number(totalDamageRow.rows[0]?.s ?? 0);
    const totalAttacks     = Number(totalAttacksRow.rows[0]?.c ?? 0);
    const milestoneClaims  = Number(claimedRow.rows[0]?.c ?? 0);
    const pendingMilestones = Number(pendingRow.rows[0]?.c ?? 0);

    // Activity details for the "Game Info" card on the admin dashboard.
    let activityName = '—';
    let activityStartTime = '—';
    let activityEndTime = '—';
    let damageMin = '—';
    let damageMax = '—';
    let itemAName = '—';
    let itemBName = '—';
    try {
      const act = await getActiveActivity();
      if (act) {
        const cfg = act.config as Record<string, unknown>;
        activityName = act.name;
        activityStartTime = act.start_time
          ? new Date(act.start_time).toLocaleDateString('zh-CN')
          : '—';
        activityEndTime = act.end_time
          ? new Date(act.end_time).toLocaleDateString('zh-CN')
          : '—';
        const propA = (cfg?.items as Record<string, unknown> | undefined)?.propA as
          | { name?: string; rows?: Array<{ minDamage?: number; maxDamage?: number }> }
          | undefined;
        const propB = (cfg?.items as Record<string, unknown> | undefined)?.propB as
          | { name?: string; rows?: Array<{ minDamage?: number; maxDamage?: number }> }
          | undefined;
        if (propA?.name) itemAName = propA.name;
        if (propB?.name) itemBName = propB.name;
        const rowsA = propA?.rows ?? [];
        const rowsB = propB?.rows ?? [];
        const minA = Math.min(...rowsA.map((r) => r.minDamage ?? 0));
        const maxA = Math.max(...rowsA.map((r) => r.maxDamage ?? 0));
        const minB = Math.min(...rowsB.map((r) => r.minDamage ?? 0));
        const maxB = Math.max(...rowsB.map((r) => r.maxDamage ?? 0));
        damageMin = String(Math.min(minA, minB));
        damageMax = String(Math.max(maxA, maxB));
      }
    } catch (actErr) {
      console.warn('[ADMIN:STATS] activity lookup failed:', actErr);
    }

    const stats = {
      totalUsers,
      activeUsers24h,
      totalDamage,
      bossCurrentHp,
      bossMaxHp,
      totalAttacks,
      milestoneClaims,
      pendingMilestones,
      // ── Game Info fields (used by the "游戏信息" card) ──────────────────
      activityName,
      activityStartTime,
      activityEndTime,
      damageMin,
      damageMax,
      itemAName,
      itemBName,
      computedAt: new Date().toISOString(),
    } as const;

    return NextResponse.json({ ok: true, data: stats });
  } catch (err) {
    console.error('[ADMIN:STATS] aggregation failed:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Failed to aggregate stats',
        },
      },
      { status: 500 }
    );
  }
}