/**
 * app/api/internal/cron/finalize-milestones/route.ts
 *
 * App-level scheduler that bulk-finalizes milestone rewards for any activity
 * whose `end_time` has passed. Replaces pg_cron (which is not available on
 * AWS RDS parameter groups without explicit approval) per the directive in
 * MILESTONE_AUTO_CLAIM_IMPLEMENTATION_PLAN.md §2.1.
 *
 * Why an external cron + this endpoint:
 *   - The plan explicitly forbids in-process setInterval (multi-instance
 *     would double-fire; serverless functions don't survive a tick).
 *   - The plan forbids Vercel Cron (activity end_time is data-driven, not
 *     deployment-time fixed).
 *   - So we expose this endpoint and let the operator wire ANY cron
 *     scheduler that can sign HMAC (Windows Task Scheduler, Linux cron,
 *     EventBridge, GitHub Actions, k8s CronJob, etc.) to POST here.
 *
 *   Suggested cadence: every 60 s. The endpoint is idempotent — calling
 *   it 10x/minute is fine; only the FIRST call after an activity ends
 *   will do meaningful work, the rest short-circuit on the
 *   `activity_finalization_log` row written by the RPC.
 *
 * Auth:
 *   Same HMAC gate as /api/internal/startup (see lib/internalAuth.ts).
 *   In dev: loopback calls allowed. In prod: must carry X-Internal-Token.
 *
 * Request body (optional):
 *   { "activityId"?: number, "dryRun"?: boolean, "force"?: boolean }
 *
 *   - activityId : if omitted, the route scans every ENABLED activity that
 *                  has ended but is not yet in activity_finalization_log.
 *   - dryRun     : pass-through to the SQL RPC — counts only, no writes.
 *   - force      : re-run even if finalization_log already has the row.
 *                  The RPC itself is still idempotent.
 *
 * Response:
 *   {
 *     ok: true,
 *     data: {
 *       scanned: number,
 *       finalized: Array<{ activityId, totalClaimed, milestones: [...] }>,
 *       skipped:  Array<{ activityId, reason }>,
 *       dryRun: boolean,
 *       finishedAt: ISO-8601
 *     }
 *   }
 */

import { NextResponse } from 'next/server';
import { getPostgresPool } from '@/lib/db/postgres';
import { authenticateInternalCaller } from '@/lib/internalAuth';
import { getRedisClient } from '@/lib/redis';

// Body shape — all fields optional.
interface FinalizeRequest {
  activityId?: number;
  dryRun?: boolean;
  force?: boolean;
}

interface MilestonePayload {
  id: number;
  threshold: number;
  rewardType: 'ENERGY' | 'MEDAL';
  rewardValue: string;
}

interface ActivityRow {
  id: number;
  name: string;
  status: 'ENABLED' | 'DISABLED';
  start_time: string;
  end_time: string;
  config: { milestones?: unknown[] } & Record<string, unknown>;
}

interface FinalizeRpcResult {
  activityId: number | string;
  dryRun: boolean;
  finalizedAt: string;
  milestones: Array<{
    milestoneId: number;
    threshold: number;
    rewardType: string;
    rewardValue: string;
    eligibleUsers: number;
    newlyClaimed: number;
    dryRun: boolean;
  }>;
}

const HARD_TIMEOUT_MS = 25_000; // stay under Vercel's 30s function limit if hosted there

