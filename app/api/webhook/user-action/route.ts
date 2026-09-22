/**
 * POST /api/webhook/user-action — receives user-action events from Main Station.
 *
 * Migrated from Supabase → AWS RDS via lib/db/pg.ts.
 * Replaces the legacy dual-write (Redis + Supabase RPC) with Redis fast-write
 * + PostgreSQL atomic upsert.
 */

import { NextResponse } from 'next/server';
import { markWebhookProcessed } from '@/lib/redis';
import {
  incrementDailyTask,
  getDailyTask,
  ensureUserExists,
  resolveAliasToUuid,
  getActiveActivity,
  resolveEffectiveDailyTaskDate,
  migrateDailyTaskBucketOnTransition,
} from '@/lib/db/pg';
import {
  verifyWebhookSignature,
  requireWebhookSecret,
} from '@/lib/security/verifyWebhookSignature';
import { logWebhookEvent } from '@/lib/auditLog';
import { z } from 'zod';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

function getTodayUtc8(): string {
  return dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
}

// Payload schema: accepts both H5 UUID (preferred) and Main Station long ID.
// We normalise everything to the canonical H5 UUID for DB operations.
// If user_id is a valid UUID → use directly
// If user_id is a long (or empty) AND main_station_user_id is provided →
//   look up/create alias mapping, or use main_station_user_id as the user_id
// If only a long is provided → fall back to resolveAliasToUuid (existing behaviour)
const WebhookPayloadSchema = z.object({
  user_id: z.union([z.string().min(1), z.number().int().positive()], {
    message: 'user_id must be a non-empty string or positive integer',
  }).transform((v) => String(v)),
  // New field: the Main Station's native user ID (long). When present alongside a
  // non-UUID user_id, we use this as the authoritative alias so webhook calls
  // and page visits are correctly correlated for the same real-world user.
  main_station_user_id: z.string().optional(),
  action_type: z.enum(['consume', 'recharge'], {
    message: 'action_type must be "consume" or "recharge"',
  }),
  amount:      z.number().int().positive('amount must be a positive integer'),
  tx_id:       z.string().min(10, 'tx_id must be at least 10 characters'),
  timestamp:   z.number().positive('timestamp must be a positive Unix ms value'),
  sign:        z.string().regex(/^[a-f0-9]{64}$/, 'sign must be a 64-char hex string'),
});

type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;

function verifyHmac(req: Request, rawBody: string): { valid: boolean; error?: string } {
  if (process.env.NODE_ENV !== 'production' && !process.env.WEBHOOK_SECRET) {
    return { valid: true };
  }

  let secret: string;
  try {
    secret = requireWebhookSecret();
  } catch {
    if (process.env.NODE_ENV === 'production') {
      return { valid: false, error: 'WEBHOOK_SECRET not configured' };
    }
    return { valid: true };
  }

  const sigHeader = req.headers.get('x-webhook-signature') ?? '';
  if (!verifyWebhookSignature(rawBody, sigHeader, secret)) {
    return { valid: false, error: 'Invalid HMAC signature' };
  }

  return { valid: true };
}

