/**
 * PUT    /api/admin/activity/update — update an activity by id
 * DELETE /api/admin/activity/update?id=<n> — delete by id
 *
 * Migrated from Supabase + JSON file → AWS RDS via lib/db/activitiesPg.ts.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { warmBossCacheFromDb } from '@/lib/redis';
import { updateBossStatus, listActivities } from '@/lib/db/pg';
import { getPostgresPool } from '@/lib/db/postgres';
import {
  getActivityById,
  updateActivity,
  deleteActivity,
  type Activity,
} from './db';

// ── Validators (unchanged from prior implementation) ────────────────────────

function validateItems(body: Record<string, unknown>): NextResponse | null {
  const config = body.config as Record<string, unknown> | undefined;
  if (!config) return null;
  const items = config.items as Record<string, unknown> | undefined;
  if (!items) return null;

  for (const propKey of ['propA', 'propB']) {
    const prop = items[propKey] as Record<string, unknown> | undefined;
    if (!prop) continue;

    const rows = prop.rows as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(rows)) continue;

    for (const row of rows) {
      const prob = Number(row.probability);
      if (Number.isNaN(prob) || prob < 0 || prob > 100) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'PROBABILITY_OUT_OF_RANGE',
              message: `${propKey === 'propA' ? '闪电符文' : '潮汐晶石'} 伤害概率必须在 0%~100% 之间，当前值: ${row.probability}`,
            },
          },
          { status: 400 }
        );
      }
    }

    const sum = rows.reduce(
      (acc: number, r: Record<string, unknown>) => acc + (Number(r.probability) || 0),
      0
    );

    if (Math.abs(sum - 100) > 0.001) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'PROBABILITY_SUM_INVALID',
            message: `${propKey === 'propA' ? '闪电符文' : '潮汐晶石'} 的概率总和必须等于 100%，当前为 ${sum.toFixed(1)}%`,
          },
        },
        { status: 400 }
      );
    }
  }
  return null;
}

function validateMilestones(body: Record<string, unknown>): NextResponse | null {
  const config = body.config as Record<string, unknown> | undefined;
  if (!config) return null;
  const milestones = config.milestones as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(milestones)) return null;

  const seen = new Map<number, string>();
  for (const ms of milestones) {
    const threshold = Number(ms.threshold);
    if (seen.has(threshold)) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'DUPLICATE_MILESTONE_THRESHOLD',
            message: `里程碑阈值 ${threshold} 重复（与 ID ${seen.get(threshold)} 相同），请修正后重试`,
          },
        },
        { status: 400 }
      );
    }
    seen.set(threshold, String(ms.id ?? ''));
  }
  return null;
}

function validateConfig(body: Record<string, unknown>): NextResponse | null {
  const config = body.config as Record<string, unknown> | undefined;
  if (!config) return null;
  const boss = config.boss as Record<string, unknown> | undefined;
  if (!boss) return null;

  const totalHp = Number(boss.totalHp);
  if (boss.totalHp !== undefined && (Number.isNaN(totalHp) || totalHp <= 0)) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_TOTAL_HP', message: '总血量必须大于 0' } },
      { status: 400 }
    );
  }

  const currentHp = Number(boss.currentHp);
  if (boss.currentHp !== undefined && (Number.isNaN(currentHp) || currentHp < 0)) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_CURRENT_HP', message: '当前血量不能为负数' } },
      { status: 400 }
    );
  }

  if (
    boss.totalHp !== undefined &&
    boss.currentHp !== undefined &&
    !Number.isNaN(totalHp) &&
    !Number.isNaN(currentHp) &&
    currentHp > totalHp
  ) {
    return NextResponse.json(
      { ok: false, error: { code: 'CURRENT_HP_EXCEEDS_TOTAL', message: '当前血量不能大于总血量' } },
      { status: 400 }
    );
  }
  return null;
}

function parseUtc8(s: string): number {
  const padded = s.length === 16 ? `${s}:00+08:00` : `${s}+08:00`;
  return new Date(padded).getTime();
}

/**
 * Normalise a milestone ID to the canonical string form stored in milestone_rewards.
 * Accepts both "m1789292914" style strings and plain integers.
 * Used to ensure consistent comparison across all activity config checks.
 */
function normalizeMilestoneId(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Strip "m" prefix (Unix timestamp style IDs) to get the canonical integer string.
  const stripped = s.replace(/^m/i, '');
  const n = Number(stripped);
  // Reject non-finite numbers, zero, and negatives.
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.floor(n));
}

