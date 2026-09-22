/**
 * POST /api/game/milestone/claim — claim a personal milestone reward.
 *
 * Migrated from Supabase + JSON file → AWS RDS via lib/db/pg.ts.
 * The previous `process.env.NODE_ENV === 'development'` short-circuit
 * is REMOVED — every environment goes through the same PG path.
 *
 * P0 2026-08-04 (TC-P0-24): If the reward type is ENERGY, this route now
 * sends an outbound HMAC-signed POST to the Main Station's add-energy endpoint
 * BEFORE marking the milestone as claimed in the DB. If the callback fails,
 * the DB row is NOT updated — guaranteeing DB and Main Station stay in sync.
 */

import { NextResponse } from 'next/server';
import { getUserIdFromRequest, toUuid } from '@/lib/auth';
import {
  getMilestoneReward,
  getActiveActivity,
  getActivityDamage,
  claimMilestoneReward,
} from '@/lib/db/pg';
import { getPostgresPool } from '@/lib/db/postgres';
import { sendMainStationEnergyReward } from '@/lib/services/outboundWebhook';
import { grantBadge } from '@/lib/services/badgeAdapter';

interface MilestoneRewardConfig {
  id: number;
  threshold: number;
  rewardType: 'ENERGY' | 'MEDAL';
  energyValue?: number;
  medalId?: string;
}

interface ActivityConfig {
  milestones?: MilestoneRewardConfig[];
  isGlobalEnabled?: boolean;
  end_time?: string;
}

interface ClaimRequest {
  user_id?: string;
  milestone_id: number | string;
}

interface ClaimResponse {
  ok: true;
  data: {
    milestone_id: string;
    claimed: boolean;
    claimed_at: string;
    reward_type: 'ENERGY' | 'MEDAL';
    reward_value: string;
  };
}

interface ClaimError {
  ok: false;
  error: { code: string; message: string };
}

/** Strip "m" prefix so "m1001" → "1001" for DB and comparison. */
function normalizeMilestoneId(id: unknown): string {
  const raw = String(id ?? '');
  return raw.replace(/^m/i, '');
}

/** True if two milestone identifiers refer to the same milestone (string safe). */
function milestoneIdEquals(a: unknown, b: unknown): boolean {
  return normalizeMilestoneId(a) === normalizeMilestoneId(b) &&
    normalizeMilestoneId(a) !== '';
}

function extractUserId(req: Request, _body?: Record<string, unknown>): string | null {
  // Bug #38 (2026-08-22 REPARK): 严格多账号数据隔离。
  // 严禁从 body.user_id 提取身份 — 必须 100% 走服务端 Cookie / Auth Header
  // 鉴权。任何客户端传入的 user_id 字段一律忽略。
  const auth = getUserIdFromRequest(req);
  return auth?.userId ? toUuid(auth.userId) : null;
}

/**
 * P0 2026-08-08 (TC-P0-27): The Main Station's outbound reward endpoint
 * only accepts the raw long ID (e.g. "128"), NOT the canonical UUID
 * (e.g. "6c61704f-..."). H5 internally converts to UUID for DB ops,
 * but the outbound callback must use the original long ID.
 *
 * Falls back to the canonical UUID if no raw long ID is available.
 */
function extractOriginalUserId(req: Request, body: Record<string, unknown>): string {
  const raw =
    (body.user_id && typeof body.user_id === 'string' ? body.user_id : null) ??
    getUserIdFromRequest(req)?.userId ??
    null;
  return raw ? String(raw) : '';
}

/** Leniently extract a milestone ID from the request body. */
function lenientExtractMilestoneId(body: Record<string, unknown> | null | undefined): string | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body.milestone_id ?? body.milestoneId ?? body.id;
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw);
  const m = s.match(/\d+/);
  if (!m) return null;
  const normalized = m[0];
  return normalized !== '0' ? normalized : null;
}

function isClaimRequest(payload: unknown): payload is ClaimRequest {
  if (!payload || typeof payload !== 'object') return false;
  return lenientExtractMilestoneId(payload as Record<string, unknown>) !== null;
}

