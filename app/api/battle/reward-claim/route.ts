/**
 * POST /api/battle/reward-claim — claim a boss HP% milestone reward.
 *
 * Migrated from Supabase + JSON file → AWS RDS via lib/db/pg.ts.
 * Single PG path for every environment — no NODE_ENV branch.
 *
 * P0 2026-08-04 (TC-P0-24): If the reward type is ENERGY, this route now
 * sends an outbound HMAC-signed POST to the Main Station's add-energy endpoint
 * BEFORE marking the milestone as claimed in the DB. If the callback fails,
 * the DB row is NOT updated — guaranteeing DB and Main Station always stay in sync.
 */

import { NextResponse } from 'next/server';
import { getUserIdAsUuid } from '@/lib/auth';
import { getActiveActivity, getMilestoneReward, upsertMilestoneReward, getActivityDamage } from '@/lib/db/pg';
import { sendMainStationEnergyReward } from '@/lib/services/outboundWebhook';
import { grantBadge } from '@/lib/services/badgeAdapter';

interface ActivityConfig {
  milestones?: Array<{
    id: number;
    threshold: number;
    rewardType: 'ENERGY' | 'MEDAL';
    energyValue?: number;
    medalId?: string;
  }>;
  boss?: { totalHp: number; currentHp: number };
}

interface RewardClaimRequest {
  user_id?: string;
  // REPARK 7.0 (2026-08-24): milestone_id now accepts any numeric/string value
  // (was previously restricted to 75|50|25 which represented boss HP% thresholds).
  // The new semantics: personal accumulated damage ≥ milestone.threshold.
  milestone_id: number | string;
}

interface RewardClaimResponse {
  ok: true;
  data: { milestone_id: number; claimed: boolean; claimed_at: string };
}

interface RewardClaimError {
  ok: false;
  error: { code: string; message: string };
}

function isRewardClaimRequest(payload: unknown): payload is RewardClaimRequest {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  // REPARK 7.0 (2026-08-24): Accept any milestone_id (number or string of digits).
  // The previous hard-coded [75,50,25] reflected boss HP% thresholds and is obsolete.
  if (typeof record.milestone_id === 'number') return Number.isFinite(record.milestone_id);
  if (typeof record.milestone_id === 'string') return /^\d+$/.test(record.milestone_id);
  return false;
}

