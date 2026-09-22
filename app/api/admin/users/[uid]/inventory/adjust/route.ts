/**
 * POST /api/admin/users/[uid]/inventory/adjust
 *
 * Adjusts a single prop count for a user within a specific activity context.
 * Records an audit log entry with the reason field.
 *
 * Body:
 *   {
 *     activityId: number,
 *     propType: 'prop_a' | 'prop_b',
 *     newCount: number,       // integer >= 0
 *     reason: string           // required, human-readable justification
 *   }
 *
 * Security: requireAdminAuth via HMAC cookie (see app/lib/adminAuth.ts).
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { resolveAliasToUuid, getActivityInventory, adjustActivityInventory } from '@/lib/db/pg';
import { logAdminAction, getClientIp, getOperatorId } from '@/lib/auditLog';
import { z } from 'zod';
import { env } from '@/lib/env';
import { hasActivityItems } from '@/app/lib/activityItems';

// Normalise field names before Zod parsing so the schema stays strict.
// P0 2026-08-21: relax field names to accept propType/prop_type/type/itemType
// and count/amount/newCount, reason defaulting to '管理员调整' if omitted.
function normaliseBody(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };

  // propType aliases → propType
  if (out.propType === undefined && out.prop_type !== undefined) out.propType = out.prop_type;
  if (out.propType === undefined && out.type !== undefined) out.propType = out.type;
  if (out.propType === undefined && out.itemType !== undefined) out.propType = out.itemType;

  // count aliases → newCount
  if (out.newCount === undefined && out.count !== undefined) out.newCount = out.count;
  if (out.newCount === undefined && out.amount !== undefined) out.newCount = out.amount;

  // reason default
  if ((out.reason === undefined || String(out.reason).trim() === '') && out.reason !== 0) {
    out.reason = '管理员调整';
  }

  return out;
}

const BodySchema = z.object({
  activityId: z.number().int().positive(),
  propType: z.enum(['prop_a', 'prop_b']),
  newCount: z.number().int().min(0),
  reason: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ uid: string }> }
) {
  const authError = await requireAdminAuth(req as any);
  if (authError) return authError;

  const { uid: uidParam } = await params;

  // Resolve the UID param to canonical UUID
  let userId: string;
  try {
    userId = await resolveAliasToUuid(uidParam);
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'NOT_FOUND', message: `Cannot resolve user: ${uidParam}` } },
      { status: 404 }
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const raw = normaliseBody(await req.json());
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

  const { activityId, propType, newCount, reason } = body;
  const column = propType === 'prop_a' ? 'item_hand_count' : 'item_phallus_count';
  const operatorId = getOperatorId(req);
  const ip = getClientIp(req);

  // Safety ceiling — configurable via env
  const maxPerType = Number(env.adminInventoryMaxPerType() ?? 999_999);

  if (newCount > maxPerType) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'OUT_OF_RANGE',
          message: `newCount ${newCount} exceeds max ${maxPerType}`,
        },
      },
      { status: 400 }
    );
  }

  const pool = getPostgresPool();

  // REPARK 7.0 (2026-09-18) ISSUE 2 — defence-in-depth: refuse direct POST
  // even if the admin UI hides the prop-management block for activities
  // without config.items. Body.activityId is the activity the operator
  // claims to be adjusting; we read that specific activity's config fresh
  // and reject if it doesn't declare items. Prevents curl-based bypass and
  // stale-client writes. ONE additional SELECT per request (indexed by PK,
  // no new index needed). NO user_inventory mutation on this branch.
  let actCfg: Record<string, unknown> | null = null;
  let actExists = false;
  try {
    const cfgResult = await pool.query<{ config: Record<string, unknown> | null }>(
      `SELECT config FROM public.activities WHERE id = $1 LIMIT 1`,
      [activityId],
    );
    const cfgRow = cfgResult.rows[0];
    actExists = cfgRow !== undefined;
    actCfg = (cfgRow?.config ?? null) as Record<string, unknown> | null;
  } catch (cfgErr) {
    // Reading the activity config is non-critical to data integrity — if
    // we can't read it, we still reject conservatively (better to refuse
    // a legitimate adjust than to silently mutate a row the activity does
    // not own). Audit failure must NOT mask the primary error response.
    console.warn('[ADMIN:INVENTORY:ADJUST] activity config read failed:', cfgErr);
  }
  if (!actExists || !hasActivityItems(actCfg)) {
    // Best-effort audit log — non-fatal if it fails. We must always return
    // the structured 400 to the caller regardless of audit outcome.
    try {
      logAdminAction({
        route: '/api/admin/users/inventory/adjust',
        action: 'adjust_inventory_rejected',
        operatorId,
        targetUserId: userId,
        clientIp: ip,
        success: false,
        fieldName: column,
        newValue: newCount,
      });
    } catch (auditErr) {
      console.warn('[ADMIN:INVENTORY:ADJUST] audit log failed (rejection still returned):', auditErr);
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'ITEM_NOT_SUPPORTED',
          message: '当前活动未配置道具，无法调整',
        },
      },
      { status: 400 },
    );
  }

  try {
    // Fetch prior value for audit delta from the activity-scoped table.
    // Tolerate the row not yet existing (priorCount = 0).
    const priorInv = await getActivityInventory(userId, activityId);
    const itemType = propType === 'prop_a' ? 'item_hand' : 'item_phallus';
    const priorCount = itemType === 'item_hand'
      ? (priorInv?.item_hand_count ?? 0)
      : (priorInv?.item_phallus_count ?? 0);

    // REPARK 7.0 (2026-09-22): Activity-scoped upsert.
    // Writes to user_activity_inventory(user, activityId) — NOT global user_inventory.
    // adjustActivityInventory handles the ensure + UPDATE atomically.
    await adjustActivityInventory(userId, activityId, itemType, newCount);

    logAdminAction({
      route: '/api/admin/users/inventory/adjust',
      action: 'adjust_inventory',
      operatorId,
      targetUserId: userId,
      clientIp: ip,
      success: true,
      fieldName: column,
      oldValue: priorCount,
      newValue: newCount,
    });

    // Persist reason in a dedicated audit detail table if available, otherwise log to console
    try {
      await pool.query(
        `INSERT INTO public.admin_action_log
           (target_user_id, action_type, reason, old_value, new_value, operator_id)
         VALUES ($1, 'inventory_adjust', $2, $3, $4, $5)`,
        [userId, reason, String(priorCount), String(newCount), operatorId]
      );
    } catch {
      console.warn('[ADMIN:INVENTORY:ADJUST] admin_action_log table not available, reason:', reason);
    }

    return NextResponse.json({
      ok: true,
      data: {
        userId,
        activityId,
        propType,
        priorCount,
        newCount,
        reason,
      },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[InventoryAdjust 500 ERROR]:', { userId, activityId, propType, newCount, reason, detail });
    return NextResponse.json(
      { ok: false, error: { code: 'DATABASE_ERROR', message: detail } },
      { status: 500 }
    );
  }
}