export async function POST(req: Request) {
  const startTime = Date.now();
  const clientIp = req.headers.get('x-forwarded-for') ?? 'unknown';

  // Step 1: Read raw body
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    logWebhookEvent({
      success: false,
      eventId: '?',
      action: 'UNKNOWN',
      clientIp,
      error: 'Failed to read body',
      httpStatus: 400,
      errorCode: 'BODY_READ_FAIL',
    });
    return NextResponse.json(
      { code: 400, message: 'Failed to read request body' },
      { status: 400 }
    );
  }

  // Step 2: HMAC verification
  const hmacResult: { valid: boolean; error?: string } = verifyHmac(req, rawBody);
  if (!hmacResult.valid) {
    logWebhookEvent({
      success: false,
      eventId: '?',
      action: 'UNKNOWN',
      clientIp,
      error: hmacResult.error ?? 'Signature verification failed',
      httpStatus: 401,
      errorCode: 'INVALID_HMAC',
      rawBody,
    });
    return NextResponse.json(
      { code: 401, message: hmacResult.error ?? 'Unauthorized' },
      { status: 401 }
    );
  }

  // Step 3: Zod validation
  let validatedPayload: WebhookPayload;
  try {
    validatedPayload = WebhookPayloadSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((i) => i.message).join('; ');
      logWebhookEvent({
        success: false,
        eventId: '?',
        action: 'UNKNOWN',
        clientIp,
        error: `Zod validation failed: ${issues}`,
        httpStatus: 400,
        errorCode: 'SCHEMA_FAIL',
        rawBody,
      });
      return NextResponse.json(
        { code: 400, message: `Invalid payload: ${issues}` },
        { status: 400 }
      );
    }
    logWebhookEvent({
      success: false,
      eventId: '?',
      action: 'UNKNOWN',
      clientIp,
      error: 'Malformed JSON body',
      httpStatus: 400,
      errorCode: 'MALFORMED_JSON',
      rawBody,
    });
    return NextResponse.json({ code: 400, message: 'Malformed JSON body' }, { status: 400 });
  }

  const { user_id: rawUserId, main_station_user_id, action_type, amount, tx_id } = validatedPayload;

  // Step 3b: Resolve the incoming user_id into a canonical UUID.
  //
  // Priority order:
  //   1. user_id is a valid UUID  → use directly (most efficient, no DB lookup)
  //   2. main_station_user_id provided → use it as the alias key (new preferred path)
  //   3. user_id is a non-UUID long  → fall back to resolveAliasToUuid (legacy)
  //
  // Production RDS: <100ms. Local SSH tunnel: ~2.5s. Set generous limit to
  // survive both. One retry for transient TCP resets.
  let user_id: string;
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (UUID_REGEX.test(rawUserId)) {
    // Fast path: already a UUID, use directly
    user_id = rawUserId.toLowerCase();
  } else {
    // Alias path: use main_station_user_id if provided, otherwise rawUserId
    const aliasKey = main_station_user_id ?? rawUserId;
    const resolveWithRetry = async (raw: string): Promise<string> => {
      try {
        return await Promise.race([
          resolveAliasToUuid(raw),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('alias resolution timeout')), 15000)
          ),
        ]);
      } catch (firstErr) {
        console.warn('[WEBHOOK] alias resolve attempt 1 failed, retrying:', firstErr instanceof Error ? firstErr.message : String(firstErr));
        return resolveAliasToUuid(raw);
      }
    };
    try {
      user_id = await resolveWithRetry(aliasKey);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[WEBHOOK] alias resolve failed:', errMsg, 'raw=', aliasKey);
      logWebhookEvent({
        success: false,
        eventId: tx_id,
        action: action_type,
        clientIp,
        error: `alias resolve failed: ${errMsg}`,
        httpStatus: 500,
        errorCode: 'ALIAS_TIMEOUT',
        rawUserId: aliasKey,
        rawBody,
      });
      return NextResponse.json(
        { code: 500, message: 'Failed to resolve user alias' },
        { status: 500 }
      );
    }
  }

  console.log(`[WEBHOOK] Received: user=${user_id} (raw=${rawUserId}${main_station_user_id ? `, msId=${main_station_user_id}` : ''}) type=${action_type} amount=${amount} tx=${tx_id}`);

  // Step 4: Redis idempotency
  try {
    const setResult = await markWebhookProcessed(tx_id);
    if (!setResult) {
      console.log(`[WEBHOOK] Duplicate tx_id: ${tx_id}`);
      logWebhookEvent({
        success: true,
        eventId: tx_id,
        action: action_type,
        clientIp,
        duration: Date.now() - startTime,
        result: 'duplicate',
        httpStatus: 200,
        userId: user_id,
        rawUserId: rawUserId,
      });
      return NextResponse.json({ code: 200, message: 'Already processed' });
    }
  } catch (err) {
    console.warn('[WEBHOOK] Redis idempotency check failed, proceeding:', err);
  }

  const today = getTodayUtc8();

  // REPARK 7.0 Batch C (2026-08-28): resolve the customer-configured
  // 每日自动重置 toggle. When ON (legacy default for activities with no
  // dailyReset field), the bucket is `today` and behaviour is byte-for-byte
  // identical to pre-batch. When OFF, the bucket is the activity's UTC+8
  // start date so progress accumulates across calendar days. The first
  // write after a ON→OFF toggle also performs a one-shot, idempotent copy
  // of the user's existing `today` progress into the new anchor bucket so
  // no accumulated consume/recharge is silently lost.
  const activeActivityForDailyReset = await getActiveActivity();
  const eff = resolveEffectiveDailyTaskDate(activeActivityForDailyReset);
  if (eff.date !== eff.todayDate) {
    // Lazily migrate any existing today-bucket progress into the anchor so
    // the very first OFF-mode write doesn't double-count and the user's
    // progress is preserved across the toggle transition.
    await migrateDailyTaskBucketOnTransition(user_id, eff);
  }
  const effectiveDailyDate = eff.date;

  // Step 5: Persist to PostgreSQL — atomic upsert of daily task progress.
  // NOTE: a previous "TC-TK-27 recharge refund guard" lived here and bailed
  // out with `{ message: 'Refund not applied (already processed)' }` whenever
  // a user had already received one recharge that day. That guard was wrong:
  //   1. It blocked legitimate second/third recharges within the same day
  //      (the H5 progress bar is the *cumulative* daily total).
  //   2. It silently dropped the webhook without ever writing `task_progress`,
  //      so the UI never updated. Customers reported "0 progress" because of
  //      this exact branch.
  // It has been removed (REPARK 6.0 P0 — see ACTIVE_CONTEXT §3 [P0 webhook]).
  // The correct refund-detection lives in the Main Station's own ledger; this
  // route now treats every signed webhook as authoritative and accumulates.
  try {
    const taskTypeApi = action_type === 'consume' ? 'daily_energy' : 'daily_recharge';
    const newValue = await incrementDailyTask(
      user_id,
      effectiveDailyDate,
      action_type,
      amount
    );

    // Also upsert the claim-tracking row in task_progress.
    // The task_progress.user_id FK points at public.users.id, so we must
    // ensure the parent row exists for this freshly-minted UUID before the
    // INSERT — otherwise sqlstate 23503 would surface as a 500.
    //
    // P0 2026-08-03 (TC-P0-16) HARDENING: the previous ON CONFLICT clause
    // was `current_progress = EXCLUDED.current_progress` — a pure overwrite.
    // Because the inserted `current_progress` is the freshly accumulated
    // `newValue`, this worked in steady state, but it relied on
    // `incrementDailyTask`'s RETURNING being race-free. If two webhooks for
    // the same user race on `user_daily_tasks` (one lost the CAS round and
    // got an outdated `newValue`), `task_progress` would silently OVERWRITE
    // its correct running total with a stale snapshot — exactly the
    // "returns 200 but status reads 0 / stale" symptom the customer reported.
    // The fix is to make this an additive upsert so the PK-level row in
    // `task_progress` is monotonic regardless of read-modify-write ordering
    // upstream. We pass `amount` (the raw delta) and let the database sum it
    // with whatever is already there. `task_progress` is a derived view of
    // `user_daily_tasks`, so the server-of-truth remains `user_daily_tasks`
    // and we accept that `task_progress.current_progress` is allowed to
    // drift by exactly the contended race window (a single `amount`).
    await ensureUserExists(user_id);
    const { getPostgresPool } = await import('@/lib/db/postgres');
    const pool = getPostgresPool();
    await pool.query(
      `INSERT INTO public.task_progress
         (user_id, reset_date, task_type, current_progress, is_claimed)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (user_id, task_type, reset_date) DO UPDATE SET
         current_progress = public.task_progress.current_progress + EXCLUDED.current_progress,
         updated_at = NOW()`,
      [user_id, effectiveDailyDate, taskTypeApi, Math.max(0, amount)]
    );

    console.log(`[WEBHOOK] DB success: user=${user_id} ${action_type} += ${amount}, daily_tasks.new_total=${newValue} (date=${effectiveDailyDate}, dailyReset=${eff.dailyResetEnabled ? 'ON' : 'OFF'})`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error('[WEBHOOK] DB write failed:', errMsg);
    logWebhookEvent({
      success: false,
      eventId: tx_id,
      action: action_type,
      clientIp,
      error: errMsg,
      httpStatus: 500,
      errorCode: 'DB_FAIL',
      userId: user_id,
      rawUserId: rawUserId,
      rawBody,
    });
    return NextResponse.json(
      { code: 500, message: 'Failed to record task progress' },
      { status: 500 }
    );
  }

  logWebhookEvent({
    success: true,
    eventId: tx_id,
    action: action_type,
    clientIp,
    duration: Date.now() - startTime,
    result: 'success',
    httpStatus: 200,
    userId: user_id,
    rawUserId: rawUserId,
  });

  return NextResponse.json({ code: 200, message: 'success' });
}