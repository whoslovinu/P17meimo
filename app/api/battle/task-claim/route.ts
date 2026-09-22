/**
 * POST /api/battle/task-claim — claim a daily task reward.
 *
 * Migrated from Supabase + JSON file → AWS RDS via lib/db/pg.ts.
 * Single PG path for every environment.
 */

import { NextResponse } from 'next/server';
import { getUserIdAsUuid } from '@/lib/auth';
import { getRedisClient } from '@/lib/redis';
import { getPostgresPool } from '@/lib/db/postgres';
import {
  upsertUserInventory,
  getActiveActivity,
  getDailyTask,
  resolveEffectiveDailyTaskDate,
  migrateDailyTaskBucketOnTransition,
  grantActivityItemTx,
  getActivityInventory,
} from '@/lib/db/pg';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// P0 2026-07-28: thresholds are no longer hardcoded — pulled from the active
// activity config (items.propA.taskThreshold = pt, items.propB.taskThreshold = 元).
// The legacy 100/5000 values stay only as a final safety net if the DB lookup
// itself fails (e.g., transient outage during a claim).
const FALLBACK_TASK_THRESHOLDS = {
  daily_energy: 100,
  daily_recharge: 50,
} as const;

const TASK_REWARDS = {
  daily_energy: 'item_hand',
  daily_recharge: 'item_phallus',
} as const;

const LOCK_TTL_SECONDS = 5;

function getTodayUtc8(): string {
  return dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
}

async function acquireClaimLock(
  redis: ReturnType<typeof getRedisClient>,
  userId: string,
  taskType: string
): Promise<boolean> {
  const key = `claim:lock:${userId}:${taskType}`;
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  try {
    const result = await redis.set(key, token, 'EX', LOCK_TTL_SECONDS, 'NX');
    return result === 'OK';
  } catch (err) {
    // P0 2026-08-19: Redis transient failure (network blip, throttle, etc.)
    // used to return `false`, which then short-circuited the handler with
    // 409 CONCURRENT_CLAIM. That made EVERY retry of a perfectly valid claim
    // appear as a duplicate-click error. Fail open (allow the request to
    // proceed) so the database CAS is the sole authority for over-claim
    // protection — Postgres is the source of truth anyway.
    console.warn('[TaskClaim] acquireClaimLock: redis set failed, fail-open', err instanceof Error ? err.message : String(err));
    return true;
  }
}

async function releaseClaimLock(
  redis: ReturnType<typeof getRedisClient>,
  userId: string,
  taskType: string,
  token: string
): Promise<void> {
  const key = `claim:lock:${userId}:${taskType}`;
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redis.eval(script, 1, key, token);
  } catch {
    /* best-effort */
  }
}

interface TaskClaimRequest {
  user_id?: string;
  task_type: 'daily_energy' | 'daily_recharge';
}

interface TaskClaimResponse {
  ok: true;
  data: {
    task_type: string;
    claimed: boolean;
    reward_item: string;
    // P0 2026-08-02: surfaced to the front-end so it can render an immediate
    // optimistic state without waiting for the next /api/battle/init poll.
    claimed_count: number;
    remaining_attempts: number;
    current_progress: number;
    threshold: number;
    inventory: { item_hand: number; item_phallus: number };
  };
}

interface TaskClaimError {
  ok: false;
  error: { code: string; message: string };
}

function isTaskClaimRequest(payload: unknown): payload is TaskClaimRequest {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  return record.task_type === 'daily_energy' || record.task_type === 'daily_recharge';
}

