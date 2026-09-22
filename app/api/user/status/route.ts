/**
 * GET /api/user/status — public user status for H5 frontend.
 *
 * Migrated from Supabase + JSON file → AWS RDS via lib/db/pg.ts.
 * Development now uses the SAME Postgres path (no mock fallback).
 *
 * REPARK 6.0 — 2026-08-02 P0 DIAGNOSTIC PATCH (TC-P0-09):
 *   - Frontend screenshot showed `daily_money_recharged: 0` even after a
 *     mock write. Root cause was a unit-of-measurement mismatch (DB was
 *     being written in 元 but this route was converting with centsToYuan).
 *   - Added explicit DIAGNOSTIC LOGS around the daily-task read path so a
 *     similar future incident can be triaged from server logs without
 *     requiring a re-deploy.
 *   - Added DUAL-UUID FALLBACK: query the canonical UUID first, then a
 *     defensive second query against the raw `?userId=` value and take
 *     the max of both reads. This protects against any future toUuid/
 *     alias-derivation drift where the row the webhook wrote lands on a
 *     different canonical UUID than the one this route computes.
 *   - Unit semantics remain cents-in-DB → 元-on-the-wire (centsToYuan).
 *     Mock data writes must therefore insert cents (e.g. 5000 for 50元).
 *
 * Fix history (REPARK 6.0, 2026-07-27 — TC-P0-01):
 *   - Issue "200 OK but daily_tasks returns 0": the webhook wrote data for
 *     2026-07-27 (Asia/Shanghai) but this endpoint queried 2026-07-27T00:00:00.000Z
 *     (UTC), which Postgres stores as 2026-07-26 in the UTC date column.
 *     Production DB audit confirmed: no row exists for UTC date 2026-07-27
 *     for user 6c61704f, while the Asia/Shanghai date 2026-07-27 row has 5000
 *     in daily_money_recharged and 0 in daily_energy_consumed.
 *     Fix: use dayjs().tz('Asia/Shanghai') to match the webhook's getTodayUtc8().
 *   - Issue #6 (uid 哈希漂移): normalize the incoming `userId` query param
 *     through the same `lib/userIdentity.ts → toUuid` SSOT that
 *     `lib/auth.ts` and `lib/db/pg.ts` now both delegate to. This guarantees
 *     that the row we read here is the same row the webhook wrote.
 *   - Issue #5 (充值金额单位异常): `daily_money_recharged` is stored in 分
 *     per the webhook contract, but the H5 UI displays it as 元. This
 *     endpoint now performs the cents→元 conversion in ONE place (the API
 *     boundary) so every downstream component (BattleLayout, SubPageModal,
 *     TaskSheet) compares and renders consistently in 元.
 */

import { NextResponse } from 'next/server';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { getUserIdAsUuid, getAuthCookieName } from '@/lib/auth';
import { toUuid } from '@/lib/userIdentity';
import {
  getUserInventory,
  getDailyTask,
  computeUserTotalDamage,
  hasUnclaimedMilestone,
  getActiveActivity,
  resolveEffectiveDailyTaskDate,
  migrateDailyTaskBucketOnTransition,
} from '@/lib/db/pg';
import { getPostgresPool } from '@/lib/db/postgres';

dayjs.extend(utc);
dayjs.extend(timezone);

function getTodayUtc8(): string {
  return dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
}

