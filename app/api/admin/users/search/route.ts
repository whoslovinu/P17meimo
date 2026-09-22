/**
 * GET /api/admin/users/search?query=[uid|uuid|email|nickname fragment]
 *
 * Fuzzy search across:
 *   - users.id (UUID — partial match, e.g. "baa8" matches "baa88a9e-..." )
 *   - users.email
 *   - users.nickname
 *
 * Numeric UID contract (#84):
 *   - Pure numeric query (e.g. "84"): exact match against
 *     public.user_alias.alias_value WHERE alias_type = 'master_long'.
 *     If no such alias exists, returns NOT_FOUND immediately.
 *     The query does NOT fall through to email / nickname / fuzzy matching.
 *
 * Non-numeric query behaviour is unchanged.
 *
 * Returns:
 *   - User profile (includes uid + uuid)
 *   - Inventory snapshot
 *   - All activities
 *   - Milestone claim states
 *
 * Robust: never 500 for non-existent users.
 */

import { NextResponse } from 'next/server';
import { requireAdminAuth } from '@/app/lib/adminAuth';
import { getPostgresPool } from '@/lib/db/postgres';
import { logAdminAction, getClientIp } from '@/lib/auditLog';
import { attachBadgeNames } from '@/lib/badgeNameCache';
import { hasActivityItems } from '@/app/lib/activityItems';

/**
 * Resolve any query string to a canonical user UUID.
 *
 * Priority for non-numeric inputs (unchanged):
 *   exact UUID → exact numeric alias → exact email → exact nickname →
 *   partial nickname → partial email
 *
 * Priority for pure numeric inputs (#84 fix):
 *   exact master_long alias ONLY. Miss → NOT_FOUND.
 *   No fuzzy fallthrough.
 *
 * Returns null if no user matches.
 */

// Full-length UUID regex — matches 8-4-4-4-12 hex with optional dash-prefixed variant (u-XXXXXXXX...)
const UUID_FULL_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Matches a query that consists entirely of digits — a pure numeric long UID.
// Such queries are treated as exact alias lookups ONLY (#84 contract).
const NUMERIC_QUERY_REGEX = /^\d+$/;