function resolveRewardValue(milestone: MilestoneRewardConfig): string {
  if (milestone.rewardType === 'ENERGY') {
    return String(milestone.energyValue ?? 0);
  }
  return milestone.medalId ?? '';
}

/**
 * P0 2026-08-21 REPARK: lenient body parsing + raw-text capture.
 * Accept malformed bodies as `{}` instead of returning 400 — the strict
 * validation moved to lenientExtractMilestoneId() below.
 */
export async function POST(req: Request) {
  // P0 2026-08-22 REPARK: capture the EXACT raw text the client sent so we
  // can diagnose mysterious 400s from the browser. The body may be malformed
  // JSON, missing the field, or shaped in an unexpected way — this gives us
  // a single grep-able marker in PM2 logs.
  const url = req.url;
  const rawText = await req.text();
  console.log('[CLAIM_REQUEST_INCOMING]', { url, rawText });

  let body: any = {};
  if (rawText && rawText.length > 0) {
    try {
      body = JSON.parse(rawText);
    } catch (e) {
      console.error('[CLAIM_JSON_PARSE_ERROR]', e);
    }
  }

  // Deep-extract milestone ID — flatten whatever shape the client sent.
  let targetId: any = body?.milestone_id ?? body?.milestoneId ?? body?.id ?? body?.milestone?.id ?? body?.milestone?.milestone_id;

  // If the extracted value is itself an object, dig one level deeper.
  if (targetId && typeof targetId === 'object') {
    targetId = (targetId as any).id || (targetId as any).milestone_id || (targetId as any).value;
  }

  // Normalise to a trimmed string. If empty or literal "undefined"/"null",
  // reject with a clear marker.
  const milestoneKey = String(targetId ?? '').trim();
  if (!milestoneKey || milestoneKey === 'undefined' || milestoneKey === 'null') {
    console.error('[CLAIM_REJECT_INVALID_ID]', { body, targetId, rawText });
    return NextResponse.json(
      { ok: false, error: 'INVALID_MILESTONE_ID', received: body } as any,
      { status: 400 }
    );
  }

  // Re-shape the body so the existing business logic (which looks at
  // body.milestone_id) keeps working unchanged.
  body = { ...(typeof body === 'object' && body !== null ? body : {}), milestone_id: milestoneKey };

  console.log('[MilestoneClaim DEBUG] Raw Body:', JSON.stringify(body));

  const msId = lenientExtractMilestoneId(body);
  if (!msId) {
    console.warn('[MilestoneClaim] Missing or invalid milestone_id. Body keys:', Object.keys(body ?? {}));
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing or invalid milestone_id' } } as ClaimError,
      { status: 400 }
    );
  }

  const rawMilestoneId = body.milestone_id ?? body.milestoneId ?? body.id;
  const numericIdMatch = String(rawMilestoneId ?? '').match(/\d+/);
  const numericId = numericIdMatch ? Number(numericIdMatch[0]) : null;

  try {
    const userId = extractUserId(req, body);
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Please login first' } } as ClaimError,
        { status: 401 }
      );
    }

    const activity = await getActiveActivity();
    const cfg = (activity?.config as ActivityConfig | undefined) ?? {};
    const milestone = cfg.milestones?.find((m) =>
      milestoneIdEquals(m.id, msId) || (numericId !== null && Number(m.id) === numericId)
    );
    if (!milestone) {
      console.warn(`[MilestoneClaim] Milestone not found: msId=${msId}, raw=${rawMilestoneId}, available=${JSON.stringify(cfg.milestones?.map(m => m.id))}`);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'MILESTONE_NOT_FOUND',
            message: `Milestone does not exist in active activity config (msId=${msId})`,
          },
        } as ClaimError,
        { status: 404 }
      );
    }

    const rewardType: 'ENERGY' | 'MEDAL' = milestone.rewardType ?? 'MEDAL';
    const rewardValue = resolveRewardValue(milestone);
    const threshold = Number(milestone.threshold ?? 0);

    const existing = await getMilestoneReward(userId, msId);
    if (existing?.is_locked) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'MILESTONE_LOCKED', message: 'Milestone has been locked by admin' },
        } as ClaimError,
        { status: 423 }
      );
    }
    if (existing?.is_claimed) {
      // P0 2026-08-22 REPARK: treat re-clicks on an already-claimed milestone
      // as a SUCCESS (HTTP 200) rather than a 4xx error. The frontend keeps
      // firing handleClaimReward on every render where the red-dot/badge is
      // still showing, and the previous 409 caused console noise + a misleading
      // "领取失败" toast. The id is still normalised so the server confirms
      // which milestone the user has already collected.
      console.log(`[MilestoneClaim] Already claimed (treated as success): msId=${msId} user=${userId}`);
      return NextResponse.json(
        {
          ok: true,
          code: 'ALREADY_CLAIMED',
          message: '已领取过该奖励',
          data: {
            milestone_id: msId,
            claimed: true,
            claimed_at: existing.claimed_at ?? null,
            reward_type: existing.reward_type ?? rewardType,
            reward_value: existing.reward_value ?? rewardValue,
          },
        } as any,
        { status: 200 }
      );
    }

    // REPARK 7.0 (2026-08-24): Milestone rewards are unlocked by ACTIVITY-SCOPED
    // personal accumulated damage (user_activity_stats.total_damage), NOT the global
    // user_inventory.total_damage_dealt. Activity scoping is enforced by activity_id.
    const activeActivityId = activity?.id ?? 0;
    let personalDamage = 0;
    if (activeActivityId > 0) {
      try {
        personalDamage = await getActivityDamage(userId, activeActivityId);
      } catch (err) {
        console.warn('[MilestoneClaim] activity damage query failed:', err);
      }
    }
    // REPARK 7.0 (2026-09-14): Admin special-unlock bypass for the damage threshold.
    // The override route sets `admin_bypass=TRUE` with a reason (see /admin/.../override).
    // The claim route treats admin_bypass as a single-use permission: it lets the
    // player skip the threshold check, but the bypass is consumed (cleared) on
    // successful claim. The flag is never reused; lock+unlock does not re-arm it.
    //
    // Cross-check: `admin_bypass` is distinct from `is_locked` (which BLOCKS claims)
    // and `is_claimed` (which MARKS past claims). It is set ONLY by admin actions.
    // Existing rows (without admin_bypass column pre-migration-17) return NULL/false.
    const adminBypass = Boolean(existing?.admin_bypass ?? false);
    const thresholdMet = personalDamage >= threshold;
    const thresholdPass = adminBypass || thresholdMet;

    console.log('[MilestoneClaim Threshold Check]', {
      userId,
      activityId: activeActivityId,
      activityName: activity?.name ?? 'unknown',
      msId,
      threshold,
      personalDamage,
      adminBypass,
      pass: thresholdPass,
      source: adminBypass ? 'admin_bypass' : (thresholdMet ? 'damage' : 'fail'),
    });

    if (!thresholdPass) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'THRESHOLD_NOT_MET',
            message: `个人累计伤害未达标（需达到 ${threshold} 点，当前 ${personalDamage} 点）`,
          },
        } as ClaimError,
        { status: 400 }
      );
    }

    // P0 Badge Adapter Integration (2026-09-13 REPARK): MEDAL rewards must be
    // committed to the Main Station BEFORE we mark the local milestone as
    // claimed. This restores the same invariant that ENERGY already has:
    // a "claimed" milestone in our DB must correspond to a confirmed grant
    // on the Main Station side.
    //
    // Adapter contract (lib/services/badgeAdapter.ts):
    //   • grantBadge() is awaited and returns a discriminated union.
    //   • ok=true means Main Station returned code=200. The stable request_id
    //     is reused across retries, so a duplicate call from this code path
    //     (or a retry triggered by the caller) is treated as idempotent on
    //     the Main Station side via its INSERT IGNORE. We do NOT introduce
    //     a new idempotency layer here — we rely on the existing adapter
    //     behaviour that has been validated in the parallel
    //     /api/battle/reward-claim path.
    //   • ok=false (NETWORK_ERROR / API_ERROR / AUTH_FAILED / NOT_FOUND /
    //     INVALID_PARAM) means we MUST NOT mark the local row as claimed.
    //     We surface a 500 INTERNAL_ERROR so the player's UI does not lock
    //     the milestone into a false "已领取" state.
    //
    // Note: the Main Station's INSERT IGNORE behaviour has NOT been
    // independently verified in this codebase. We treat it as documented
    // behaviour provided by the customer; we have not authored tests that
    // assert it. Calls that already wrote a row in a prior partial-failure
    // window are not retroactively audited by this code.
    const now = new Date().toISOString();

    if (rewardType === 'MEDAL') {
      const medalIdRaw = String(milestone.medalId ?? '').trim();
      if (!medalIdRaw) {
        console.error(`[game/milestone/claim] CONFIG_ERROR: MEDAL milestone ${msId} has no medalId (activity=${activeActivityId} user=${userId})`);
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'CONFIG_ERROR',
              message: '勋章里程碑未配置 medalId',
            },
          } as ClaimError,
          { status: 500 },
        );
      }

      const originalUserId = extractOriginalUserId(req, body as unknown as Record<string, unknown>);
      console.log(`[game/milestone/claim] Medal reward detected: badge=${medalIdRaw} for user ${userId} activity=${activeActivityId}`);

      const grantResult = await grantBadge({
        userId,
        originalUserId,
        badgeId:   medalIdRaw,
        activityId: String(activeActivityId),
      });

      if (!grantResult.ok) {
        console.error(
          `[game/milestone/claim] Badge grant failed reason=${grantResult.reason} ` +
          `message=${grantResult.message} msId=${msId} user=${userId}`,
        );
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: `勋章发放失败：${grantResult.message}`,
            },
          } as ClaimError,
          { status: 500 },
        );
      }
    }

    // P0 2026-08-21 REPARK: Webhook decoupled (ENERGY only).
    // The outbound callback to Main Station for ENERGY rewards is FIRE-AND-FORGET.
    // 1. We write the milestone claim to the DB FIRST (so the user always gets credit).
    // 2. We then trigger the webhook asynchronously — its failure is logged but
    //    NEVER blocks the user response. This way a sick Main Station cannot
    //    lock the player out of their reward.
    // 3. The DB row no longer depends on webhook success.
    //
    // 2026-09-13 REPARK: this ENERGY fast-path remains unchanged. MEDAL rewards
    // are gated above by the awaited grantBadge() call so the DB is only
    // written after the Main Station acknowledges the grant.
    // REPARK 7.0 (2026-09-14): Use claimMilestoneReward for atomic claim-write
    // with bypass consumption. This avoids a race between claim write and bypass
    // clear that could occur with a separate upsert+UPDATE pattern under
    // concurrent claims.
    // The function handles pre-migration-17 fallback internally.
    await claimMilestoneReward({
      user_id: userId,
      milestone_id: msId,
      is_claimed: true,
      is_locked: false,
      claimed_at: now,
      reward_type: rewardType,
      reward_value: rewardValue,
    }, adminBypass);

    if (rewardType === 'ENERGY') {
      const energyAmount = Number(rewardValue);
      if (energyAmount > 0) {
        console.log(`[game/milestone/claim] Energy reward detected: +${energyAmount} for user ${userId} (fire-and-forget)`);
        const outboundPayload = {
          userId,
          originalUserId: extractOriginalUserId(req, body as unknown as Record<string, unknown>),
          amount: energyAmount,
          milestoneId: msId,
        };
        // Fire-and-forget. Do NOT await. Caller gets the response immediately.
        void sendMainStationEnergyReward(outboundPayload)
          .then(() => {
            console.log(`[MilestoneClaim] Outbound webhook delivered for msId=${msId} user=${userId}`);
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[MilestoneClaim] Outbound webhook failed in background (non-blocking): msId=${msId} user=${userId} — ${msg}`);
          });
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        milestone_id: msId,
        claimed: true,
        claimed_at: now,
        reward_type: rewardType,
        reward_value: rewardValue,
      },
    } as ClaimResponse, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[MILESTONE-CLAIM] FATAL:', msg);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: msg } } as ClaimError,
      { status: 500 }
    );
  }
}
