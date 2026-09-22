/**
 * POST /api/admin/badge/grant-direct — operator-initiated targeted badge grant.
 *
 * REPARK 7.0 (2026-09-12): P0 customer support tool.
 *
 * Use case: operator manually issues a specific badge to a specific user.
 * Reuses the existing grantBadge() pipeline (HMAC-signed POST to Main Station,
 * idempotent via stable request_id). NEVER bypasses the Main Station.
 *
 * Inputs (JSON body):
 *   - activityId:    number | undefined   (defaults to the active activity)
 *   - userIdentifier: string             (UUID | numeric master_long alias | email | nickname)
 *   - badgeId:       string              (decimal numeric string)
 *
 * Flow:
 *   1. requireAdminAuth
 *   2. resolve user → canonical UUID (must exist in public.users)
 *   3. resolve activity → must exist
 *   4. preview badge via getBadgeDetail() (validates existence + active status on Main Station)
 *   5. grantBadge({ userId, originalUserId, badgeId, activityId, requestId })
 *   6. write audit log row + console
 *   7. return result
 *
 * Idempotency: grantBadge() derives request_id = hash(userId, badgeId, activityId).
 * Re-posting the same triple within 24h yields the SAME request_id, and the
 * Main Station's INSERT IGNORE semantics ensure no duplicate grant is recorded.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { getActiveActivity, getActivityById } from '@/lib/db/pg';
import { getBadgeDetail, grantBadge } from '@/lib/services/badgeAdapter';
import { logAdminAction, getClientIp, getOperatorId } from '@/lib/auditLog';

interface RequestBody {
  activityId?:      number;
  userIdentifier?:  string;
  badgeId?:         string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_REGEX = /^\d+$/;

/**
 * Resolve a user identifier string to a canonical UUID.
 *
 *   numeric  → public.user_alias (alias_type='master_long').alias_value
 *   UUID     → public.users.id (exact)
 *   nickname → public.users.nickname (exact)
 *   email    → public.users.email   (exact)
 *
 * Returns null if no match. Returns the row data so callers can show the
 * operator who they actually granted to.
 */