async function fuzzyResolveUserId(query: string): Promise<string | null> {
  const pool = getPostgresPool();
  const trimmed = query.trim();
  if (!trimmed) return null;

  // ── Pure numeric query: exact master_long alias only ─────────────────
  // #84 contract: "84" must mean the user whose long UID is exactly 84.
  // If that alias does not exist, return NOT_FOUND immediately.
  // No fuzzy fallthrough to nickname / email / UUID.
  if (NUMERIC_QUERY_REGEX.test(trimmed)) {
    try {
      const byUid = await pool.query<{ uuid: string }>(
        `SELECT uuid FROM public.user_alias
           WHERE alias_type = 'master_long'
             AND alias_value = $1
         LIMIT 1`,
        [trimmed]
      );
      if (byUid.rows.length > 0) {
        const verified = await pool.query<{ id: string }>(
          `SELECT id FROM public.users WHERE id = $1 LIMIT 1`,
          [byUid.rows[0].uuid]
        );
        if (verified.rows.length > 0) return verified.rows[0].id;
      }
      // Alias not found — return NOT_FOUND immediately.
      // Do NOT fall through to email/nickname/fuzzy resolution.
      return null;
    } catch (err) {
      // DB error on the numeric alias lookup — propagate to the outer
      // route handler. A DB failure must NEVER be re-interpreted as
      // NOT_FOUND, and a numeric UID query must NEVER cause a fuzzy
      // fallback. The outer catch routes unexpected errors to
      // INTERNAL_ERROR / HTTP 500 (the existing fatal-error path).
      throw err;
    }
  }

  // ── Non-numeric: existing resolver behaviour (unchanged) ───────────

  // 0. EXACT UUID — use equality, never ILIKE, for complete UUID inputs.
  //    This prevents "u-00000000-0000-0001" from matching "%0000%" in the list API.
  //    Also handles legacy dash-prefixed format like "u-00000000-0000-0001".
  if (UUID_FULL_REGEX.test(trimmed)) {
    try {
      const exact = await pool.query<{ id: string }>(
        `SELECT id FROM public.users WHERE id = $1 LIMIT 1`,
        [trimmed]
      );
      if (exact.rows.length > 0) return exact.rows[0].id;
    } catch { /* fall through to alias/email/nickname */ }
  }

  // Each step is individually wrapped so the absence of user_alias doesn't kill the whole function.

  // 1. Numeric uid exact match via user_alias (table may not exist).
  //    Only exact equality here — "84" means UID 84, not UIDs containing "84".
  try {
    const byUid = await pool.query<{ uuid: string }>(
      `SELECT uuid FROM public.user_alias
         WHERE alias_type = 'master_long'
           AND alias_value = $1
       LIMIT 1`,
      [trimmed]
    );
    if (byUid.rows.length > 0) {
      const verified = await pool.query<{ id: string }>(
        `SELECT id FROM public.users WHERE id = $1 LIMIT 1`,
        [byUid.rows[0].uuid]
      );
      if (verified.rows.length > 0) return verified.rows[0].id;
    }
  } catch { /* ignore */ }

  // 2. Email exact match (admin likely types full email, not partial)
  try {
    const byEmail = await pool.query<{ id: string }>(
      `SELECT id FROM public.users WHERE email = $1 LIMIT 1`,
      [trimmed]
    );
    if (byEmail.rows.length > 0) return byEmail.rows[0].id;
  } catch { /* ignore */ }

  // 3. Nickname exact match
  try {
    const byNickname = await pool.query<{ id: string }>(
      `SELECT id FROM public.users WHERE nickname = $1 LIMIT 1`,
      [trimmed]
    );
    if (byNickname.rows.length > 0) return byNickname.rows[0].id;
  } catch { /* ignore */ }

  // 4. Nickname partial match — this is the "fuzzy" fallback for misspelled names
  const fuzzy = `%${trimmed}%`;
  try {
    const byNickFuzzy = await pool.query<{ id: string }>(
      `SELECT id FROM public.users WHERE nickname ILIKE $1 LIMIT 1`,
      [fuzzy]
    );
    if (byNickFuzzy.rows.length > 0) return byNickFuzzy.rows[0].id;
  } catch { /* ignore */ }

  // 5. Email partial match — last resort for fragment searches
  try {
    const byEmailFuzzy = await pool.query<{ id: string }>(
      `SELECT id FROM public.users WHERE email ILIKE $1 LIMIT 1`,
      [fuzzy]
    );
    if (byEmailFuzzy.rows.length > 0) return byEmailFuzzy.rows[0].id;
  } catch { /* ignore */ }

  return null;
}

