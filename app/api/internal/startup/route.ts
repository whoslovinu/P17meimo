/**
 * app/api/internal/startup/route.ts
 *
 * Internal-only endpoint to activate the background sync service.
 * Called once on first server boot or first request.
 * Protected by a simple module-level singleton 鈥?safe to call multiple times.
 *
 * Also initializes the Redis-based daily reset key-spacing system.
 *
 * Phase 10 (Hook 4): optional startup heartbeat.
 *   If env vars OWNER_HEARTBEAT_URL + OWNER_HEARTBEAT_KEY are both set,
 *   the server makes a signed GET to that URL before declaring itself
 *   ready. If the heartbeat replies non-OK, or the URL is unreachable,
 *   the server throws and Next.js refuses to start.
 *
 *   This is opt-in: leave both vars unset and heartbeat is a no-op.
 */

import { NextResponse } from 'next/server';
import { initDailyReset } from '@/lib/redis';
import { getPostgresPool } from '@/lib/db/postgres';
import { updateBossStatus } from '@/lib/db/pg';
import { pingHeartbeat } from '@/lib/ownerCommand';
import { authenticateInternalCaller } from '@/lib/internalAuth';

let _started = false;

async function checkHeartbeatOrThrow(): Promise<void> {
  const url = process.env.OWNER_HEARTBEAT_URL;
  const key = process.env.OWNER_HEARTBEAT_KEY;
  if (!url || !key) {
    // Opt-in: heartbeat disabled. Log once so operators can see the actual state.
    console.log('[STARTUP] Heartbeat disabled (OWNER_HEARTBEAT_URL/KEY not set).');
    return;
  }
  if (key.length < 32) {
    console.warn('[STARTUP] Heartbeat key is shorter than 32 chars 鈥?refusing to send.');
    throw new Error('[STARTUP] OWNER_HEARTBEAT_KEY must be at least 32 chars.');
  }
  const result = await pingHeartbeat({
    config: { url, key },
    cmd: 'startup_check',
    argsJson: JSON.stringify({ nodeEnv: process.env.NODE_ENV ?? 'unknown' }),
  });
  if (!result.ok) {
    console.error('[STARTUP] Heartbeat rejected 鈥?refusing to start.', { reason: result.reason });
    throw new Error(`[STARTUP] heartbeat failed: ${result.reason}`);
  }
  console.log('[STARTUP] Heartbeat accepted.', { tier: result.tier });
}

/**
 * GET /api/internal/startup
 * Activates background services on first call.
 *
 * Authentication: requires `X-Internal-Token` header signed with HMAC-SHA256
 * (see lib/internalAuth.ts). In dev mode, loopback callers (127.0.0.1, ::1)
 * are exempt so `curl http://localhost:3000/api/internal/startup` keeps
 * working without a key in `.env`. In production the loopback bypass is
 * disabled 鈥?every caller must hold the shared INTERNAL_STARTUP_KEY.
 *
 * Generate a key with:   node scripts/generate-internal-key.mjs
 * Set in:                .env.local (dev) or hosting-platform env (prod)
 */
export async function GET(req: Request) {
  // 鈹€鈹€ 0. Authenticate the caller 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const authResult = await authenticateInternalCaller(req);
  if (authResult) return authResult;

  if (_started) {
    return NextResponse.json({ ok: true, message: 'Already started' });
  }

  try {
    // Phase 10 (Hook 4): fail-closed on heartbeat rejection.
    await checkHeartbeatOrThrow();

    // Initialize Redis daily reset key-spacing system
    await initDailyReset();

    // Warm boss_status row if absent (replaces startBackgroundSync idempotently)
    try {
      const pool = getPostgresPool();
      const result = await pool.query<{ current_hp: number; max_hp: number }>(
        `SELECT current_hp, max_hp FROM public.boss_status WHERE boss_id = $1 LIMIT 1`,
        ['00000000-0000-0000-0000-000000000001']
      );
      if (result.rows.length === 0) {
        await updateBossStatus(0, 100000);
      }
    } catch (err) {
      console.warn('[STARTUP] boss_status warm failed:', err);
    }

    _started = true;
    console.log('[STARTUP] Background services activated');

    return NextResponse.json({ ok: true, message: 'Background services started' });
  } catch (err) {
    console.error('[STARTUP] Failed to start background services:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to start background services' },
      { status: 500 }
    );
  }
}

// authenticateInternalCaller is imported from @/lib/internalAuth so it can be
// shared with /api/internal/cron/*.