/** Convert a cents amount to a 元 amount with 2-decimal rounding. */
function centsToYuan(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * REPARK 6.0 — 2026-08-02 P0 (TC-P0-09) DUAL-UUID FALLBACK READ.
 *
 * Reads user_daily_tasks for a given (date) using TWO independent paths and
 * returns whichever row had the larger non-zero value. This protects against
 * future toUuid/alias-derivation drift (e.g. the webhook writes under
 * UUID-A while this route computes UUID-B).
 *
 *   Path 1 (canonical): SELECT WHERE user_id = $canonicalUserId
 *   Path 2 (raw):       SELECT WHERE user_id::text = $rawUserId
 *                       (defensive — raw '128' as text usually won't match
 *                        any UUID column but if a future schema adds a
 *                        short-id alias index it WILL match and we win.)
 *
 * On either path returning null, we fall back to the other path. We never
 * throw — a null result is acceptable (caller defaults to 0).
 */
async function getDailyTaskDualUuid(
  canonicalUserId: string,
  rawUserId: string,
  date: string
): Promise<{ daily_energy_consumed: number; daily_money_recharged: number; recharge_processed: boolean } | null> {
  let canonicalRow: Awaited<ReturnType<typeof getDailyTask>> = null;
  let rawRow: Awaited<ReturnType<typeof getDailyTask>> = null;
  let canonicalErr: unknown = null;
  let rawErr: unknown = null;
  try {
    canonicalRow = await getDailyTask(canonicalUserId, date);
  } catch (e) {
    canonicalErr = e;
  }
  try {
    const pool = getPostgresPool();
    const r = await pool.query<{
      daily_energy_consumed: number;
      daily_money_recharged: number;
      recharge_processed: boolean;
    }>(
      `SELECT daily_energy_consumed, daily_money_recharged, COALESCE(recharge_processed, false) AS recharge_processed
         FROM public.user_daily_tasks
        WHERE user_id::text = $1 AND date = $2
        LIMIT 1`,
      [rawUserId, date]
    );
    rawRow = r.rows[0] ?? null;
  } catch (e) {
    rawErr = e;
  }

  console.log(
    `[GET /api/user/status] dailyTask dual-uuid: date=${date} ` +
      `canonical=${canonicalUserId}=${JSON.stringify(canonicalRow)} ` +
      `raw=${rawUserId}=${JSON.stringify(rawRow)} ` +
      `canonicalErr=${canonicalErr instanceof Error ? canonicalErr.message : 'none'} ` +
      `rawErr=${rawErr instanceof Error ? rawErr.message : 'none'}`
  );

  if (!canonicalRow && !rawRow) return null;
  const energy = Math.max(
    Number(canonicalRow?.daily_energy_consumed ?? 0),
    Number(rawRow?.daily_energy_consumed ?? 0)
  );
  const recharge = Math.max(
    Number(canonicalRow?.daily_money_recharged ?? 0),
    Number(rawRow?.daily_money_recharged ?? 0)
  );
  const processed =
    Boolean(canonicalRow?.recharge_processed ?? false) ||
    Boolean(rawRow?.recharge_processed ?? false);
  return { daily_energy_consumed: energy, daily_money_recharged: recharge, recharge_processed: processed };
}

export interface UserStatusResponse {
  /**
   * The customer's ORIGINAL business identifier (e.g. "128" or a pre-existing
   * UUID the customer already stores in their system).
   *
   * REPARK 6.0 — P0 fix 2026-07-25: previously this returned our internal
   * canonical UUID (e.g. `6c61704f-...`) which the customer's system could
   * NOT correlate back to its own records. We now echo the raw inbound ID
   * so integration round-trips work without a lookup table.
   *
   * When no `?userId=` param is sent AND the cookie carries a UUID, this
   * falls back to the canonical UUID (matching the cookie verbatim).
   */
  user_id: string;
  /**
   * Canonical UUID used internally for DB queries. Exposed for debugging /
   * admin tooling only — customer's own systems MUST use `user_id` above.
   */
  canonical_user_id: string;
  inventory: {
    item_hand: number;
    item_phallus: number;
  };
  /**
   * Money values are reported in 元 (yuan), NOT 分 (cents). UI components
   * can now compare `daily_money_recharged >= daily_recharge_threshold`
   * directly without re-applying the /100 conversion.
   */
  daily_tasks: {
    daily_energy_consumed: number;
    daily_money_recharged: number; // 元
  };
  total_damage: number;
  /**
   * PRD §2.9 / TC-BN-02 — drives the "可领取" badge on the home banner
   * carousel. True when the user has reached a milestone threshold that
   * has not yet been claimed.
   */
  has_unclaimed_milestone: boolean;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    // FIX: Use getUserIdAsUuid so the user ID is normalized to UUID format
    // before querying. Previously used getUserIdFromRequest which returns the
    // raw cookie value (e.g. "128") without UUID conversion. Since the webhook
    // writes to a deterministic UUID derived from "128", the status API was
    // querying with the wrong ID and always getting 0.
    const authResult = getUserIdAsUuid(req);
    // Issue #6 — normalize the explicit `userId` query param through the
    // same SSOT so a caller passing `"128"` lands on the same row as
    // someone passing the long-form `"2747b7c7-1856-5ba5-b066-f0523b03e17f"`.
    const rawUserIdParam = searchParams.get('userId');
    const resolvedUserId =
      (rawUserIdParam ? toUuid(rawUserIdParam) : null) ??
      authResult?.userId ??
      null;

    // P0 FIX (2026-07-26 audit): the previous fallback to the all-zero UUID
    // silently created a "ghost user" row whenever an unauthenticated client
    // hit this endpoint — every anonymous visitor's reads/writes piled onto
    // the same `00000000-…` row, polluting analytics and grant eligibility.
    // We now refuse the request with 401 when neither the `?userId=` param
    // nor the cookie/bearer auth resolved a real user.
    const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
    if (!resolvedUserId || resolvedUserId === ZERO_UUID) {
      console.warn(
        `[GET /api/user/status] UNAUTHORIZED: no resolved userId (rawUserIdParam=${rawUserIdParam ?? '(none)'}, authSource=${authResult?.source ?? 'none'})`
      );
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Missing user identity. Provide ?userId=, the auth cookie, or a Bearer token.',
          },
        },
        { status: 401 }
      );
    }
    const userId = resolvedUserId;

    // P0 fix 2026-07-25 — ID ECHO.
    // The customer's system correlates responses by their OWN business ID
    // (e.g. the literal string "128" they sent in the request). We MUST echo
    // that exact value back as `user_id` in the response payload, NOT the
    // internal canonical UUID we derived for DB indexing.
    //
    // Resolution order for the echoed value:
    //   1. `?userId=` query param as the customer sent it (verbatim)
    //   2. Cookie value as the customer sent it (verbatim — pre-toUuid)
    //   3. Bearer token value as the customer sent it (verbatim)
    //   4. Fallback to the canonical UUID (only when no inbound raw id exists)
    const cookieRawId = readRawCookieUserId(req);
    const bearerRawId = readRawBearerUserId(req);
    const externalUserId =
      (rawUserIdParam && rawUserIdParam.length > 0 ? rawUserIdParam : null) ??
      cookieRawId ??
      bearerRawId ??
      userId;

    console.log(
      `[GET /api/user/status] ENTRY: userId=${userId} (echo=${externalUserId}) source=${authResult?.source ?? 'unknown'} rawUserIdParam=${rawUserIdParam ?? '(none)'} cookieRawId=${cookieRawId ?? '(none)'} bearerRawId=${bearerRawId ?? '(none)'}`
    );

    const todayUtc8 = getTodayUtc8();
    console.log(`[GET /api/user/status] today (Asia/Shanghai) = ${todayUtc8}`);

    // REPARK 7.0 Batch C (2026-08-28): honour the customer-configured
    // 每日自动重置 toggle. Under the approved single-active-activity model,
    // this route resolves the active activity server-side and adopts the
    // same bucket key the webhook writer + battle/init + task-claim use, so
    // a user reading their status sees the exact progress the writers stored.
    // When dailyReset is OFF the bucket is the activity's UTC+8 start date,
    // so the user sees the cumulative (non-reset) progress; we also perform
    // the one-shot lazy migration so the very first OFF-mode read does not
    // silently lose any progress accumulated under today.
    const activeForDailyTask = await getActiveActivity().catch(() => null);
    const eff = resolveEffectiveDailyTaskDate(activeForDailyTask);
    if (eff.date !== eff.todayDate) {
      await migrateDailyTaskBucketOnTransition(resolvedUserId, eff);
    }
    const effectiveDailyDate = eff.date;
    console.log(
      `[GET /api/user/status] effectiveDailyDate=${effectiveDailyDate} dailyReset=${eff.dailyResetEnabled ? 'ON' : 'OFF'}`,
    );

    // REPARK 6.0 — 2026-08-02 P0 (TC-P0-09): dual-uuid fallback read
    // replaces the single getDailyTask(userId, today) so we cannot silently
    // return 0 due to toUuid-derivation drift between webhook and read paths.
    const dailyTask = await getDailyTaskDualUuid(resolvedUserId, externalUserId, effectiveDailyDate).catch((e) => {
      console.error('[GET /api/user/status] getDailyTaskDualUuid threw:', e);
      return null;
    });

    const [inventory, totalDamage, hasUnclaimed] = await Promise.all([
      getUserInventory(userId).catch(() => null),
      computeUserTotalDamage(userId).catch(() => 0),
      hasUnclaimedMilestone(userId).catch(() => false),
    ]);

    // P0 2026-08-02: log raw DB row before any unit conversion so unit
    // mismatches (cents vs yuan) are immediately visible in server logs.
    console.log(
      `[GET /api/user/status] rawDBRow dailyTask=${JSON.stringify(dailyTask)} ` +
        `(units are CENTS in DB; centsToYuan(÷100) at API boundary)`
    );

    const response: UserStatusResponse = {
      // Customer's original business ID — what their system sent in.
      user_id: externalUserId,
      // Internal canonical UUID — exposed for debugging only.
      canonical_user_id: userId,
      inventory: {
        item_hand: Number(inventory?.item_hand_count ?? 0),
        item_phallus: Number(inventory?.item_phallus_count ?? 0),
      },
      // Issue #5 — convert DB cents → display 元 at the API boundary.
      daily_tasks: {
        daily_energy_consumed: Number(dailyTask?.daily_energy_consumed ?? 0),
        daily_money_recharged: centsToYuan(Number(dailyTask?.daily_money_recharged ?? 0)),
      },
      total_damage: totalDamage,
      has_unclaimed_milestone: hasUnclaimed,
    };
    console.log(
      `[GET /api/user/status] EXIT: response.daily_tasks=${JSON.stringify(response.daily_tasks)} ` +
        `(values on the wire are in 元)`
    );
    return NextResponse.json({ ok: true, data: response });
  } catch (err) {
    console.error('[GET /api/user/status] Unhandled error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Failed to fetch user status',
        },
      },
      { status: 500 }
    );
  }
}