export async function GET(req: Request) {
  const authError = await requireAdminAuth(req as any);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const query = searchParams.get('query')?.trim() ?? '';

  if (!query) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'query parameter is required' } },
      { status: 400 }
    );
  }

  const ip = getClientIp(req);

  let userId: string;
  try {
    const resolved = await fuzzyResolveUserId(query);
    if (!resolved) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: '未找到匹配的用户，请尝试其他关键词' } },
        { status: 404 }
      );
    }
    userId = resolved;
  } catch (err) {
    // fuzzyResolveUserId only throws on unexpected errors (e.g. numeric
    // branch DB failure). Legacy non-numeric steps still swallow their
    // own errors inline. A legitimate miss (rows.length === 0) returns
    // null above and never reaches this catch.
    // Mirror the route's existing fatal-error response (INTERNAL_ERROR
    // / HTTP 500) — a DB failure must NEVER surface as 404.
    console.error('[ADMIN:USERS:SEARCH] fuzzyResolve threw:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: '查询失败，请稍后重试' } },
      { status: 500 }
    );
  }

  try {
    const pool = getPostgresPool();

    // ── 1. User profile + numeric uid ────────────────────────────────────
    const userResult = await pool.query<{
      id: string;
      nickname: string | null;
      email: string | null;
      avatar: string | null;
      created_at: string | null;
      numeric_uid: string | null;
    }>(
      `SELECT u.id,
              u.nickname,
              u.email,
              u.avatar,
              u.created_at,
              (SELECT alias_value FROM public.user_alias
                WHERE uuid = u.id AND alias_type = 'master_long' LIMIT 1) AS numeric_uid
         FROM public.users u
        WHERE u.id = $1
        LIMIT 1`,
      [userId]
    );
    const user = userResult.rows[0];

    if (!user) {
      return NextResponse.json(
        { ok: false, error: { code: 'NOT_FOUND', message: `User not found: ${userId}` } },
        { status: 404 }
      );
    }

    // ── 2. Global inventory (total damage, status) ─────────────────────────
    const invResult = await pool.query<{
      item_hand_count: number;
      item_phallus_count: number;
      total_damage_dealt: number;
      updated_at: string | null;
    }>(
      `SELECT item_hand_count, item_phallus_count, total_damage_dealt, updated_at
         FROM public.user_inventory
        WHERE user_id = $1
        LIMIT 1`,
      [userId]
    );
    const inv = invResult.rows[0];

    // ── 3. All activities (include config for milestone rendering) ─────
    const activitiesResult = await pool.query<{
      id: number; name: string; type: string;
      start_time: string; end_time: string; status: string;
      config: Record<string, unknown> | null;
    }>(
      `SELECT id, name, type, start_time, end_time, status, config
         FROM public.activities
        ORDER BY id ASC`
    );
    const activities = activitiesResult.rows;

    // ── 4. Activity-scoped inventories (REPARK 7.0, 2026-09-22) ────────
    // Read all (user, *) rows in one query to avoid N+1 inside the activities map.
    let inventoryByActivity: Record<string, { item_hand_count: number; item_phallus_count: number }> = {};
    try {
      const actInvResult = await pool.query<{
        activity_id: number;
        item_hand_count: number;
        item_phallus_count: number;
      }>(
        `SELECT activity_id, item_hand_count, item_phallus_count
           FROM public.user_activity_inventory
          WHERE user_id = $1`,
        [userId]
      );
      for (const row of actInvResult.rows) {
        inventoryByActivity[String(row.activity_id)] = {
          item_hand_count: row.item_hand_count,
          item_phallus_count: row.item_phallus_count,
        };
      }
    } catch {
      // user_activity_inventory may not exist yet (pre-migration) — leave empty map
    }

    // ── 4. Milestone claims — read from milestone_rewards (the actual claim table) ─
    // NOTE: milestone_rewards has no activity_id column, so claim state is shown
    // per-user, per-milestone globally. Override (admin lock/unlock) writes go to
    // milestone_rewards directly (see override route).
    // The page.tsx lookup uses String(ms.id), so we use string keys throughout.
    //
    // We SELECT admin_bypass columns defensively. If migration 17 has not yet
    // been applied those columns don't exist — we catch the error and fall back
    // to the legacy 3-column select. The fallback path returns admin_bypass=NULL.
    let milestoneClaimsMap: Record<string, Record<string, {
      is_claimed: boolean; is_locked: boolean; claimed_at: string | null;
      admin_bypass: boolean; admin_bypass_source: string | null;
    }>> = {};
    const buildClaim = (row: {
      milestone_id: number | string;
      is_claimed: boolean; is_locked: boolean; claimed_at: string | null;
      admin_bypass?: boolean | null; admin_bypass_source?: string | null;
    }) => ({
      is_claimed: Boolean(row.is_claimed),
      is_locked:  Boolean(row.is_locked),
      claimed_at: row.claimed_at ?? null,
      admin_bypass: Boolean(row.admin_bypass ?? false),
      admin_bypass_source: row.admin_bypass_source ?? null,
    });

    let claimsRows: Array<{
      milestone_id: number | string;
      is_claimed: boolean; is_locked: boolean; claimed_at: string | null;
      admin_bypass?: boolean | null; admin_bypass_source?: string | null;
    }> = [];
    try {
      const r = await pool.query(
        `SELECT milestone_id, is_claimed, is_locked, claimed_at,
                admin_bypass, admin_bypass_source
           FROM public.milestone_rewards
          WHERE user_id = $1`,
        [userId]
      );
      claimsRows = r.rows;
    } catch {
      // Pre-migration-17 fallback: admin_bypass columns don't exist yet.
      try {
        const r = await pool.query(
          `SELECT milestone_id, is_claimed, is_locked, claimed_at
             FROM public.milestone_rewards
            WHERE user_id = $1`,
          [userId]
        );
        claimsRows = r.rows as any;
      } catch {
        // Table itself missing — leave empty.
      }
    }
    for (const row of claimsRows) {
      const msIdStr = String(row.milestone_id);
      const claim = buildClaim(row);
      for (const act of activitiesResult.rows) {
        const aid = String(act.id);
        if (!milestoneClaimsMap[aid]) milestoneClaimsMap[aid] = {};
        milestoneClaimsMap[aid][msIdStr] = claim;
      }
    }

    // ── 5. Damage per activity (STRICT per-activity read) ──────────────
    // REPARK 7.0 — P0 2026-08-30 (Batch D1-R1, feedback #76 follow-up):
    // Earlier D1 mistakenly fell back to user_inventory.total_damage_dealt
    // (a GLOBAL lifetime accumulator across all activities) whenever the
    // user_activity_stats row was missing for a given (user, activity)
    // pair. That fall-back caused two production P0 regressions:
    //   1. Cross-activity leak on the admin "本活动贡献伤害" panel
    //      (Activity-A damage silently surfaced as Activity-B damage — #76).
    //   2. False-positive reward / milestone unlock (#85), because the
    //      reward path consumed the same leaky fallback.
    //
    // D1-R1 contract: per-activity damage is read STRICTLY from
    // user_activity_stats. Missing row ⇒ that activity is not represented
    // in `damageByActivity` (rendered as 0 via `?? 0` in the activities
    // projection below). The global lifetime figure is rendered
    // SEPARATELY in `inventory.totalDamage` as 玩家总伤害（全局） and is
    // NEVER substituted here.
    let damageByActivity: Record<string, number> = {};
    try {
      const statsResult = await pool.query<{ activity_id: number; total_damage: number }>(
        `SELECT activity_id, total_damage FROM public.user_activity_stats WHERE user_id = $1`,
        [userId]
      );
      for (const row of statsResult.rows) {
        damageByActivity[String(row.activity_id)] = Number(row.total_damage);
      }
    } catch {
      // user_activity_stats table unavailable — leave `damageByActivity`
      // empty. The `?? 0` projection below renders 0 for every activity
      // without a row; this is the correct, non-leaky value.
    }

    logAdminAction({
      route: '/api/admin/users/search',
      action: 'search_user',
      targetUserId: userId,
      clientIp: ip,
      success: true,
    });

    return NextResponse.json({
      ok: true,
      data: {
        user: {
          id:        user.id,
          uid:       user.numeric_uid ?? null,   // human-readable short ID (e.g. "128")
          nickname:  user.nickname ?? '',
          email:     user.email ?? '',
          avatar:    user.avatar ?? '👤',
          createdAt: user.created_at,
        },
        inventory: {
          propA:       Number(inv?.item_hand_count ?? 0),
          propB:       Number(inv?.item_phallus_count ?? 0),
          totalDamage: Number(inv?.total_damage_dealt ?? 0),
          updatedAt:   inv?.updated_at ?? null,
        },
        // REPARK 7.0 (2026-09-14): Attach badge names to MEDAL milestones so the
        // admin panel renders "魅魔杯冠军" instead of just "勋章 60".
        // attachBadgeNames is async so we use Promise.all within the map.
        activities: await Promise.all(activities.map(async (act) => {
          const cfg = (act.config ?? {}) as Record<string, unknown>;
          const msRaw = Array.isArray(cfg.milestones)
            ? (cfg.milestones as Array<Record<string, unknown>>)
            : [];
          // REPARK 7.0 (2026-09-15) hotfix (round 2):
          //
          // production DB layout (verified from aws_01_schema.sql + PM2 logs):
          //   public.milestone_rewards.milestone_id is INTEGER.
          //   The /admin/activities/[id]/config page NEW milestones with
          //   id of the form `m<unix-ts>` go through the API but ONLY for
          //   storage in the activity JSONB config. These dynamic ids are
          //   NOT directly written to milestone_rewards — the claim route
          //   normalizes them via lenientExtractMilestoneId() / number fallback
          //   BEFORE INSERT, so they end up stored as the numeric segment
          //   (e.g. "m1789424352" → 1789424352 in DB).
          //
          // Earlier this mapper collapsed "m1789424352" → NaN → fell through
          // to threshold, so the page showed `id=12` for a milestone whose
          // activity config id was `m1789424352`. That made the admin unable
          // to read this milestone's claim state.
          //
          // Resolution: keep the activity config id SOLELY as the row
          // identifier presented in the UI (`id` = original string), and
          // separately compute a `numericId` for any place that needs to
          // round-trip back to DB. But to AVOID silently breaking matching,
          // we also compute the digit-only form (`searchId`) that the claim
          // route actually wrote. The admin page matches against either
          // `String(ms.id)` or `String(<extracted digits>)` — matching the
          // original fallback in the page.
          //
          // This is consistent with /api/battle/init which already extracts
          // digits via normalizeMilestoneIdToInt() and uses the digit form
          // for claimedSet.has(id).
          const milestones = msRaw.map((m) => {
            // Preserve the original id verbatim for display ("m1789424352"
            // or 75 etc.) AND a parallel digit-only form for DB lookups.
            const idRaw = m.id ?? m.threshold ?? 0;
            const thrRaw = m.threshold ?? m.id ?? 0;
            const rtRaw = m.rewardType ?? m.reward_type ?? 'MEDAL';
            const evRaw = m.energyValue ?? m.energy_value;
            const medalRaw = m.medalId ?? m.medal_id;
            const idNumeric =
              typeof idRaw === 'number' && Number.isFinite(idRaw)
                ? idRaw
                : Number(String(idRaw).match(/\d+/)?.[0] ?? NaN);
            const thrNum = typeof thrRaw === 'string' ? Number(thrRaw) : (thrRaw as number);
            // Display id: prefer the literal original; if none readable, use
            // the digits; otherwise empty so filter rejects the row.
            const idDisplay =
              typeof idRaw === 'string'
                ? idRaw
                : Number.isFinite(idRaw)
                ? String(idRaw)
                : Number.isFinite(idNumeric)
                ? String(idNumeric)
                : '';
            return {
              id: idDisplay,
              idNumeric: Number.isFinite(idNumeric) ? idNumeric : null,
              threshold: Number.isFinite(thrNum) ? thrNum : 0,
              rewardType: String(rtRaw) === 'ENERGY' ? 'ENERGY' : 'MEDAL',
              energyValue: evRaw !== undefined && evRaw !== null ? Number(evRaw) : undefined,
              medalId: medalRaw !== undefined && medalRaw !== null ? String(medalRaw) : undefined,
            };
          }).filter((m) => String(m.id).length > 0 && m.threshold > 0);

          const milestonesWithNames = await attachBadgeNames(milestones);
          // REPARK 7.0 (2026-09-18) ISSUE 2: surface `hasItems` per
          // activity so /admin/users can hide the 道具数量管理 section
          // for activities that do not declare config.items. Decided from
          // the SAME `cfg` we just used for milestone rendering — strictly
          // per-activity, never falls back to getActiveActivity().
          //
          // REPARK 7.0 (2026-09-22): also surface per-activity inventory counts
          // so the admin can view/edit each activity's inventory independently.
          const actInv = inventoryByActivity[String(act.id)];
          return {
            id:          act.id,
            name:        act.name,
            type:        act.type,
            startTime:   act.start_time,
            endTime:     act.end_time,
            status:      act.status,
            totalDamage: damageByActivity[String(act.id)] ?? 0,
            milestones: milestonesWithNames,
            hasItems:    hasActivityItems(cfg),
            // Activity-scoped item quantities — 0 when no row exists.
            inventory: {
              propA: actInv?.item_hand_count ?? 0,
              propB: actInv?.item_phallus_count ?? 0,
            },
          };
        })),
        milestoneClaims: milestoneClaimsMap,
      },
    });
  } catch (err) {
    console.error('[ADMIN:USERS:SEARCH] fatal error:', err);
    return NextResponse.json(
      { ok: false, error: { code: 'INTERNAL_ERROR', message: '查询失败，请稍后重试' } },
      { status: 500 }
    );
  }
}
