/**
 * POST /api/admin/activity/finalize — finalize activity milestone rewards.
 *
 * Migrated from Supabase → AWS RDS via lib/db/activitiesPg.ts + lib/db/pg.ts.
 *
 * This route now performs the milestone finalization client-side via a
 * SQL transaction instead of relying on a Supabase RPC.
 */

import { NextResponse } from 'next/server';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { getActiveActivity as pgGetActiveActivity, getActivityById } from '@/lib/db/pg';
import { logAdminAction, getClientIp, getOperatorId } from '@/lib/auditLog';

dayjs.extend(utc);
dayjs.extend(timezone);

interface RawMilestone {
  id: string | number;
  threshold: number;
  rewardType: 'ENERGY' | 'MEDAL';
  energyValue?: number;
  medalId?: string;
}

interface FinalizeRequestBody {
  activityId?: number;
  dryRun?: boolean;
}

interface NormalizedMilestone {
  id: number;
  threshold: number;
  rewardType: 'ENERGY' | 'MEDAL';
  rewardValue: string;
}

function isActivityEnded(endTime: string): boolean {
  return dayjs().isAfter(dayjs(endTime));
}

function validateAndNormalizeMilestones(milestones: RawMilestone[] | undefined): NormalizedMilestone[] {
  if (!Array.isArray(milestones) || milestones.length === 0) {
    throw new Error('No milestones configured for this activity.');
  }

  const normalized = milestones.map((m) => {
    const id = Number(m.id);
    const threshold = Number(m.threshold ?? 0);
    const rewardType = m.rewardType;

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Milestone id must be a positive integer.');
    }
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error(`Milestone ${id} threshold must be positive.`);
    }
    if (rewardType !== 'ENERGY' && rewardType !== 'MEDAL') {
      throw new Error(`Milestone ${id} has invalid rewardType.`);
    }

    const rewardValue = rewardType === 'ENERGY'
      ? String(Number(m.energyValue ?? 0))
      : String(m.medalId ?? '').trim();

    if (rewardType === 'ENERGY' && Number(rewardValue) <= 0) {
      throw new Error(`Milestone ${id} ENERGY reward must be > 0.`);
    }
    if (rewardType === 'MEDAL' && rewardValue.length === 0) {
      throw new Error(`Milestone ${id} MEDAL reward must include medalId.`);
    }

    return { id, threshold, rewardType, rewardValue };
  });

  const idSet = new Set(normalized.map((m) => m.id));
  if (idSet.size !== normalized.length) {
    throw new Error('Milestone ids must be unique.');
  }
  const thresholdSet = new Set(normalized.map((m) => m.threshold));
  if (thresholdSet.size !== normalized.length) {
    throw new Error('Milestone thresholds must be unique.');
  }
  return normalized;
}