/**
 * REPARK 7.0 (2026-09-14): Cross-activity milestone ID conflict check.
 *
 * Scans all OTHER activities' configs for milestone IDs that collide with the
 * milestones being saved in this request. Collisions would cause ambiguous
 * milestone_rewards rows: a single (user_id, milestone_id) row would belong to
 * two different activities, making override and claim state meaningless.
 *
 * Uses pg_advisory_xact_lock to serialise this check against concurrent saves
 * of OTHER activities' configs. The lock is transaction-scoped (automatically
 * released on COMMIT/ROLLBACK), so it does not block reads or other transactions.
 *
 * Returns a 400 response if a conflict is found; callers must return this
 * response to abort the update.
 */
async function checkCrossActivityMilestoneConflicts(
  currentActivityId: number,
  newMilestones: Array<Record<string, unknown>>,
): Promise<NextResponse | null> {
  const pool = getPostgresPool();

  // Serialise against concurrent config saves (advisory lock on a well-known key).
  // pg_advisory_xact_lock blocks only other sessions trying to acquire the same lock;
  // it does not block reads, writes, or other application logic.
  await pool.query(
    `SELECT pg_advisory_xact_lock(hashtext('activity-milestone-config'))`
  );

  // Collect all normalised IDs in the incoming request body
  const incomingNormalized = new Set<string>();
  for (const ms of newMilestones) {
    const norm = normalizeMilestoneId(ms.id);
    if (norm) incomingNormalized.add(norm);
  }
  if (incomingNormalized.size === 0) return null; // nothing to conflict with

  // Load all other activities' configs and scan for colliding IDs
  const allActivities = await listActivities();
  for (const act of allActivities) {
    if (act.id === currentActivityId) continue;
    const cfg = act.config as Record<string, unknown> | undefined;
    if (!cfg) continue;
    const milestones = cfg.milestones as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(milestones)) continue;
    for (const ms of milestones) {
      const norm = normalizeMilestoneId(ms.id);
      if (norm && incomingNormalized.has(norm)) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'DUPLICATE_MILESTONE_ID_CROSS_ACTIVITY',
              message: `里程碑 ID "${norm}" 已被活动 "${act.name}"（ID=${act.id}）使用，不能重复。`,
            },
          },
          { status: 400 }
        );
      }
    }
  }

  return null;
}

function validateUpdateBody(body: Record<string, unknown>): NextResponse | null {
  if (body.name !== undefined && (body.name as string).length > 50) {
    return NextResponse.json(
      { ok: false, error: { code: 'NAME_TOO_LONG', message: 'Activity name must be 50 characters or fewer' } },
      { status: 400 }
    );
  }
  if (body.type !== undefined && body.type !== 'LIVE2D' && body.type !== 'ENERGY') {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'type must be LIVE2D or ENERGY' } },
      { status: 400 }
    );
  }
  if (body.status !== undefined && body.status !== 'ENABLED' && body.status !== 'DISABLED') {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'status must be ENABLED or DISABLED' } },
      { status: 400 }
    );
  }
  if (body.start_time !== undefined && body.end_time !== undefined) {
    const start = parseUtc8(body.start_time as string);
    const end = parseUtc8(body.end_time as string);
    if (!Number.isNaN(start) && !Number.isNaN(end) && start >= end) {
      return NextResponse.json(
        { ok: false, error: { code: 'INVALID_TIME_RANGE', message: '开始时间必须早于结束时间' } },
        { status: 400 }
      );
    }
  }
  return null;
}

// ── PUT /api/admin/activity/update ──────────────────────────────────────────

