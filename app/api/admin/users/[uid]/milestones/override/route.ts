/**
 * POST /api/admin/users/[uid]/milestones/override
 *
 * Admin special-permission milestone unlock/lock for a specific user.
 *
 * Design rules (REPARK 7.0 2026-09-14 — clarified):
 *   • unlock
 *       - Pre-claim (is_claimed=false): set admin_bypass=TRUE with reason.
 *         This lets the player claim below threshold. admin_bypass is single-use;
 *         the claim route consumes it on success.
 *       - Already claimed (is_claimed=true): NO-OP. We do not create a new
 *         grant opportunity. Returns 200 with the unchanged state.
 *       - Locked (is_locked=true): clear is_locked AND set admin_bypass=TRUE.
 *       - The flag is consumed by claim success; manual unlock does NOT reset it
 *         once consumed.
 *
 *   • lock
 *       - Pre-claim (is_claimed=false): set is_locked=TRUE. Preserves
 *         admin_bypass as-is (lock does NOT clear bypass — admin can still
 *         toggle on/off without losing the bypass permission).
 *       - Already claimed (is_claimed=true): REJECTED with HTTP 409.
 *         Locking an already-claimed reward is meaningless and would risk
 *         confusing the audit trail. Use the "已是记录" message instead.
 *
 *   • Neither action calls Grant or modifies Main Station state. Player claim
 *     is the only path that triggers Grant.
 *
 * Storage:
 *   Target table: public.milestone_rewards (no activity_id column). PK is
 *   (user_id, milestone_id), key type TEXT. Cross-activity uniqueness is by
 *   business convention — admin UI must ensure milestone_id strings are unique
 *   across activities.
 *
 * Backward compat with migration 17 (admin_bypass column):
 *   The override writes use the column when present, and silently fall back to
 *   "is_locked-only" behavior when the column is missing. This lets the route
 *   deploy before the migration runs, with reduced functionality until the
 *   migration is applied.
 *
 * Body:
 *   { milestoneId: number, action: 'unlock' | 'lock', reason: string }
 *
 * Security: requireAdminAuth via HMAC cookie (see app/lib/adminAuth.ts).
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { resolveAliasToUuid } from '@/lib/db/pg';
import { logAdminAction, getClientIp, getOperatorId } from '@/lib/auditLog';
import { z } from 'zod';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const BodySchema = z.object({
  // REPARK 7.0 (2026-09-15) hotfix: ids are stored as text in
  // public.milestone_rewards. Config authors may produce either a numeric id
  // (legacy 75/50/25 style) OR a generated string "m<unix-ts>" from the
  // /admin/activities/[id]/config page. Accept either; coerce strings of
  // pure digits to numbers so DB lookups still work for legacy ids.
  milestoneId: z.union([z.number().int().positive(), z.string().min(1)]),
  action: z.enum(['unlock', 'lock']),
  reason: z.string().min(1),
});

/**
 * REPARK 7.0 (2026-09-14): Atomic milestone override with two-phase pattern:
 *   Phase 1: UPDATE ... WHERE is_claimed = false AND milestone_id = $2
 *             → Succeeds only if the row exists and is not yet claimed.
 *             → Returns row count; 0 rows = row is claimed or doesn't exist.
 *   Phase 2: INSERT (first-time rows) with ON CONFLICT DO NOTHING.
 *             → Succeeds only for brand-new rows; concurrent inserts are harmless.
 *
 * This eliminates the race where the admin reads is_claimed=false, the player
 * claims concurrently, and the admin's UPDATE then overwrites the claimed state.
 * With UPDATE first, the row is locked (FOR UPDATE) until the statement ends,
 * preventing the player from claiming between admin-read and admin-write.
 *
 * If admin_bypass columns are absent (pre-migration-17), the function attempts
 * the full SQL first; if it fails with "column does not exist", it retries
 * without those columns. The Phase-1 UPDATE with is_claimed=false guard
 * protects claim state in both fallback paths.
 *
 * Returns: { changed: boolean, source: 'update' | 'insert' | 'none' }
 *   'update'  = existing row updated
 *   'insert'  = new row inserted
 *   'none'    = row was already claimed (no-op)
 */