export async function POST(req: Request) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const authResult = await authenticateInternalCaller(req);
  if (authResult) return authResult;

  // ── Body parse (tolerant — body is optional) ─────────────────────────────
  let body: FinalizeRequest = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as FinalizeRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_JSON', message: 'request body is not valid JSON' } },
      { status: 400 }
    );
  }

  const dryRun = body.dryRun === true;
  const force = body.force === true;
  const onlyActivityId =
    typeof body.activityId === 'number' && Number.isFinite(body.activityId)
      ? body.activityId
      : null;

  const startedAt = Date.now();

  try {
    const pool = getPostgresPool();

    // ── 1. Pick activities to consider ────────────────────────────────────
    //   * If `activityId` provided, scan just that one.
    //   * Otherwise, scan all ENABLED activities whose end_time has passed.
    //   * Exclude any row already in activity_finalization_log (unless force).
    const activities = await loadCandidateActivities(pool, onlyActivityId);

    const finalized: Array<{
      activityId: number;
      totalClaimed: number;
      milestones: FinalizeRpcResult['milestones'];
    }> = [];
    const skipped: Array<{ activityId: number; reason: string }> = [];

    for (const act of activities) {
      if (Date.now() - startedAt > HARD_TIMEOUT_MS) {
        skipped.push({ activityId: act.id, reason: 'hard_timeout' });
        continue;
      }

      // Idempotency check — skip if already finalized and not force.
      if (!force) {
        const seen = await pool.query<{ activity_id: number }>(
          `SELECT activity_id FROM public.activity_finalization_log
             WHERE activity_id = $1 LIMIT 1`,
          [act.id]
        );
        if ((seen.rowCount ?? 0) > 0) {
          skipped.push({ activityId: act.id, reason: 'already_finalized' });
          continue;
        }
      }

      // If the activity config has no milestones, there's nothing to settle.
      const milestones = Array.isArray(act.config?.milestones)
        ? (act.config.milestones as unknown[])
        : [];
      if (milestones.length === 0) {
        skipped.push({ activityId: act.id, reason: 'no_milestones' });
        continue;
      }

      // ── 2. Normalize milestone config ───────────────────────────────────
      const normalized: MilestonePayload[] = [];
      for (const raw of milestones) {
        const m = normalizeMilestone(raw);
        if (!m) {
          skipped.push({ activityId: act.id, reason: 'malformed_milestone' });
          normalized.length = 0;
          break;
        }
        normalized.push(m);
      }
      if (normalized.length === 0) continue;

      // ── 3. Distributed-lock so two cron ticks cannot run the same RPC ──
      //         concurrently. SET NX EX = "first writer wins for 5 minutes".
      const lockOk = await acquireRedisLock(`finalize:activity:${act.id}`, 300);
      if (!lockOk) {
        skipped.push({ activityId: act.id, reason: 'lock_held_by_other_worker' });
        continue;
      }

      try {
        // ── 4. Call the bulk RPC ─────────────────────────────────────────
        const rpcResult = await pool.query<{ finalize_activity_milestone_rewards: FinalizeRpcResult }>(
          `SELECT finalize_activity_milestone_rewards($1::bigint, $2::jsonb, $3::boolean)`,
          [act.id, JSON.stringify(normalized), dryRun]
        );
        const data = rpcResult.rows[0]?.finalize_activity_milestone_rewards;
        if (!data) {
          skipped.push({ activityId: act.id, reason: 'rpc_returned_null' });
          continue;
        }

        // ── 5. Write finalization log so future ticks short-circuit ──────
        //         Skipped on dryRun because the RPC didn't mutate.
        const totalClaimed = data.milestones.reduce(
          (sum, m) => sum + Number(m.newlyClaimed ?? 0),
          0
        );
        if (!dryRun) {
          await pool.query(
            `INSERT INTO public.activity_finalization_log
               (activity_id, finalized_by, total_claimed, result_json)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (activity_id) DO UPDATE
               SET finalized_at  = EXCLUDED.finalized_at,
                   finalized_by  = EXCLUDED.finalized_by,
                   total_claimed = EXCLUDED.total_claimed,
                   result_json   = EXCLUDED.result_json`,
            [
              act.id,
              'cron:finalize-milestones',
              totalClaimed,
              JSON.stringify(data),
            ]
          );
        }

        finalized.push({
          activityId: act.id,
          totalClaimed,
          milestones: data.milestones,
        });
      } finally {
        await releaseRedisLock(`finalize:activity:${act.id}`).catch(() => undefined);
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        scanned: activities.length,
        finalized,
        skipped,
        dryRun,
        finishedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[CRON] finalize-milestones failed:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'CRON_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 }
    );
  }
}

// ── GET returns a lightweight status snapshot — useful for monitoring dashboards.
export async function GET(req: Request) {
  const authResult = await authenticateInternalCaller(req);
  if (authResult) return authResult;

  try {
    const pool = getPostgresPool();
    const r = await pool.query<{
      activity_id: number;
      finalized_at: string;
      finalized_by: string;
      total_claimed: string | number;
    }>(
      `SELECT activity_id, finalized_at, finalized_by, total_claimed
         FROM public.activity_finalization_log
         ORDER BY finalized_at DESC
         LIMIT 20`
    );
    return NextResponse.json({
      ok: true,
      data: {
        recent: r.rows.map((row) => ({
          activityId: row.activity_id,
          finalizedAt: row.finalized_at,
          finalizedBy: row.finalized_by,
          totalClaimed: Number(row.total_claimed ?? 0),
        })),
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[CRON] finalize-milestones status failed:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'STATUS_FAILED', message: String(err) } },
      { status: 500 }
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function loadCandidateActivities(
  pool: ReturnType<typeof getPostgresPool>,
  onlyActivityId: number | null
): Promise<ActivityRow[]> {
  if (onlyActivityId !== null) {
    const r = await pool.query<ActivityRow>(
      `SELECT id, name, status, start_time, end_time, config
         FROM public.activities
         WHERE id = $1`,
      [onlyActivityId]
    );
    return r.rows;
  }
  // Default: every ENABLED activity whose end_time has already passed.
  const r = await pool.query<ActivityRow>(
    `SELECT id, name, status, start_time, end_time, config
       FROM public.activities
       WHERE status = 'ENABLED'
         AND end_time <= timezone('utc'::text, now())
       ORDER BY end_time ASC`
  );
  return r.rows;
}

/**
 * The activity config is freeform JSON. Accept a few historical shapes and
 * coerce them into the canonical payload the RPC expects.
 *
 * Supported inputs:
 *   { id, threshold, rewardType, rewardValue }
 *   { id, threshold, rewardType, energyValue }    ← legacy field name
 *   { id, threshold, rewardType, medalId }        ← legacy field name
 *
 * Reject anything that can't be coerced — fail loud rather than guess.
 */
function normalizeMilestone(raw: unknown): MilestonePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = Number(m.id);
  const threshold = Number(m.threshold);
  const rewardType = String(m.rewardType ?? '').toUpperCase();
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!Number.isFinite(threshold) || threshold < 0) return null;
  if (rewardType !== 'ENERGY' && rewardType !== 'MEDAL') return null;
  const rewardValue =
    String(m.rewardValue ?? m.energyValue ?? m.medalId ?? '').trim() || '0';
  return { id, threshold, rewardType, rewardValue };
}

async function acquireRedisLock(key: string, ttlSeconds: number): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const res = await redis.set(`lock:${key}`, Date.now().toString(), 'EX', ttlSeconds, 'NX');
    return res === 'OK';
  } catch (err) {
    console.warn('[CRON] Redis lock acquire failed, proceeding without lock:', err);
    return true; // fail open on Redis outage — RPC itself is idempotent
  }
}

async function releaseRedisLock(key: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(`lock:${key}`);
  } catch {
    /* ignore — TTL will reap it */
  }
}