export async function POST(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  let body: FinalizeRequestBody = {};
  try {
    body = (await req.json()) as FinalizeRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';
  const dryRun = body.dryRun === true;

  const operatorId = getOperatorId(req);
  const clientIp = getClientIp(req);

  try {
      const activityRow =
      typeof body.activityId === 'number'
        ? await getActivityById(body.activityId)
        : await pgGetActiveActivity();

    if (!activityRow) {
      return NextResponse.json(
        { ok: false, error: { code: 'ACTIVITY_NOT_FOUND', message: 'Activity not found' } },
        { status: 404 }
      );
    }

    if (!force && !isActivityEnded(activityRow.end_time)) {
      // REPARK P0 2026-07-30: dryRun 永远不应该被 409 阻断。
      // 演练是只读试算，运营人员在活动进行中必须能随时验证结算逻辑。
      // 仅当 (dryRun=false) 且 (force=false) 的正式发奖才阻断。
      if (!dryRun) {
        return NextResponse.json(
          {
            ok: false,
            error: { code: 'ACTIVITY_NOT_ENDED', message: 'Activity end time has not passed yet' },
          },
          { status: 409 }
        );
      }
      // Dry Run 短路：跳过 409 阻断，但保留 force=true 的安全检查。
      console.info(`[ADMIN:FINALIZE] dryRun bypasses ACTIVITY_NOT_ENDED for activity=${activityRow.id} (end_time=${activityRow.end_time})`);
    }

    // FIX H-7: `force=true` is only allowed in non-production environments.
    // Production must wait for the activity end time before finalizing.
    if (force && process.env.NODE_ENV === 'production') {
      console.warn('[ADMIN:FINALIZE] force=true rejected in production', {
        operatorId,
        clientIp,
        activityId: activityRow.id,
      });
      logAdminAction({
        route: '/api/admin/activity/finalize',
        action: 'finalize_force_rejected',
        operatorId,
        clientIp,
        success: false,
        error: 'force=true is not permitted in production',
        newValue: { activityId: activityRow.id },
      });
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'FORCE_NOT_ALLOWED',
            message: 'force=true is disabled in production to prevent pre-mature finalization.',
          },
        },
        { status: 403 }
      );
    }

    const milestones = validateAndNormalizeMilestones(
      activityRow.config?.milestones as RawMilestone[] | undefined
    );

    const pool = getPostgresPool();

    // FIX H-8: dryRun returns the SAME shape as the production path —
    // counts of eligible users per milestone, top-10 leaderboard preview,
    // and overall distribution totals.  No DB writes occur in this branch.
    if (dryRun) {
      // 1. Per-milestone eligible counts.
      const eligibleCounts: Array<{
        milestoneId: number;
        threshold: number;
        rewardType: 'ENERGY' | 'MEDAL';
        rewardValue: string;
        eligible: number;
      }> = [];
      let totalEligible = 0;
      for (const milestone of milestones) {
        // REPARK 7.0 (2026-08-24): Finalize eligibility is ACTIVITY-SCOPED
        // (user_activity_stats.total_damage for the current activity) — NOT the
        // global user_inventory.total_damage_dealt (all-time total). Without
        // this filter, a player with 80,000 lifetime damage but only 500 in the
        // current activity would be falsely flagged as eligible.
        const cnt = await pool.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c
             FROM public.user_activity_stats
            WHERE activity_id = $1
              AND total_damage >= $2`,
          [activityRow.id, milestone.threshold]
        );
        const n = Number(cnt.rows[0]?.c ?? 0);
        eligibleCounts.push({
          milestoneId: milestone.id,
          threshold: milestone.threshold,
          rewardType: milestone.rewardType,
          rewardValue: milestone.rewardValue,
          eligible: n,
        });
        totalEligible += n;
      }

      // 2. Top-10 leaderboard preview (read-only, no DB writes).
      //    REPARK 7.0 (2026-08-24): The preview is now ACTIVITY-SCOPED — top
      //    players by their damage in THIS activity (user_activity_stats), not
      //    their all-time total. The previous global leaderboard source
      //    produced false positives in the "projected reward" projection: a
      //    player with huge lifetime damage but low current-activity damage
      //    would appear as qualifying for milestones they didn't reach.
      const top10Rows = await pool.query<{
        user_id: string;
        nickname: string | null;
        avatar: string | null;
        total_damage: string;
      }>(
        `SELECT
            uas.user_id,
            COALESCE(NULLIF(u.nickname, ''), '神秘玩家') AS nickname,
            COALESCE(NULLIF(u.avatar,  ''), '👤')        AS avatar,
            uas.total_damage
          FROM public.user_activity_stats uas
          LEFT JOIN public.users u ON u.id = uas.user_id
         WHERE uas.activity_id = $1
           AND uas.total_damage > 0
         ORDER BY uas.total_damage DESC
         LIMIT 10`,
        [activityRow.id]
      );
      const sortedMilestones = [...milestones].sort((a, b) => a.threshold - b.threshold);
      const top10 = top10Rows.rows.map((row, idx) => {
        const dmg = parseInt(row.total_damage, 10);
        // Projected reward: the highest tier milestone this player would unlock.
        const qualified = sortedMilestones.filter((m) => dmg >= m.threshold);
        const topMilestone = qualified.length > 0 ? qualified[qualified.length - 1] : null;
        return {
          rank: idx + 1,
          userId: row.user_id,
          nickname: row.nickname ?? '神秘玩家',
          avatar:    row.avatar    ?? '👤',
          totalDamage: dmg,
          projectedReward: topMilestone
            ? {
                milestoneId: topMilestone.id,
                threshold:   topMilestone.threshold,
                rewardType:  topMilestone.rewardType,
                rewardValue: topMilestone.rewardValue,
              }
            : null,
          milestonesUnlocked: qualified.length,
        };
      });

      // 3. Projected reward totals (sum of ENERGY units; count of MEDALs).
      const rewardsByType = milestones.reduce(
        (acc, m) => {
          const cnt = eligibleCounts.find((e) => e.milestoneId === m.id)?.eligible ?? 0;
          if (m.rewardType === 'ENERGY') {
            acc.energy_total += cnt * Number(m.rewardValue);
          } else {
            acc.medal_total += cnt;
          }
          return acc;
        },
        { energy_total: 0, medal_total: 0 } as { energy_total: number; medal_total: number }
      );

      logAdminAction({
        route: '/api/admin/activity/finalize',
        action: 'finalize_dry_run',
        operatorId,
        clientIp,
        success: true,
        newValue: {
          activityId: activityRow.id,
          milestones: eligibleCounts,
          totalEligible,
          top10Count: top10.length,
        },
      });

      return NextResponse.json({
        ok: true,
        data: {
          activityId: activityRow.id,
          activityName: activityRow.name,
          activityEndTime: activityRow.end_time,
          force,
          dryRun: true,
          dryRunBypassedActivityEnd: !isActivityEnded(activityRow.end_time),
          result: {
            milestone_count: milestones.length,
            eligible: eligibleCounts,
            total_eligible: totalEligible,
            rewards_by_type: rewardsByType,
            top10: top10,
            would_finalize: milestones.map((m) => m.id),
            // Compatibility fields the admin UI expects to find at the same
            // path — kept in sync with the production response below.
            finalized: 0,
            distributed: 0,
          },
        },
      });
    }

    // Production path: ensure all active users who reach a threshold get a
    // milestone_rewards row marked unlocked. Existing rows keep their state.
    const client = await pool.connect();
    let distributed = 0;
    try {
      await client.query('BEGIN');
      for (const milestone of milestones) {
        // REPARK 7.0 (2026-08-24): Eligibility is ACTIVITY-SCOPED — only players
        // whose damage in THIS activity (user_activity_stats.total_damage WHERE
        // activity_id = current) meets the threshold qualify for a milestone row.
        // The previous query read user_inventory.total_damage_dealt (global),
        // which falsely granted rewards based on prior activities.
        const inserted = await client.query(
          `INSERT INTO public.milestone_rewards
             (user_id, milestone_id, is_claimed, is_locked, reward_type, reward_value)
           SELECT user_id, $1, false, false, $2, $3
             FROM public.user_activity_stats
            WHERE activity_id = $5
              AND total_damage >= $4
           ON CONFLICT (user_id, milestone_id) DO NOTHING
           RETURNING user_id`,
          [milestone.id, milestone.rewardType, milestone.rewardValue, milestone.threshold, activityRow.id]
        );
        distributed += inserted.rowCount ?? 0;
      }
      await client.query('COMMIT');

      logAdminAction({
        route: '/api/admin/activity/finalize',
        action: 'finalize',
        operatorId,
        clientIp,
        success: true,
        newValue: {
          activityId: activityRow.id,
          milestones: milestones.length,
          distributed,
        },
      });

      return NextResponse.json({
        ok: true,
        data: {
          activityId: activityRow.id,
          activityName: activityRow.name,
          force,
          dryRun: false,
          result: {
            milestone_count: milestones.length,
            finalized: milestones.length,
            distributed,
          },
        },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      logAdminAction({
        route: '/api/admin/activity/finalize',
        action: 'finalize',
        operatorId,
        clientIp,
        success: false,
        error: err instanceof Error ? err.message : 'unknown',
        newValue: { activityId: activityRow.id },
      });
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: { code: 'FINALIZE_FAILED', message } },
      { status: 500 }
    );
  }
}