export async function POST(req: Request) {
  try {
    const requestBody = await req.json().catch(() => ({}));
    const body = requestBody as Partial<RewardClaimRequest>;

    let userId: string;
    let originalUserId: string; // P0 2026-08-08: raw long ID for outbound webhook (Main Station only accepts long form)
    if (body.user_id) {
      userId = body.user_id;
      originalUserId = body.user_id;
    } else {
      const authResult = getUserIdAsUuid(req);
      if (!authResult) {
        return NextResponse.json({
          ok: false,
          error: { code: 'UNAUTHORIZED', message: '请先登录后再访问' },
        } as RewardClaimError, { status: 401 });
      }
      userId = authResult.userId;
      // Fallback: authResult.userId is already UUID-canonical; use the same value
      // as originalUserId (Main Station will reject, but the DB layer is still
      // consistent and we don't silently swallow claims).
      originalUserId = authResult.userId;
    }

    if (!isRewardClaimRequest(body)) {
      console.warn(`[REWARD-CLAIM] BAD_REQUEST: invalid milestone_id=${body?.milestone_id}`);
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid milestone_id' },
      } as RewardClaimError, { status: 400 });
    }

    // REPARK 7.0 (2026-08-24): milestone_id is no longer restricted to 75/50/25.
    // Normalise to integer form (strip "m" prefix if present).
    const rawMilestoneId = String(body.milestone_id);
    const numericMatch = rawMilestoneId.match(/\d+/);
    const milestoneId: number = numericMatch ? Number(numericMatch[0]) : NaN;
    if (!Number.isFinite(milestoneId) || milestoneId <= 0) {
      return NextResponse.json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid milestone_id' },
      } as RewardClaimError, { status: 400 });
    }

    // REPARK 7.0 (2026-08-24): Resolve activity config + milestone definition.
    // The OLD boss-HP-based logic is REMOVED. The new unlock rule is:
    //   user_activity_stats.total_damage >= milestone.threshold
    let activityConfig: ActivityConfig = {};
    let activity: Awaited<ReturnType<typeof getActiveActivity>> = null;
    try {
      activity = await getActiveActivity();
      activityConfig = (activity?.config as ActivityConfig | undefined) ?? {};
    } catch (err) {
      console.warn('[REWARD-CLAIM] Failed to read active activity:', err);
    }

    // REPARK 7.0 (2026-08-24): Personal damage check (was: boss HP%).
    // The milestone's `threshold` is now the player's required personal damage.
    // Milestone ids in config are strings like "m1787457630" while the request
    // body may carry the integer form. Normalise both sides so the lookup is
    // robust against either representation.
    const stripMsPrefix = (id: unknown): number => {
      if (typeof id === 'number') return id;
      const m = String(id ?? '').match(/\d+/);
      return m ? Number(m[0]) : NaN;
    };
    const milestoneConfig = activityConfig.milestones?.find(
      (m) => stripMsPrefix(m.id) === milestoneId
    );
    // REPARK 7.0 (2026-08-24): Milestone rewards are unlocked by ACTIVITY-SCOPED
    // personal accumulated damage (user_activity_stats.total_damage), NOT the global
    // user_inventory.total_damage_dealt. The `activity` was already resolved above.
    const activeActivityId = activity?.id ?? 0;
    const personalThreshold = Number(milestoneConfig?.threshold ?? 0);
    let personalDamage = 0;
    if (activeActivityId > 0) {
      try {
        personalDamage = await getActivityDamage(userId, activeActivityId);
      } catch (err) {
        console.warn('[REWARD-CLAIM] Activity damage query failed:', err);
      }
    }
    console.log('[REWARD-CLAIM Threshold Check]', {
      userId, activityId: activeActivityId, milestoneId, personalThreshold, personalDamage,
      pass: personalDamage >= personalThreshold,
    });
    if (personalDamage < personalThreshold) {
      return NextResponse.json({
        ok: false,
        error: {
          code: 'THRESHOLD_NOT_MET',
          message: `个人累计伤害未达标（需达到 ${personalThreshold} 点，当前 ${personalDamage} 点）`,
        },
      } as RewardClaimError, { status: 400 });
    }

    // Idempotency / lock check
    const existing = await getMilestoneReward(userId, milestoneId);
    if (existing?.is_claimed) {
      return NextResponse.json({
        ok: false,
        error: { code: 'ALREADY_CLAIMED', message: '已领取' },
      } as RewardClaimError, { status: 409 });
    }

    // Look up the reward type from the activity config so we know if this is an ENERGY reward.
    // REPARK 7.0 (2026-08-24): milestoneConfig was already resolved above for the
    // personal-damage threshold check, so we just reuse it.
    const rewardType: 'ENERGY' | 'MEDAL' =
      (milestoneConfig?.rewardType as 'ENERGY' | 'MEDAL') ?? 'MEDAL';
    const energyValue = Number(milestoneConfig?.energyValue ?? 0);

    // P0 2026-08-04 (TC-P0-24): For ENERGY rewards, fire the outbound callback
    // to the Main Station BEFORE writing the DB. If the callback fails we do NOT
    // update the row — this guarantees the Main Station always receives the reward
    // before we consider the claim settled.
    if (rewardType === 'ENERGY' && energyValue > 0) {
      console.log(`[battle/reward-claim] Energy reward detected: +${energyValue} for user ${userId}`);
      await sendMainStationEnergyReward({
        userId,
        originalUserId,
        amount: energyValue,
        milestoneId,
      });
    }

    // P0 Badge Adapter Integration (2026-09-11, hardened 2026-09-11 addendum):
    // For MEDAL rewards, fire the outbound badge grant callback to the Main
    // Station BEFORE writing the DB. If the callback fails we do NOT update
    // the row — same invariant as ENERGY: the Main Station must receive the
    // grant before we consider the claim settled.
    //
    // The Badge Grant API is idempotent on the Main Station side (insert
    // ignore) so duplicate grants are safe; the adapter generates a single
    // stable request_id and reuses it across retries.
    if (rewardType === 'MEDAL') {
      const medalIdRaw = String(milestoneConfig?.medalId ?? '');

      // Hardening 4: a missing medalId is a CONFIG_ERROR. We fail loudly
      // and never silently skip the badge grant.
      if (!medalIdRaw) {
        console.error(`[battle/reward-claim] ❌ CONFIG_ERROR: MEDAL milestone ${milestoneId} has no badge_id`);
        return NextResponse.json({
          ok: false,
          error: {
            code: 'CONFIG_ERROR',
            message: '勋章里程碑未配置 badge_id',
          },
        } as RewardClaimError, { status: 500 });
      }

      console.log(`[battle/reward-claim] Medal reward detected: badge=${medalIdRaw} for user ${userId}`);
      const grantResult = await grantBadge({
        userId,
        originalUserId,
        badgeId:   medalIdRaw,
        activityId: String(activeActivityId),
      });

      if (!grantResult.ok) {
        // Hardening 3: outward error semantics match ENERGY. The ENERGY flow
        // throws inside sendMainStationEnergyReward and the route catches it
        // as a generic 500 INTERNAL_ERROR. We mirror that here: the adapter
        // returns a structured failure, but the HTTP status we surface is 500
        // — same as every other route-level failure in this file.
        console.error(
          `[battle/reward-claim] ❌ Badge grant failed reason=${grantResult.reason} ` +
          `message=${grantResult.message}`
        );
        return NextResponse.json({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: `勋章发放失败：${grantResult.message}`,
          },
        } as RewardClaimError, { status: 500 });
      }
    }

    const now = new Date().toISOString();
    // REPARK 7.0 (2026-08-24): reward_type now reflects the admin-configured
    // milestone reward (ENERGY/MEDAL). The DB constraint
    // `milestone_rewards_reward_type_check` only allows those two values —
    // the previous hardcoded 'BOSS_HP_MILESTONE' violated the constraint
    // and was a pre-existing latent bug.
    await upsertMilestoneReward({
      user_id: userId,
      milestone_id: String(milestoneId),
      is_claimed: true,
      is_locked: false,
      claimed_at: now,
      reward_type: rewardType,
      reward_value: String(milestoneId),
    });

    return NextResponse.json({
      ok: true,
      data: { milestone_id: milestoneId, claimed: true, claimed_at: now },
    } as RewardClaimResponse, { status: 200 });
  } catch (err) {
    console.error('[REWARD-CLAIM] FATAL ERROR:', err);
    return NextResponse.json({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
    } as RewardClaimError, { status: 500 });
  }
}
