/**
 * GET /api/boss/status — public boss HP status for H5 frontend.
 *
 * Migrated from Supabase → AWS RDS via lib/db/pg.ts.
 * Tiered fallback order: Redis → PostgreSQL boss_status → 500 (no fake data).
 */

import { NextResponse } from 'next/server';
import { getRedisClient, REDIS_KEYS } from '@/lib/redis';
import { getBossStatus } from '@/lib/db/pg';

let _redisWarned = false;

export async function GET() {
  // ── Tier 1: Redis ─────────────────────────────────────────────────────────
  let hp: string | null = null;
  let maxHp = 100000;
  try {
    const redis = getRedisClient();
    const [hpVal, maxVal] = await Promise.all([
      redis.get(REDIS_KEYS.BOSS_HP),
      redis.get(REDIS_KEYS.BOSS_MAX_HP),
    ]);
    hp = hpVal;
    maxHp = maxVal ? Number(maxVal) : 100000;
  } catch (redisErr) {
    if (!_redisWarned) {
      console.warn('[BOSS STATUS] Redis unavailable:', redisErr);
      _redisWarned = true;
    }
  }

  // ── Tier 2: PostgreSQL boss_status (if Redis miss / Redis down) ───────────
  if (!hp) {
    try {
      const row = await getBossStatus();
      if (row) {
        hp = String(row.current_hp);
        maxHp = row.max_hp ?? 100000;
      }
    } catch (dbErr) {
      console.error('[BOSS STATUS] PostgreSQL fallback failed:', dbErr);
    }
  }

  if (!hp) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Boss status unavailable' },
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        // Primary contract (H5 frontend + docs): `current` / `max`.
        current: Number(hp),
        max: maxHp,
        // Aliases matching the test suite (tests/api/01-battle-core.spec.ts + 00-prerequisites).
        currentHp: Number(hp),
        maxHp,
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    }
  );
}