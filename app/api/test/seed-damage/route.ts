/**
 * POST /api/test/seed-damage — DEV-ONLY helper for Playwright e2e tests.
 *
 * Inserts a synthetic attack_logs row and mirrors the value into
 * user_inventory.total_damage_dealt so /api/user/status.total_damage
 * and has_unclaimed_milestone reflect the seeded state.
 *
 * Used to bypass the in-game attack rate limiter (~200 ms/req) when an
 * e2e test needs a user with thousands of damage to exercise milestone
 * unlock paths.
 *
 * HARD-GATED:
 *   - Only registered when NODE_ENV !== 'production'.
 *   - Requires the request to carry the same dev bypass admin_token
 *     used by /api/admin/login (or any admin_token cookie when an
 *     admin cookie is set).  Tests set the cookie via Playwright.
 *   - Returns 404 in production so this file cannot accidentally
 *     surface.
 */

import { NextResponse } from 'next/server';
import { getPostgresPool } from '@/lib/db/postgres';
import { ensureUserExists } from '@/lib/db/pg';
import { isAdminDevBypass } from '@/app/lib/adminToken';

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: 'test-only route disabled in production' } },
      { status: 404 }
    );
  }

  // Require either the dev-bypass admin_token or any non-empty admin_token
  // cookie. Tests set admin_token=authenticated via Playwright when
  // ADMIN_DEV_BYPASS=1 is in effect.
  const cookie = req.headers.get('cookie') ?? '';
  const hasAdmin = /(?:^|;\s*)admin_token=[^;]+/.test(cookie);
  const devBypass = isAdminDevBypass();
  if (!hasAdmin && !devBypass) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'admin_token cookie required for /api/test/*' } },
      { status: 401 }
    );
  }

  let body: { userId?: string; damage?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const userId = body.userId;
  const damage = Number(body.damage ?? 0);
  if (!userId || typeof userId !== 'string') {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'userId (string) required' } },
      { status: 400 }
    );
  }
  if (!Number.isFinite(damage) || damage < 0 || damage > 10_000_000 || !Number.isInteger(damage)) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'damage must be an integer in [0, 10000000]' } },
      { status: 400 }
    );
  }

  try {
    await ensureUserExists(userId);
    const pool = getPostgresPool();
    if (damage > 0) {
      await pool.query(
        `INSERT INTO public.attack_logs (user_id, item_used, damage_dealt)
         VALUES ($1, 'item_hand', $2)`,
        [userId, damage]
      );
    }
    await pool.query(
      `INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
         VALUES ($1, 0, 0, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         total_damage_dealt = EXCLUDED.total_damage_dealt,
         updated_at = NOW()`,
      [userId, damage]
    );

    return NextResponse.json({
      ok: true,
      data: { user_id: userId, total_damage_dealt: damage },
    });
  } catch (err) {
    console.error('[TEST/seed-damage] error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Failed to seed damage',
        },
      },
      { status: 500 }
    );
  }
}