export async function PUT(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  if (!body.id) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Activity id is required' } },
      { status: 400 }
    );
  }

  const validationError = validateUpdateBody(body);
  if (validationError) return validationError;
  const configError = validateConfig(body);
  if (configError) return configError;
  const itemsError = validateItems(body);
  if (itemsError) return itemsError;
  const milestonesError = validateMilestones(body);
  if (milestonesError) return milestonesError;

  // P1 (REPARK 7.0 2026-09): Cross-activity milestone ID uniqueness.
  // Must happen after milestone body parsing so milestones list is available.
  const currentActivityId = Number(body.id);
  const newMilestones = ((body.config as Record<string, unknown> | undefined)?.milestones as Array<Record<string, unknown>> | undefined) ?? [];
  const crossActivityError = await checkCrossActivityMilestoneConflicts(currentActivityId, newMilestones);
  if (crossActivityError) return crossActivityError;

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.type !== undefined) updates.type = body.type;
  if (body.start_time !== undefined) updates.start_time = body.start_time;
  if (body.end_time !== undefined) updates.end_time = body.end_time;
  if (body.status !== undefined) updates.status = body.status;

  if (body.config !== undefined) {
    const cfg = body.config as Record<string, unknown>;
    const boss = cfg.boss as Record<string, unknown> | undefined;
    const items = cfg.items as Record<string, unknown> | undefined;
    const milestones = cfg.milestones as Record<string, unknown>[] | undefined;
    const spine = cfg.spine as Record<string, unknown> | undefined;
    // REPARK 6.0 (2026-08-14): Persist the character_profile block written by
    // the admin form. We guard against totally malformed input — anything
    // that isn't an object is dropped silently.
    const characterProfile =
      cfg.character_profile && typeof cfg.character_profile === 'object'
        ? cfg.character_profile
        : undefined;
    // REPARK 7.0 Batch C (2026-08-28): Persist the customer-requested
    // 每日自动重置 toggle. Accept { enabled: boolean } or omit if missing.
    // We pass it through verbatim so the server-side helper
    // resolveEffectiveDailyTaskDate can mirror the operator's intent and
    // legacy activities without the field continue to default to ON.
    const dailyResetRaw = cfg.dailyReset;
    const dailyReset =
      dailyResetRaw && typeof dailyResetRaw === 'object'
        ? { enabled: Boolean((dailyResetRaw as Record<string, unknown>).enabled) }
        : undefined;
    updates.config = {
      isGlobalEnabled: cfg.isGlobalEnabled,
      rules: cfg.rules,
      boss: boss
        ? {
            totalHp: typeof boss.totalHp === 'number' ? boss.totalHp : Number(boss.totalHp),
            currentHp: typeof boss.currentHp === 'number' ? boss.currentHp : Number(boss.currentHp),
          }
        : undefined,
      items: items ?? undefined,
      milestones: milestones ?? undefined,
      spine: spine ?? undefined,
      ...(characterProfile ? { character_profile: characterProfile } : {}),
      ...(dailyReset ? { dailyReset } : {}),
    };
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'No fields to update' } },
      { status: 400 }
    );
  }

  const id = Number(body.id);

  try {
    const updated = await updateActivity(id, updates as Parameters<typeof updateActivity>[1]);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } },
        { status: 404 }
      );
    }

    // After saving boss HP, refresh BOTH Redis and PostgreSQL so the attack layer
    // AND the Dashboard stats page (which reads Postgres) see the same value.
    const savedBoss = (updates.config as Record<string, unknown> | undefined)?.boss as
      | Record<string, unknown>
      | undefined;
    if (savedBoss) {
      const hp = Number(savedBoss.currentHp ?? 0);
      const max = Number(savedBoss.totalHp ?? 0);
      try {
        await warmBossCacheFromDb(hp, max);     // Redis: {battle}:boss:hp + {battle}:boss:max_hp
      } catch (redisErr) {
        console.warn('[ADMIN/ACTIVITY] Redis warmup failed after config save:', redisErr);
      }
      try {
        await updateBossStatus(hp, max);        // Postgres: public.boss_status (fixes Dashboard drift)
      } catch (pgErr) {
        console.warn('[ADMIN/ACTIVITY] Postgres boss_status update failed:', pgErr);
      }
    }

    console.log('[ADMIN/ACTIVITY] Updated:', updated);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    console.error('[ADMIN/ACTIVITY] PUT error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'UPDATE_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 }
    );
  }
}

// ── DELETE /api/admin/activity/update?id=<n> ───────────────────────────────

export async function DELETE(req: Request) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get('id');

  if (!idParam || Number.isNaN(Number(idParam))) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Activity id (integer) is required as query param: ?id=',
        },
      },
      { status: 400 }
    );
  }

  const id = Number(idParam);

  try {
    const existing = await getActivityById(id);
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: 'Activity not found' } },
        { status: 404 }
      );
    }
    if (existing.status === 'ENABLED') {
      console.warn('[ADMIN/ACTIVITY] TC-AM-07: Attempted to delete ENABLED activity:', id);
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'ACTIVITY_ENABLED',
            message: 'Cannot delete an enabled activity. Disable it first.',
          },
        },
        { status: 409 }
      );
    }
    await deleteActivity(id);
    console.log('[ADMIN/ACTIVITY] Deleted:', id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[ADMIN/ACTIVITY] DELETE error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'DELETE_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 }
    );
  }
}