// ── Raw ID readers (P0 ID ECHO) ───────────────────────────────────────────────
//
// These helpers read the customer-supplied identifier WITHOUT applying any
// transformation. They exist exclusively so the response can echo the value
// back exactly as the customer sent it. Do NOT route them through `toUuid`.
// We import the same cookie name logic as lib/auth.ts so the lookup keys
// stay in lockstep (avoids the classic "cookie set under `uid`, read under
// `auth_token`" debugging nightmare).

function readRawCookieUserId(req: Request): string | null {
  try {
    const cookieName = getAuthCookieName();
    const header = req.headers.get('cookie') ?? '';
    for (const part of header.split(';')) {
      const trimmed = part.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      if (trimmed.slice(0, eqIdx).trim() === cookieName) {
        const value = trimmed.slice(eqIdx + 1).trim();
        return value || null;
      }
    }
  } catch {
    // Cookie name not configured (e.g. middleware-injected env) — fall through.
  }
  return null;
}

function readRawBearerUserId(req: Request): string | null {
  try {
    const auth = req.headers.get('authorization');
    if (!auth) return null;
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;
    // Strip the optional `uid:<value>` prefix so the echo is the raw business ID,
    // not the prefix. (E.g. customer sent `uid:128` → we echo `128`.)
    const prefixed = token.match(/^uid:(.+)$/i);
    return prefixed ? prefixed[1]!.trim() : token;
  } catch {
    return null;
  }
}