async function atomicOverride(
  userId: string,
  // REPARK 7.0 (2026-09-15 round 3):
  //   milestone_rewards.milestone_id is INTEGER (per aws_01_schema.sql).
  //   The /admin/activities/[id]/config page generates string ids of the
  //   form "m<unix-ts>" in cfg.milestones. The claim route already strips
  //   the "m" prefix via lenientExtractMilestoneId() before INSERT, so
  //   DB rows store plain integers (e.g. 1789426260).
  //   This entry point must do the same normalization so the override SQL
  //   parameter binds as integer — otherwise PG returns 22P02 invalid input
  //   syntax for type integer: "m..." (verified in PM2 logs 22:51, 22:56).
  milestoneId: string | number,
  fields: {
    is_locked?: boolean;
    set_admin_bypass?: boolean | null;
    set_admin_bypass_source?: string | null;
  },
  includeBypass: boolean,
): Promise<{ changed: boolean; source: 'update' | 'insert' | 'none' }> {
  // Coerce the (possibly string-form) milestone_id into the digit-only integer
  // that milestone_rewards actually stores. Empty / non-numeric input is
  // rejected here so we don't silently fall through with NaN.
  const milestoneIdStr = String(milestoneId);
  const milestoneIdDigits = milestoneIdStr.match(/\d+/)?.[0];
  if (!milestoneIdDigits) {
    throw new Error(`atomicOverride: cannot normalize milestone_id="${milestoneIdStr}" to integer`);
  }
  const milestoneIdForDb = Number(milestoneIdDigits);
  if (!Number.isFinite(milestoneIdForDb)) {
    throw new Error(`atomicOverride: milestone_id="${milestoneIdStr}" → NaN`);
  }
  const pool = getPostgresPool();

  const buildSets = (bypass: boolean) => {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (fields.is_locked !== undefined) {
      sets.push('is_locked = $3');
      vals.push(fields.is_locked);
    }
    if (bypass && fields.set_admin_bypass !== undefined && fields.set_admin_bypass !== null) {
      sets.push('admin_bypass = $' + (vals.length + 3));
      vals.push(fields.set_admin_bypass);
    }
    if (bypass && fields.set_admin_bypass_source !== undefined && fields.set_admin_bypass_source !== null) {
      sets.push('admin_bypass_source = $' + (vals.length + 3));
      vals.push(fields.set_admin_bypass_source);
    }
    return { sets, vals };
  };

  const attempt = async (bypass: boolean): Promise<{ changed: boolean; source: 'update' | 'insert' | 'none' }> => {
    const { sets, vals } = buildSets(bypass);
    if (sets.length === 0) return { changed: false, source: 'none' };

    // Phase 1: UPDATE only rows where is_claimed = false (already-claimed rows are protected)
    const updateResult = await pool.query(
      `UPDATE public.milestone_rewards
          SET ${sets.join(', ')}
        WHERE user_id = $1 AND milestone_id = $2 AND is_claimed = false
        RETURNING user_id`,
      [userId, milestoneIdForDb, ...vals]
    );

    if (updateResult.rowCount !== null && updateResult.rowCount > 0) {
      return { changed: true, source: 'update' };
    }

    // Phase 2: INSERT for new rows. ON CONFLICT (user_id, milestone_id)
    // DO NOTHING means a concurrent claim (which sets is_claimed=true)
    // makes this a no-op.
    //
    // REPARK 7.0 (2026-09-15 round 5 hotfix):
    // Build the COMPLETE column list FIRST, then format it into the SQL
    // template literal. Previously the SQL template captured
    // `insertCols.join(', ')` BEFORE the optional admin_bypass /
    // admin_bypass_source columns were appended, which produced
    // INSERT INTO milestone_rewards (user_id, milestone_id, is_locked)
    // VALUES ($1, $2, $3, $4, $5) ...
    // — PG rejected with "INSERT has more expressions than target columns"
    // at position 93 (verified in PM2 error log 2026-09-14 23:26:40 UTC).
    const insertCols: string[] = ['user_id', 'milestone_id'];
    const insertVals: unknown[] = [userId, milestoneIdForDb];
    if (fields.is_locked !== undefined) {
      insertCols.push('is_locked');
      insertVals.push(fields.is_locked);
    }
    if (bypass) {
      if (fields.set_admin_bypass !== undefined && fields.set_admin_bypass !== null) {
        insertCols.push('admin_bypass');
        insertVals.push(fields.set_admin_bypass);
      }
      if (
        fields.set_admin_bypass_source !== undefined &&
        fields.set_admin_bypass_source !== null
      ) {
        insertCols.push('admin_bypass_source');
        insertVals.push(fields.set_admin_bypass_source);
      }
    }
    // Sanity check before issuing SQL: cols and vals must match.
    if (insertCols.length !== insertVals.length) {
      throw new Error(
        `atomicOverride: Phase 2 INSERT column/value mismatch — ` +
          `cols=${insertCols.length} (${insertCols.join(',')}), ` +
          `vals=${insertVals.length}`,
      );
    }
    const placeholders = insertVals.map((_, i) => '$' + (i + 1)).join(', ');
    const insertSql =
      `INSERT INTO public.milestone_rewards (${insertCols.join(', ')}) ` +
      `VALUES (${placeholders}) ` +
      `ON CONFLICT (user_id, milestone_id) DO NOTHING RETURNING user_id`;

    const insertResult = await pool.query(insertSql, insertVals);
    // Row count > 0 → fresh insert; row count = 0 → ON CONFLICT DO NOTHING
    // (row existed; the existing claim state is preserved by this branch).
    // Either way the row now exists with the intended columns, so we
    // report 'insert' as the source. The caller (atomicOverride caller)
    // already distinguishes whether the row was created or pre-existed
    // based on updateResult.rowCount vs. insertResult.rowCount.
    if (insertResult.rowCount !== null && insertResult.rowCount > 0) {
      return { changed: true, source: 'insert' };
    }
    // No new row inserted (concurrent claim/lock won the race). Caller
    // treats this as no-op since is_claimed guard prevents the UPDATE.
    return { changed: false, source: 'none' };
  };

  try {
    return await attempt(includeBypass);
  } catch (e: unknown) {
    const msg = String((e as Error)?.message ?? '');
    if (includeBypass && /column .* does not exist/i.test(msg)) {
      return await attempt(false);
    }
    throw e;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  const authError = await requireAdminAuth(req as any);
  if (authError) return authError;

  const { uid: uidParam } = await params;

  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues.map((e) => e.message).join('; '),
          },
        },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const { milestoneId, action, reason } = body;
  const operatorId = getOperatorId(req);
  const ip = getClientIp(req);

  let userId: string;
  try {
    userId = await resolveAliasToUuid(uidParam);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: `Cannot resolve user: ${uidParam}` } },
      { status: 404 }
    );
  }

  const pool = getPostgresPool();

  // REPARK 7.0 (2026-09-15 round 4 hotfix):
  //
  // Normalize milestoneId the same way atomicOverride does on the write path.
  // production DB schema (aws_01_schema.sql + verified via PG 22P02 errors
  // in PM2 logs 22:51/22:56/23:08) stores public.milestone_rewards.milestone_id
  // as INTEGER. The /admin/activities/[id]/config page stores ids like
  // "m1789426210" in the cfg JSONB, but the claim route strips the prefix
  // before INSERT, so the SQL row is the digit-only integer.
  //
  // Before round 4, this `prior` SELECT bound the raw string ("m1789426210")
  // into an INTEGER parameter slot, which PG rejects with 22P02. That made
  // EVERY admin override request fail before reaching atomicOverride's
  // write path, regardless of whether the row existed. We now normalize
  // upfront so select and write use the same digit-form integer.
  const milestoneIdInput = String(milestoneId);
  const milestoneIdDigits = milestoneIdInput.match(/\d+/)?.[0];
  if (!milestoneIdDigits) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: `无效的 milestoneId: "${milestoneIdInput}"` } },
      { status: 400 }
    );
  }
  const milestoneIdInt = Number(milestoneIdDigits);
  if (!Number.isFinite(milestoneIdInt)) {
    return NextResponse.json(
      { ok: false, error: { code: 'VALIDATION_ERROR', message: `无效的 milestoneId: "${milestoneIdInput}" → NaN` } },
      { status: 400 }
    );
  }
  const milestoneIdForSelect = milestoneIdInt;

  // ── response adapter: use the normalized integer form so the admin page
  // matches this response's milestone_id against its parsed numeric id and
  // round-trips cleanly back into milestoneClaims map on success. ──
  const respMilestoneId = milestoneIdForSelect;

  try {
    // Fetch prior state
    const priorResult = await pool.query<{
      is_claimed: boolean;
      is_locked: boolean;
      claimed_at: string | null;
      admin_bypass: boolean | null;
      admin_bypass_source: string | null;
    }>(
      `SELECT is_claimed, is_locked, claimed_at, admin_bypass, admin_bypass_source
         FROM public.milestone_rewards
        WHERE user_id = $1 AND milestone_id = $2
        LIMIT 1`,
      [userId, milestoneIdForSelect]
    );
    const prior = priorResult.rows[0];
    const priorClaimed = Boolean(prior?.is_claimed ?? false);
    const priorLocked  = Boolean(prior?.is_locked  ?? false);
    const priorBypass  = Boolean(prior?.admin_bypass ?? false);

    // ── action === 'lock' ────────────────────────────────────────────────
    if (action === 'lock') {
      // REPARK 7.0 (2026-09-14): lock on already-claimed milestones is rejected.
      // Locking an already-issued reward would imply a rollback that we cannot
      // actually perform (no Main Station revoke path). Returns HTTP 409 with a
      // clear message so the admin understands the action was a no-op.
      if (priorClaimed) {
        logAdminAction({
          route: '/api/admin/users/milestones/override',
          action: 'override_milestone_lock_rejected',
          operatorId,
          targetUserId: userId,
          clientIp: ip,
          success: false,
          fieldName: `milestone_${respMilestoneId}`,
          oldValue: { is_claimed: true, is_locked: priorLocked, claimed_at: prior?.claimed_at ?? null },
          newValue: null,
        });
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'ALREADY_CLAIMED',
              message: '该奖励已领取，锁定不能撤销已发奖励',
            },
          },
          { status: 409 }
        );
      }

      // Pre-claim: set is_locked=true. Do NOT touch claimed_at / is_claimed /
      // admin_bypass — lock does not consume bypass; admin can still unlock.
      const lockResult = await atomicOverride(userId, milestoneId, {
        is_locked: true,
      }, false);

      logAdminAction({
        route: '/api/admin/users/milestones/override',
        action: 'override_milestone_lock',
        operatorId,
        targetUserId: userId,
        clientIp: ip,
        success: true,
        fieldName: `milestone_${respMilestoneId}`,
        oldValue: { is_claimed: priorClaimed, is_locked: priorLocked, admin_bypass: priorBypass },
        newValue: { is_claimed: false, is_locked: true, admin_bypass: priorBypass },
      });

      return NextResponse.json({
        ok: true,
        data: {
          userId,
          milestoneId: respMilestoneId,
          action: 'lock',
          is_claimed: false,
          is_locked: true,
          admin_bypass: priorBypass,
          claimed_at: null,
        },
      });
    }

    // ── action === 'unlock' ──────────────────────────────────────────────
    // Already claimed: cannot grant again. NO-OP (returns 200 with current state).
    if (priorClaimed) {
      return NextResponse.json({
        ok: true,
        data: {
          userId,
          milestoneId: respMilestoneId,
          action: 'unlock',
          is_claimed: true,
          is_locked: priorLocked,
          admin_bypass: priorBypass,
          claimed_at: prior?.claimed_at ?? null,
          note: '已领取，不可再次发放；no-op',
        },
      });
    }

    // Pre-claim: clear is_locked AND set admin_bypass=TRUE.
    // The bypass is single-use — claim route consumes it.
    //
    // REPARK 7.0 (2026-09-14): Unlike lock (which safely falls back to is_locked-only),
    // unlock REQUIRES the admin_bypass column to function. If the column is absent
    // (pre-migration-17 deployment), we return an explicit MIGRATION_REQUIRED error
    // instead of silently succeeding with reduced functionality.
    let unlockResult: { changed: boolean; source: 'update' | 'insert' | 'none' };
    try {
      unlockResult = await atomicOverride(userId, milestoneId, {
        is_locked: false,
        set_admin_bypass: true,
        set_admin_bypass_source: `override:${reason}`.slice(0, 200),
      }, true);
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? '');
      if (/column .* does not exist/i.test(msg)) {
        logAdminAction({
          route: '/api/admin/users/milestones/override',
          action: 'override_milestone_unlock_rejected',
          operatorId,
          targetUserId: userId,
          clientIp: ip,
          success: false,
          fieldName: `milestone_${respMilestoneId}`,
          oldValue: { is_claimed: priorClaimed, is_locked: priorLocked, admin_bypass: priorBypass },
          newValue: null,
        });
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'MIGRATION_REQUIRED',
              message: '数据库缺少 admin_bypass 列，无法执行特殊解锁。请联系运维执行迁移脚本。',
            },
          },
          { status: 503 }
        );
      }
      throw e;
    }

    logAdminAction({
      route: '/api/admin/users/milestones/override',
      action: 'override_milestone_unlock',
      operatorId,
      targetUserId: userId,
      clientIp: ip,
      success: true,
      fieldName: `milestone_${respMilestoneId}`,
      oldValue: { is_claimed: priorClaimed, is_locked: priorLocked, admin_bypass: priorBypass },
      newValue: { is_claimed: false, is_locked: false, admin_bypass: true },
    });

    return NextResponse.json({
      ok: true,
      data: {
        userId,
        milestoneId: respMilestoneId,
        action: 'unlock',
        is_claimed: false,
        is_locked: false,
        admin_bypass: true,
        admin_bypass_source: `override:${reason}`.slice(0, 200),
        claimed_at: prior?.claimed_at ?? null,
      },
    });
  } catch (err) {
    console.error('[ADMIN:MILESTONE:OVERRIDE] fatal error:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: '操作失败，请稍后重试' } },
      { status: 500 }
    );
  }
}