async function resolveUser(
  identifier: string
): Promise<{ uuid: string; nickname: string | null; email: string | null; numericUid: string | null } | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const pool = getPostgresPool();

  let row: { uuid: string; nickname: string | null; email: string | null; numeric_uid: string | null } | null = null;

  if (NUMERIC_REGEX.test(trimmed)) {
    // Numeric → master_long alias lookup
    const res = await pool.query<{ uuid: string; nickname: string | null; email: string | null; numeric_uid: string | null }>(
      `SELECT u.id AS uuid,
              u.nickname,
              u.email,
              (SELECT alias_value FROM public.user_alias
                WHERE uuid = u.id AND alias_type = 'master_long' LIMIT 1) AS numeric_uid
         FROM public.users u
         JOIN public.user_alias ua ON ua.uuid = u.id
        WHERE ua.alias_type = 'master_long'
          AND ua.alias_value = $1
        LIMIT 1`,
      [trimmed]
    );
    row = res.rows[0] ?? null;
  } else if (UUID_REGEX.test(trimmed)) {
    const res = await pool.query<{ uuid: string; nickname: string | null; email: string | null; numeric_uid: string | null }>(
      `SELECT u.id AS uuid,
              u.nickname,
              u.email,
              (SELECT alias_value FROM public.user_alias
                WHERE uuid = u.id AND alias_type = 'master_long' LIMIT 1) AS numeric_uid
         FROM public.users u
        WHERE u.id = $1
        LIMIT 1`,
      [trimmed]
    );
    row = res.rows[0] ?? null;
  } else if (trimmed.includes('@')) {
    const res = await pool.query<{ uuid: string; nickname: string | null; email: string | null; numeric_uid: string | null }>(
      `SELECT u.id AS uuid,
              u.nickname,
              u.email,
              (SELECT alias_value FROM public.user_alias
                WHERE uuid = u.id AND alias_type = 'master_long' LIMIT 1) AS numeric_uid
         FROM public.users u
        WHERE u.email = $1
        LIMIT 1`,
      [trimmed]
    );
    row = res.rows[0] ?? null;
  } else {
    const res = await pool.query<{ uuid: string; nickname: string | null; email: string | null; numeric_uid: string | null }>(
      `SELECT u.id AS uuid,
              u.nickname,
              u.email,
              (SELECT alias_value FROM public.user_alias
                WHERE uuid = u.id AND alias_type = 'master_long' LIMIT 1) AS numeric_uid
         FROM public.users u
        WHERE u.nickname = $1
        LIMIT 1`,
      [trimmed]
    );
    row = res.rows[0] ?? null;
  }

  if (!row) return null;
  return {
    uuid:       row.uuid,
    nickname:   row.nickname,
    email:      row.email,
    numericUid: row.numeric_uid,
  };
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminAuth(req);
  if (authError) return authError;

  const operatorId = getOperatorId(req);
  const clientIp   = getClientIp(req);

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
      { status: 400 }
    );
  }

  const userIdentifier = (body.userIdentifier ?? '').trim();
  const badgeIdRaw     = (body.badgeId ?? '').trim();

  if (!userIdentifier) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_PARAM', message: 'userIdentifier is required' } },
      { status: 400 }
    );
  }
  if (!badgeIdRaw) {
    return NextResponse.json(
      { ok: false, error: { code: 'INVALID_PARAM', message: 'badgeId is required' } },
      { status: 400 }
    );
  }

  // ── Step 1: Resolve user ────────────────────────────────────────────────
  let resolvedUser: Awaited<ReturnType<typeof resolveUser>>;
  try {
    resolvedUser = await resolveUser(userIdentifier);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    logAdminAction({
      route: '/api/admin/badge/grant-direct',
      action: 'grant_direct_user_resolve_failed',
      operatorId,
      targetUserId: userIdentifier,
      clientIp,
      success: false,
      error: message,
    });
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: `用户查询失败：${message}` } },
      { status: 500 }
    );
  }
  if (!resolvedUser) {
    logAdminAction({
      route: '/api/admin/badge/grant-direct',
      action: 'grant_direct_user_not_found',
      operatorId,
      targetUserId: userIdentifier,
      clientIp,
      success: false,
      error: 'user not found',
      newValue: { badgeId: badgeIdRaw, activityId: body.activityId },
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: `未找到用户「${userIdentifier}」。请使用 UUID / 数字长 UID / 邮箱 / 昵称精确匹配。`,
        },
      },
      { status: 404 }
    );
  }

  // ── Step 2: Resolve activity ────────────────────────────────────────────
  let activityId: number;
  let activityName: string;
  try {
    const activity = typeof body.activityId === 'number'
      ? await getActivityById(body.activityId)
      : await getActiveActivity();
    if (!activity) {
      return NextResponse.json(
        { ok: false, error: { code: 'ACTIVITY_NOT_FOUND', message: '未指定 activityId 且当前无活动中的活动' } },
        { status: 404 }
      );
    }
    activityId   = activity.id;
    activityName = activity.name;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: `活动查询失败：${message}` } },
      { status: 500 }
    );
  }

  // ── Step 3: Preview badge from Main Station ─────────────────────────────
  // Validates existence + active status. Mirrors the admin UI preview flow.
  const preview = await getBadgeDetail(badgeIdRaw);
  if (!preview.ok) {
    logAdminAction({
      route: '/api/admin/badge/grant-direct',
      action: 'grant_direct_badge_preview_failed',
      operatorId,
      targetUserId: resolvedUser.uuid,
      clientIp,
      success: false,
      error: `${preview.reason}: ${preview.message}`,
      newValue: { badgeId: badgeIdRaw, activityId },
    });
    const statusCode =
      preview.reason === 'NETWORK_ERROR' || preview.reason === 'API_ERROR' ? 502 : 400;
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: preview.reason,
          message: `Badge 预览失败：${preview.message}`,
        },
      },
      { status: statusCode }
    );
  }

  // ── Step 4: Grant via existing pipeline (idempotent) ────────────────────
  const grantResult = await grantBadge({
    userId:         resolvedUser.uuid,
    originalUserId: resolvedUser.numericUid ?? resolvedUser.uuid,
    badgeId:        badgeIdRaw,
    activityId:     String(activityId),
  });

  if (!grantResult.ok) {
    logAdminAction({
      route: '/api/admin/badge/grant-direct',
      action: 'grant_direct_main_station_failed',
      operatorId,
      targetUserId: resolvedUser.uuid,
      clientIp,
      success: false,
      error: `${grantResult.reason}: ${grantResult.message}`,
      newValue: {
        badgeId: badgeIdRaw,
        activityId,
        badgeName: preview.data.name,
      },
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: grantResult.reason,
          message: grantResult.message,
        },
      },
      { status: 502 }
    );
  }

  // ── Step 5: Success audit log ───────────────────────────────────────────
  logAdminAction({
    route: '/api/admin/badge/grant-direct',
    action: 'grant_direct',
    operatorId,
    targetUserId: resolvedUser.uuid,
    clientIp,
    success: true,
    newValue: {
      activityId,
      activityName,
      badgeId: badgeIdRaw,
      badgeName: preview.data.name,
      requestId: grantResult.requestId,
      numericUid: resolvedUser.numericUid,
      nickname: resolvedUser.nickname,
    },
  });

  return NextResponse.json({
    ok: true,
    data: {
      activityId,
      activityName,
      user: {
        uuid:       resolvedUser.uuid,
        numericUid: resolvedUser.numericUid,
        nickname:   resolvedUser.nickname,
        email:      resolvedUser.email,
      },
      badge: {
        id:     String(preview.data.badge_id),
        name:   preview.data.name,
        icon:   preview.data.icon,
        status: preview.data.status,
      },
      requestId: grantResult.requestId,
    },
  });
}