export async function POST(req: Request) {
  let requestBody: Partial<TaskClaimRequest> = {};
  try {
    requestBody = await req.json();
  } catch {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' },
    } as TaskClaimError, { status: 400 });
  }

  if (!isTaskClaimRequest(requestBody)) {
    return NextResponse.json({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid task_type' },
    } as TaskClaimError, { status: 400 });
  }

  // P0 2026-07-28: gate every claim behind the live activity flag.
  // If the Commander disabled the activity in /admin we MUST refuse the reward
  // — the user should never be able to walk away with a task reward after the
  // kill switch is pulled.
  const active = await getActiveActivity();
  if (!active || !Boolean((active.config as Record<string, unknown> | null)?.isGlobalEnabled)) {
    return NextResponse.json({
      ok: false,
      error: { code: 'ACTIVITY_OFFLINE', message: '活动已暂停或下线，暂不可领取奖励' },
    } as TaskClaimError, { status: 400 });
  }

  const taskType = requestBody.task_type;
  const rewardItem = TASK_REWARDS[taskType];

  // REPARK 7.0 Batch C (2026-08-28): resolve the customer-configured
  // 每日自动重置 toggle and lazily migrate the user's today-bucket progress
  // into the new anchor bucket on the first read after an ON→OFF transition.
  // Every subsequent SELECT/UPDATE in this handler funnels through
  // `effectiveDailyDate` so the bucket key is identical to the webhook writer
  // and the battle/init / status readers.
  const eff = resolveEffectiveDailyTaskDate(active);
  if (eff.date !== eff.todayDate) {
    // We don't yet know the userId here in every branch — only after the
    // auth resolution below. We perform the migration after we have the
    // userId but before any daily-task read/write. The flag check is just
    // the early-out so the ON case pays no cost.
    // (handled below after userId is resolved)
  }

  // P0 2026-07-28: pull the threshold from the live activity config so admin
  // edits take effect without a redeploy. Falls back to the safety net only
  // when the config is missing the field.
  const items = (active.config as Record<string, unknown> | null)?.items as
    | Record<string, unknown>
    | undefined;
  const propCfg = (taskType === 'daily_energy' ? items?.propA : items?.propB) as
    | Record<string, unknown>
    | undefined;
  const configuredThreshold = Number(propCfg?.taskThreshold);
  const fallbackThreshold = FALLBACK_TASK_THRESHOLDS[taskType];
  const threshold =
    Number.isFinite(configuredThreshold) && configuredThreshold > 0
      ? configuredThreshold
      : fallbackThreshold;

  // P0 2026-08-02: pull per-task dailyLimit from the same activity config so
  // the over-claim guard and the rollover math both agree with the front-end
  // "今日剩余 X/Y 次" denominator.
  //
  // P0 2026-08-02 (TC-P0-15) BUGFIX: previous build had `dailyLimitB: 5`
  // hard-coded as "unused" — but task-claim's over-claim guard
  // (`dailyLimitForTask`) reads `dailyLimitB` for the `daily_recharge` branch,
  // so recharge tasks were capped at 5 even when admin config set 10. Fix:
  // resolve `propCfg.dailyLimit` (which is `items.propB.dailyLimit` for
  // recharge) and mirror it into BOTH `dailyLimitA` and `dailyLimitB` so the
  // `dailyLimitForTask` switch picks the right value regardless of task type.
  // The historical naming A/B is kept for symmetry with init/route.ts.
  const configuredDailyLimit = Number(propCfg?.dailyLimit);
  const resolvedDailyLimit =
    Number.isFinite(configuredDailyLimit) && configuredDailyLimit > 0
      ? configuredDailyLimit
      : 5;
  const taskThresholds = {
    daily_energy: threshold,
    daily_recharge: FALLBACK_TASK_THRESHOLDS.daily_recharge, // unused here but kept for symmetry
    dailyLimitA: resolvedDailyLimit,
    dailyLimitB: resolvedDailyLimit,
  };

  let userId: string;
  if (requestBody.user_id) {
    userId = requestBody.user_id;
  } else {
    const authResult = getUserIdAsUuid(req);
    if (!authResult) {
      return NextResponse.json({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: '请先登录后再访问' },
      } as TaskClaimError, { status: 401 });
    }
    userId = authResult.userId;
  }

  // REPARK 7.0 Batch C (2026-08-28): perform the one-shot, idempotent
  // migration of today-bucket progress into the anchor bucket on the first
  // read after an ON→OFF transition. Safe to call repeatedly: ON CONFLICT
  // DO NOTHING inside the migration helper guarantees no double copy.
  if (eff.date !== eff.todayDate) {
    await migrateDailyTaskBucketOnTransition(userId, eff);
  }

  const redis = getRedisClient();
  const today = eff.date;

  const lockAcquired = await acquireClaimLock(redis, userId, taskType);
  if (!lockAcquired) {
    return NextResponse.json({
      ok: false,
      error: { code: 'CONCURRENT_CLAIM', message: '请勿重复点击，请稍后重试' },
    } as TaskClaimError, { status: 409 });
  }

  const lockKey = `claim:lock:${userId}:${taskType}`;
  let lockToken: string | null = null;
  try {
    lockToken = await redis.get(lockKey);
  } catch (err) {
    console.warn('[TaskClaim] redis.get(lockKey) failed, lockToken=null', err instanceof Error ? err.message : String(err));
  }

  try {
    const pool = getPostgresPool();

    // Read task_progress row (claim tracking) + rollover boundary check.
    // P0 2026-08-02: also pull `claimed_count` so we can guard against over-claim
    // and compute remaining attempts on the server (the front-end counts only for
    // display; the backend is the source of truth).
    const taskResult = await pool.query<{
      current_progress: number;
      is_claimed: boolean;
      claimed_count: number;
    }>(
      `SELECT current_progress, is_claimed, claimed_count
         FROM public.task_progress
        WHERE user_id = $1 AND task_type = $2 AND reset_date = $3
        LIMIT 1`,
      [userId, taskType, today]
    );
    const taskRow = taskResult.rows[0];
    const priorClaimedCount = Number(taskRow?.claimed_count ?? 0);

    // P0 2026-08-19 (TC-P0-17) DATA-SOURCE ALIGNMENT:
    //   Previous build read `task_progress.current_progress` here, but
    //   /api/battle/init (and /api/user/status) read from
    //   `user_daily_tasks.daily_money_recharged`. These two tables CAN drift
    //   (webhook additive-upsert races, schema migration windows, manual
    //   admin edits). When they do, init renders "100 / 88 元达标" while
    //   task-claim reads 0 and rejects with PROGRESS_NOT_MET.
    //   Fix: pull the SAME source init does (getDailyTask), convert to
    //   yuan exactly like init does, and compare against the yuan threshold.
    //   This is now the single source of truth for the claim gate AND the
    //   UI gate, so the two can never disagree.
    const dailyTask = await getDailyTask(userId, today);
    const rawEnergyConsumed = Number(dailyTask?.daily_energy_consumed ?? 0);   // pt (int)
    const rawMoneyRecharged  = Number(dailyTask?.daily_money_recharged ?? 0);   // fen (int)

    // Init displays recharge as yuan (rawMoneyRecharged / 100). Energy stays in pt.
    const rechargeProgressYuan = Math.round(rawMoneyRecharged) / 100;          // yuan
    // currentProgress keeps its name for downstream CAS deduction code, but is now
    // expressed in the SAME unit as threshold (yuan for recharge, pt for energy).
    const currentProgress = taskType === 'daily_recharge' ? rechargeProgressYuan : rawEnergyConsumed;
    // currentProgressRaw preserves the underlying DB value (fen / pt) for the
    // legacy webhook-import fallback check.
    const currentProgressRaw = taskType === 'daily_recharge' ? rawMoneyRecharged : rawEnergyConsumed;

    // P0 2026-08-02: refuse if this task has already been claimed `dailyLimit`
    // times today. We look up the limit from the same activity config we used
    // for the threshold so the two values stay in lock-step (a denial here is
    // a backstop; the front-end hides the button once remaining=0).
    //
    // P0 2026-08-02 (TC-P0-12): hard-cap guard. The CAS clause below will
    // also fail if this check is bypassed, but doing an explicit guard keeps
    // the failure mode observable (no roll-over deduction, no inventory grant).
    // We surface `subcode: DAILY_LIMIT_EXCEEDED` for new monitoring/audit
    // consumers while keeping `code: ALREADY_CLAIMED` so the existing
    // front-end toast handler (SubPageModal.tsx) keeps working.
    const dailyLimitForTask = taskType === 'daily_energy'
      ? taskThresholds.dailyLimitA
      : taskThresholds.dailyLimitB;
    // P0 2026-08-19: Detailed diagnostic log so we can trace exactly why a
    // claim is rejected without parsing server logs. Covers the full evaluation
    // chain: DB row → threshold → daily-limit guard → progress guard.
    console.log('[TaskClaim] Check', {
      userId, taskType,
      dailyTasks: { rawEnergyConsumed, rawMoneyRecharged, rechargeProgressYuan },
      resolvedThreshold: threshold,
      resolvedDailyLimit: dailyLimitForTask,
      priorClaimedCount,
      currentProgress,
      currentProgressRaw,
      progressGuard: currentProgress >= threshold,
      limitGuard: priorClaimedCount < dailyLimitForTask,
    });

    if (priorClaimedCount >= dailyLimitForTask) {
      return NextResponse.json({
        ok: false,
        error: {
          code: 'ALREADY_CLAIMED',
          subcode: 'DAILY_LIMIT_EXCEEDED',
          message: '今日领取次数已达上限',
          daily_limit: dailyLimitForTask,
          claimed_count: priorClaimedCount,
        },
      } as TaskClaimError, { status: 409 });
    }

    if (currentProgress < threshold) {
      // P0 2026-08-19 FIX (TC-P0-17): currentProgress and threshold are now
      // both expressed in the same unit (yuan for recharge, pt for energy)
      // because they come from the same `user_daily_tasks` row, so the
      // comparison above is unambiguous. Keep one legacy fallback for any
      // import path that still stored cents (raw >= threshold * 100) just so
      // we don't regress on historical data.
      const rawMatchesFenMode = currentProgressRaw >= threshold * 100;
      console.log('[TaskClaim] REJECT: PROGRESS_NOT_MET', {
        currentProgress, threshold, currentProgressRaw, rawMatchesFenMode,
      });
      if (rawMatchesFenMode) {
        console.log('[TaskClaim] override-accept (legacy-fen-mode)', { currentProgressRaw, threshold });
        // fall through to success path
      } else {
        return NextResponse.json({
          ok: false,
          error: {
            code: 'PROGRESS_NOT_MET',
            message: '任务进度未达成',
            current_progress: currentProgress,
            threshold,
          },
        } as TaskClaimError, { status: 400 });
      }
    }

    // P0 2026-08-19 FIX: progress rollover. The DB stores recharge amounts in
    // 分 (cents) — threshold is in 元 (from activity config). Convert for deduction.
    //   - daily_recharge: deduct `threshold * 100` 分
    //   - daily_energy:   deduct `threshold` 电量（same unit as DB）
    const deductAmount = taskType === 'daily_recharge'
      ? Math.round(threshold * 100)   // 元 → 分
      : threshold;
    const newProgress = Math.max(0, currentProgress - deductAmount);
    const newClaimedCount = priorClaimedCount + 1;
    // Same unit as deductAmount above (matches the SQL UPDATE).
    const deductAmountDailyTask = taskType === 'daily_recharge'
      ? Math.round(threshold * 100)
      : threshold;

    // REPARK 7.0 (2026-09-22): Task claim ATOMIC TRANSACTION.
    // All claim-state writes AND the activity-scoped inventory grant must
    // succeed together. If any step throws → ROLLBACK everything.
    //
    // Sequence:
    //   1. CAS task_progress (claimed_count++)
    //   2. Sync user_daily_tasks (subtract threshold)
    //   3. Mirror is_claimed boolean when limit reached
    //   4. grantActivityItemTx on user_activity_inventory
    //
    // No partial commit: either all four succeed and the player gets
    // their item, or none succeed and the player can retry.
    const dbClient = await pool.connect();
    let finalInventory: { item_hand_count: number; item_phallus_count: number } | null = null;
    try {
      await dbClient.query('BEGIN');

      // Step 1: CAS task_progress
      const claimResult = await dbClient.query(
        `INSERT INTO public.task_progress
           (user_id, task_type, reset_date, current_progress, claimed_count, is_claimed)
         VALUES ($1, $2, $3, $5, $4, false)
         ON CONFLICT (user_id, task_type, reset_date) DO UPDATE
           SET claimed_count   = $4,
               current_progress = $5
           WHERE public.task_progress.user_id      = $1
             AND public.task_progress.task_type   = $2
             AND public.task_progress.reset_date  = $3
             AND public.task_progress.claimed_count = $6
         RETURNING user_id, claimed_count, current_progress`,
        [userId, taskType, today, newClaimedCount, newProgress, priorClaimedCount]
      );

      if ((claimResult.rowCount ?? 0) === 0) {
        // CAS failed → throw to rollback. Caller translates to 409.
        throw new Error('CONCURRENT_CLAIM');
      }

      // Step 2: sync user_daily_tasks (subtract threshold)
      if (taskType === 'daily_energy') {
        await dbClient.query(
          `UPDATE public.user_daily_tasks
              SET daily_energy_consumed = GREATEST(0, daily_energy_consumed - $2)
            WHERE user_id = $1 AND date = $3`,
          [userId, deductAmountDailyTask, today]
        );
      } else {
        await dbClient.query(
          `UPDATE public.user_daily_tasks
              SET daily_money_recharged = GREATEST(0, daily_money_recharged - $2)
            WHERE user_id = $1 AND date = $3`,
          [userId, deductAmountDailyTask, today]
        );
      }

      // Step 3: is_claimed mirror (only when limit reached)
      if (newClaimedCount >= dailyLimitForTask) {
        await dbClient.query(
          `UPDATE public.task_progress
              SET is_claimed = true
            WHERE user_id = $1 AND task_type = $2 AND reset_date = $3`,
          [userId, taskType, today]
        );
      }

      // Step 4: activity-scoped inventory grant (REPARK 7.0, 2026-09-22)
      if (!active) {
        throw new Error('NO_ACTIVE_ACTIVITY');
      }
      const grantColumn = rewardItem === 'item_hand' ? 'item_hand_count' : 'item_phallus_count';
      // Use the explicit transaction-aware grant helper. It uses UPDATE +1
      // with a strict rowCount check; failure here rolls back the whole claim.
      const newCount = await grantActivityItemTx(
        dbClient,
        userId,
        active.id,
        rewardItem,
      );

      // Read back the row for the response payload.
      const finalRow = await dbClient.query<{
        item_hand_count: number;
        item_phallus_count: number;
      }>(
        `SELECT item_hand_count, item_phallus_count
           FROM public.user_activity_inventory
          WHERE user_id = $1 AND activity_id = $2
          LIMIT 1`,
        [userId, active.id],
      );
      finalInventory = finalRow.rows[0] ?? null;
      console.log('[TaskClaim] GRANT', {
        userId, activityId: active.id, rewardItem,
        newCount, column: grantColumn,
      });

      await dbClient.query('COMMIT');
    } catch (txErr) {
      await dbClient.query('ROLLBACK').catch(() => undefined);
      const txMsg = txErr instanceof Error ? txErr.message : String(txErr);
      if (txMsg === 'CONCURRENT_CLAIM') {
        return NextResponse.json({
          ok: false,
          error: { code: 'CONCURRENT_CLAIM', message: '请勿重复点击，请稍后重试' },
        } as TaskClaimError, { status: 409 });
      }
      if (txMsg === 'NO_ACTIVE_ACTIVITY') {
        return NextResponse.json({
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Cannot grant item: no active activity' },
        } as TaskClaimError, { status: 500 });
      }
      console.error('[TaskClaim] Transaction failed:', txErr);
      return NextResponse.json({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Task claim failed' },
      } as TaskClaimError, { status: 500 });
    } finally {
      dbClient.release();
    }

    const inv = finalInventory;

    return NextResponse.json({
      ok: true,
      data: {
        task_type: taskType,
        claimed: true,
        reward_item: rewardItem,
        count: 1,
        type: taskType === 'daily_recharge' ? 'prop_b' : 'prop_a',
        claimed_count: newClaimedCount,
        remaining_attempts: Math.max(0, dailyLimitForTask - newClaimedCount),
        current_progress: newProgress,
        threshold,
        inventory: {
          item_hand: inv?.item_hand_count ?? 0,
          item_phallus: inv?.item_phallus_count ?? 0,
        },
      },
    } as TaskClaimResponse, { status: 200 });
  } catch (err) {
    console.error('[TASK-CLAIM] error:', err);
    return NextResponse.json({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
    } as TaskClaimError, { status: 500 });
  } finally {
    if (lockToken) {
      await releaseClaimLock(redis, userId, taskType, lockToken);
    }
  }
}