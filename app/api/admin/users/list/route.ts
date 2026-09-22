/**
 * GET /api/admin/users/list
 *
 * Dead-simple query against public.users only.
 * Numeric uid comes from a scalar subquery (SELECT ... LIMIT 1) — safe even
 * when user_alias is absent.
 *
 * Search behaviour:
 *   - Pure numeric query (e.g. "84"): exact match against
 *     public.user_alias.alias_value WHERE alias_type = 'master_long'.
 *     Returns only the canonical user whose long UID equals the query.
 *     No fuzzy, no ILIKE, no fallthrough.
 *   - Non-numeric query: ILIKE across UUID / email / nickname (existing behaviour).
 *
 * user_inventory enrichment is wrapped in its own try-catch (optional table).
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';

// Matches a query that consists entirely of digits — a pure numeric long UID.
const NUMERIC_QUERY_REGEX = /^\d+$/;

interface UserRow {
  id: string;
  numeric_uid: string | null;
  nickname: string | null;
  email: string | null;
  avatar: string | null;
  created_at: string | null;
}

export async function GET(req: Request) {
  const authError = await requireAdminAuth(req as any);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const q        = searchParams.get('q')?.trim() ?? '';
  const page      = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize  = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '30')));
  const offset    = (page - 1) * pageSize;

  const pool = getPostgresPool();

  // ── Enrich with inventory (optional table) ────────────────────────────
  let inventoryMap: Record<string, { propA: number; propB: number; totalDamage: number; updatedAt: string | null }> = {};

  try {
    const invResult = await pool.query<{
      user_id: string; item_hand_count: number;
      item_phallus_count: number; total_damage_dealt: number;
      updated_at: string | null;
    }>(
      `SELECT user_id, item_hand_count, item_phallus_count, total_damage_dealt, updated_at
         FROM public.user_inventory`
    );
    for (const row of invResult.rows) {
      inventoryMap[row.user_id] = {
        propA:       Number(row.item_hand_count ?? 0),
        propB:       Number(row.item_phallus_count ?? 0),
        totalDamage: Number(row.total_damage_dealt ?? 0),
        updatedAt:   row.updated_at ?? null,
      };
    }
  } catch {
    // user_inventory absent — inventoryMap stays empty
  }

  function buildUser(row: UserRow) {
    const inv = inventoryMap[row.id];
    return {
      id:        row.id,
      uid:       row.numeric_uid ?? null,
      nickname:  row.nickname ?? '',
      email:     row.email ?? '',
      avatar:    row.avatar ?? '👤',
      createdAt: row.created_at ?? null,
      inventory: {
        propA:       inv?.propA ?? 0,
        propB:       inv?.propB ?? 0,
        totalDamage: inv?.totalDamage ?? 0,
      },
      lastLogin: inv?.updatedAt ?? row.created_at ?? null,
    };
  }

  try {
    if (q) {
      // ── Pure numeric query: exact master_long alias match ─────────────
      // #83 contract: "84" means the user whose long UID is exactly 84,
      // not any user whose UUID/nickname/email happens to contain "84".
      if (NUMERIC_QUERY_REGEX.test(q)) {
        const listResult = await pool.query<UserRow>(
          `SELECT u.id,
                  (SELECT alias_value FROM public.user_alias
                     WHERE uuid = u.id AND alias_type = 'master_long' LIMIT 1) AS numeric_uid,
                  u.nickname,
                  u.email,
                  u.avatar,
                  u.created_at
             FROM public.users u
           WHERE EXISTS (
             SELECT 1 FROM public.user_alias ua
              WHERE ua.uuid = u.id
                AND ua.alias_type = 'master_long'
                AND ua.alias_value = $1
           )
           ORDER BY u.created_at DESC NULLS LAST
           LIMIT $2 OFFSET $3`,
          [q, pageSize, offset]
        );

        const countResult = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM public.users u
            WHERE EXISTS (
              SELECT 1 FROM public.user_alias ua
               WHERE ua.uuid = u.id
                 AND ua.alias_type = 'master_long'
                 AND ua.alias_value = $1
            )`,
          [q]
        );
        const total = Number(countResult.rows[0]?.count ?? 0);

        return NextResponse.json({
          ok: true,
          data: {
            users:      listResult.rows.map(buildUser),
            pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
          },
        });
      }

      // ── Non-numeric query: ILIKE across uuid/email/nickname ───────────
      const term = `%${q}%`;
      // Scalar subquery for alias_value: table absent → NULL → ILIKE never matches
      const listResult = await pool.query<UserRow>(
        `SELECT u.id,
                (SELECT alias_value FROM public.user_alias
                   WHERE uuid = u.id AND alias_type = 'master_long' LIMIT 1) AS numeric_uid,
                u.nickname,
                u.email,
                u.avatar,
                u.created_at
           FROM public.users u
         WHERE u.id::text ILIKE $1 OR u.email ILIKE $1 OR u.nickname ILIKE $1
         ORDER BY u.created_at DESC NULLS LAST
         LIMIT $2 OFFSET $3`,
        [term, pageSize, offset]
      );

      const countResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.users u
          WHERE u.id::text ILIKE $1 OR u.email ILIKE $1 OR u.nickname ILIKE $1`,
        [term]
      );
      const total = Number(countResult.rows[0]?.count ?? 0);

      return NextResponse.json({
        ok: true,
        data: {
          users:      listResult.rows.map(buildUser),
          pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
        },
      });
    }

    // ── No search term: simple query ──────────────────────────────────
    const listResult = await pool.query<UserRow>(
      `SELECT u.id,
              (SELECT alias_value FROM public.user_alias
                 WHERE uuid = u.id AND alias_type = 'master_long' LIMIT 1) AS numeric_uid,
              u.nickname,
              u.email,
              u.avatar,
              u.created_at
         FROM public.users u
       ORDER BY u.created_at DESC NULLS LAST
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.users u`
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    return NextResponse.json({
      ok: true,
      data: {
        users:      listResult.rows.map(buildUser),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    });
  } catch (err) {
    console.error('[ADMIN:USERS:LIST] error:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load user list' } },
      { status: 500 }
    );
  }
}
