import { getPostgresPool } from '@/lib/db/postgres';
import { randomUUID } from 'crypto';
import { getRedisClient } from '@/lib/redis';
import { warmBossCacheFromDb } from '@/lib/battleRedis';
import { toUuid as seedUuid } from '@/lib/userIdentity';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * PostgreSQL helpers used to replace the retired Supabase client.
 *
 * REPARK rule: every helper either returns data or throws. There is NO
 * silent fallback. If RDS is unreachable, the caller MUST return 500.
 *
 * This module is the single, project-wide entry point for raw pg.Pool
 * queries from the application layer. NO other module is permitted to
 * instantiate `pg.Pool` directly.
 */

const BOSS_ID = '00000000-0000-0000-0000-000000000001';

export interface BossStatusRow {
  boss_id: string;
  current_hp: number;
  max_hp: number;
  version: number;
  last_updated_at: string;
}

export interface UserInventoryRow {
  user_id: string;
  item_hand_count: number;
  item_phallus_count: number;
  total_damage_dealt: number;
  updated_at?: string;
  created_at?: string;
}

export interface AttackLogRow {
  id: string;
  user_id: string;
  item_used: 'item_hand' | 'item_phallus';
  damage_dealt: number;
  created_at: string;
}

export interface MilestoneRewardRow {
  user_id: string;
  milestone_id: string; // P0 2026-08-21: changed from number to support "m1001" style IDs
  is_claimed: boolean;
  is_locked: boolean;
  claimed_at: string | null;
  reward_type: string | null;
  reward_value: string | null;
  created_at?: string;
  // REPARK 7.0 (2026-09-14): Admin special-unlock flag. When TRUE the claim
  // route bypasses the personal_damage threshold check. The column is added
  // by migration 17; for deployments that have not yet applied the migration
  // this field is silently NULL/treated as false.
  admin_bypass?: boolean;
  admin_bypass_source?: string | null;
}

export interface ActivityRow {
  id: number;
  name: string;
  type: 'LIVE2D' | 'ENERGY';
  start_time: string;
  end_time: string;
  status: 'ENABLED' | 'DISABLED';
  config: Record<string, unknown> | null;
  created_at?: string;
}

// ── Boss ─────────────────────────────────────────────────────────────────────

export async function getBossStatus(): Promise<BossStatusRow | null> {
  const pool = getPostgresPool();
  const result = await pool.query<BossStatusRow>(
    `SELECT boss_id, current_hp, max_hp, version, last_updated_at
       FROM public.boss_status
      WHERE boss_id = $1
      LIMIT 1`,
    [BOSS_ID]
  );
  return result.rows[0] ?? null;
}

export async function updateBossStatus(hp: number, maxHp: number): Promise<{ newVersion: number }> {
  // REPARK 6.0 — P0 2026-07-30 — Optimistic locking on boss_status.version.
  //
  // Pre-fix contract (audit AUDIT_MEIMO_2026-07-30 §2.2 / §6):
  //   - version column was SELECTed but never used in the UPDATE WHERE clause.
  //   - 100 concurrent attacks on the same BOSS_ID would silently lose updates
  //     because each request overwrote current_hp without checking whether the
  //     row had been mutated between the SELECT (inside getBossStatus() / Redis
  //     Lua) and this UPDATE.
  //
  // Post-fix contract:
  //   1. Read the current version (1 round trip)
  //   2. UPDATE ... WHERE boss_id=$3 AND version=$prev SET version = version + 1
  //      RETURNING version
  //   3. If rowCount=0 → another writer beat us → retry ONCE with the fresh
  //      version (bounded retry: protects against livelocks while still being
  //      cheap for normal traffic).
  //   4. Return {newVersion} so callers can correlate future reads if needed.
  //
  // Backward compatibility:
  //   - Signature kept (hp, maxHp) — all 4 callers unchanged.
  //   - Return type widened from `Promise<void>` to `Promise<{newVersion: number}>`
  //     — TypeScript treats Promise<void> assignment as compatible with any
  //     Promise<T>, so existing `await updateBossStatus(...)` continues to
  //     compile and runtime-discards the new return value.
  const pool = getPostgresPool();
  const MAX_ATTEMPTS = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // ── Step 1: read the current version under a short-lived read ────────
    const readResult = await pool.query<{ version: number }>(
      `SELECT version FROM public.boss_status WHERE boss_id = $1 LIMIT 1`,
      [BOSS_ID]
    );
    const currentVersion = Number(readResult.rows[0]?.version ?? 0);

    // ── Step 2: CAS UPDATE guarded by the version we just read ───────────
    const updateResult = await pool.query<{ version: number }>(
      `UPDATE public.boss_status
          SET current_hp = $1,
              max_hp = $2,
              version = version + 1,
              last_updated_at = NOW()
        WHERE boss_id = $3 AND version = $4
      RETURNING version`,
      [hp, maxHp, BOSS_ID, currentVersion]
    );

    if ((updateResult.rowCount ?? 0) > 0) {
      const newVersion = Number(updateResult.rows[0]?.version ?? currentVersion + 1);
      // Sync Redis cache so the attack layer sees the same HP.
      // P0 2026-07-30: was using bare keys 'boss:hp'/'boss:max_hp' which don't match
      // the {battle}: slot tag used by REDIS_KEYS. All callers now share one code path.
      try {
        await warmBossCacheFromDb(hp, maxHp);   // → {battle}:boss:hp + {battle}:boss:max_hp
      } catch (err) {
        console.warn('[pg] updateBossStatus: redis warm failed', err);
      }
      if (attempt > 1) {
        console.log(`[pg] updateBossStatus: optimistic-lock retry succeeded on attempt ${attempt}`);
      }
      return { newVersion };
    }

    // rowCount === 0 → another writer beat us between SELECT and UPDATE
    console.warn(
      `[pg] updateBossStatus: version conflict (attempt ${attempt}/${MAX_ATTEMPTS}, ` +
      `expected version=${currentVersion}). Retrying…`
    );
    lastError = new Error(
      `optimistic lock conflict on boss_status: expected version=${currentVersion}`
    );
  }

  // All retries exhausted — surface the error so the caller (attack/route.ts
  // / admin route) can decide whether to fail-closed or compensate. This is
  // intentionally an exception, NOT a silent fallback: REPARK rule §1 forbids
  // silent data loss on this code path.
  throw lastError instanceof Error
    ? lastError
    : new Error('updateBossStatus: optimistic lock retries exhausted');
}

// ── User inventory ───────────────────────────────────────────────────────────

/**
 * Ensure a `public.users` row exists for the given UUID.
 *
 * Several tables (user_inventory, attack_logs, user_daily_tasks, task_progress,
 * milestone_rewards) declare FKs to public.users(id). When a brand-new device
 * issues its first attack, those parent rows won't exist yet and the inserts
 * will fail with sqlstate 23503. Inserting here is idempotent thanks to
 * ON CONFLICT DO NOTHING.
 */
export async function ensureUserExists(userId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO public.users (id, nickname, avatar)
     VALUES ($1, '', '👤')
     ON CONFLICT (id) DO NOTHING`,
    [userId]
  );
}

export async function getUserInventory(userId: string): Promise<UserInventoryRow | null> {
  const pool = getPostgresPool();
  const result = await pool.query<UserInventoryRow>(
    `SELECT user_id, item_hand_count, item_phallus_count, total_damage_dealt, updated_at
       FROM public.user_inventory
      WHERE user_id = $1
      LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function upsertUserInventory(
  userId: string,
  itemHandCount?: number,
  itemPhallusCount?: number
): Promise<void> {
  await ensureUserExists(userId);
  const pool = getPostgresPool();

  // Placeholder index plan:
  //   $1 = userId (used by INSERT VALUES and by ON CONFLICT target)
  //   $2 = item_hand_count (optional)
  //   $3 = item_phallus_count (optional)
  const sets: string[] = [];
  const params: unknown[] = [userId];
  let idx = 2;

  if (itemHandCount !== undefined) {
    sets.push(`item_hand_count = $${idx++}`);
    params.push(Math.max(0, itemHandCount));
  }
  if (itemPhallusCount !== undefined) {
    sets.push(`item_phallus_count = $${idx++}`);
    params.push(Math.max(0, itemPhallusCount));
  }

  const setClause = sets.length > 0 ? sets.join(', ') : 'updated_at = NOW()';

  await pool.query(
    `INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt, updated_at)
     VALUES ($1, 0, 0, 0, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${setClause}`,
    params
  );
}

export async function incrementUserDamage(userId: string, damage: number): Promise<number> {
  await ensureUserExists(userId);
  const pool = getPostgresPool();
  const result = await pool.query<{ total_damage_dealt: number }>(
    `INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
     VALUES ($1, 0, 0, $2)
     ON CONFLICT (user_id) DO UPDATE
       SET total_damage_dealt = public.user_inventory.total_damage_dealt + EXCLUDED.total_damage_dealt,
           updated_at = NOW()
     RETURNING total_damage_dealt`,
    [userId, Math.max(0, damage)]
  );
  return Number(result.rows[0]?.total_damage_dealt ?? 0);
}

export async function decrementUserInventory(
  userId: string,
  itemType: 'item_hand' | 'item_phallus'
): Promise<boolean> {
  await ensureUserExists(userId);
  const pool = getPostgresPool();
  const column = itemType === 'item_hand' ? 'item_hand_count' : 'item_phallus_count';
  const result = await pool.query(
    `UPDATE public.user_inventory
        SET ${column} = GREATEST(0, ${column} - 1),
            updated_at = NOW()
      WHERE user_id = $1 AND ${column} > 0
      RETURNING user_id`,
    [userId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Activity-scoped inventory (REPARK 7.0, 2026-09-22) ────────────────────────
//
// Separate table from user_inventory so global fields (total_damage_dealt, status)
// stay single-row-per-user while item quantities are per-(user, activity).
//
// Invariant: every function in this section requires BOTH userId AND activityId.
// No default activityId. No optional activityId.

import type { PoolClient } from 'pg';

/**
 * REPARK 7.0 (2026-09-22): Read a player's item inventory for a specific activity.
 * Returns null when no row exists (quantity is implicitly 0 — no legacy fallback).
 *
 * @param userId     Canonical UUID
 * @param activityId Must be explicitly provided. No default.
 */
export async function getActivityInventory(
  userId: string,
  activityId: number,
): Promise<{ item_hand_count: number; item_phallus_count: number } | null> {
  const pool = getPostgresPool();
  const result = await pool.query<{
    item_hand_count: number;
    item_phallus_count: number;
  }>(
    `SELECT item_hand_count, item_phallus_count
       FROM public.user_activity_inventory
      WHERE user_id = $1 AND activity_id = $2
      LIMIT 1`,
    [userId, activityId]
  );
  return result.rows[0] ?? null;
}

/**
 * REPARK 7.0 (2026-09-22): Ensure a row exists for (userId, activityId).
 * Idempotent — safe to call before any write.
 */
export async function ensureActivityInventoryExists(
  userId: string,
  activityId: number,
): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO public.user_activity_inventory
       (user_id, activity_id, item_hand_count, item_phallus_count, updated_at)
     VALUES ($1, $2, 0, 0, NOW())
     ON CONFLICT (user_id, activity_id) DO NOTHING`,
    [userId, activityId],
  );
}

/**
 * REPARK 7.0 (2026-09-22): Adjust a specific item count for a user in an activity.
 * Replaces the previous global upsert against user_inventory.
 *
 * @param userId     Canonical UUID
 * @param activityId Must match the activity context of the admin operation
 * @param itemType   'item_hand' = propA, 'item_phallus' = propB
 * @param newCount   Absolute value to set (>= 0)
 */
export async function adjustActivityInventory(
  userId: string,
  activityId: number,
  itemType: 'item_hand' | 'item_phallus',
  newCount: number,
): Promise<void> {
  const pool = getPostgresPool();
  const column = itemType === 'item_hand' ? 'item_hand_count' : 'item_phallus_count';
  const safe = Math.max(0, Math.floor(Number(newCount) || 0));
  await pool.query(
    `INSERT INTO public.user_activity_inventory
       (user_id, activity_id, item_hand_count, item_phallus_count, updated_at)
     VALUES ($1, $2, $3, $3, NOW())
     ON CONFLICT (user_id, activity_id) DO UPDATE SET
       ${column} = EXCLUDED.${column},
       updated_at = NOW()`,
    [userId, activityId, safe],
  );
}

/**
 * REPARK 7.0 (2026-09-22): Atomic grant for use INSIDE an existing transaction.
 * Must be called with a PoolClient that already has BEGIN issued.
 * Does NOT open its own connection.
 *
 * Invariant: increments the item by exactly 1 in (user_id, activity_id).
 * If no row exists, creates one first. The +1 is unconditional.
 *
 * Throws if the UPDATE returns rowCount=0 (impossible — we just ensured the row).
 */
export async function grantActivityItemTx(
  client: PoolClient,
  userId: string,
  activityId: number,
  itemType: 'item_hand' | 'item_phallus',
): Promise<number> {
  const column = itemType === 'item_hand' ? 'item_hand_count' : 'item_phallus_count';
  // Step 1: ensure the row exists (idempotent, no-op on conflict).
  await client.query(
    `INSERT INTO public.user_activity_inventory
       (user_id, activity_id, item_hand_count, item_phallus_count, updated_at)
     VALUES ($1, $2, 0, 0, NOW())
     ON CONFLICT (user_id, activity_id) DO NOTHING`,
    [userId, activityId],
  );
  // Step 2: increment by exactly 1. RETURNING provides the new value.
  const result = await client.query<{ [k: string]: number }>(
    `UPDATE public.user_activity_inventory
        SET ${column} = ${column} + 1,
            updated_at = NOW()
      WHERE user_id = $1 AND activity_id = $2
      RETURNING ${column}`,
    [userId, activityId],
  );
  if ((result.rowCount ?? 0) !== 1) {
    throw new Error(`grantActivityItemTx: expected rowCount=1, got ${result.rowCount}`);
  }
  return Number(result.rows[0][column]);
}

/**
 * REPARK 7.0 (2026-09-22): Atomic consume for use INSIDE an existing transaction.
 *
 * Strict conditional decrement: only succeeds when the count > 0.
 * Returns the new value on success, or null when insufficient.
 *
 * This is the canonical primitive used by attack routes to avoid
 * post-quantity=0 damage writes.
 */
export async function consumeActivityItemTx(
  client: PoolClient,
  userId: string,
  activityId: number,
  itemType: 'item_hand' | 'item_phallus',
): Promise<number | null> {
  const column = itemType === 'item_hand' ? 'item_hand_count' : 'item_phallus_count';
  const result = await client.query<{ [k: string]: number }>(
    `UPDATE public.user_activity_inventory
        SET ${column} = ${column} - 1,
            updated_at = NOW()
      WHERE user_id = $1
        AND activity_id = $2
        AND ${column} > 0
      RETURNING ${column}`,
    [userId, activityId],
  );
  if ((result.rowCount ?? 0) === 0) {
    return null; // insufficient
  }
  return Number(result.rows[0][column]);
}

/**
 * REPARK 7.0 (2026-09-22): Reset all activity inventory rows for a user.
 * Called by admin/user/reset when type='inventory' or type='all'.
 *
 * NOTE: this is the dedicated /api/admin/user/reset endpoint that resets
 * EVERYTHING for the user (inventory + daily tasks + milestone claims).
 * Activity-scoped reset is NOT supported by this endpoint — there is no
 * UI for it. If a per-activity reset UI is added later, it should call a
 * separate helper.
 */
export async function resetActivityInventory(userId: string): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `DELETE FROM public.user_activity_inventory WHERE user_id = $1`,
    [userId],
  );
}

// ── Attack logs ──────────────────────────────────────────────────────────────

export async function insertAttackLog(
  userId: string,
  itemUsed: 'item_hand' | 'item_phallus',
  damageDealt: number
): Promise<void> {
  await ensureUserExists(userId);
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO public.attack_logs (user_id, item_used, damage_dealt)
     VALUES ($1, $2, $3)`,
    [userId, itemUsed, damageDealt]
  );
}

export async function listAttackLogs(userId?: string, limit = 1000): Promise<AttackLogRow[]> {
  const pool = getPostgresPool();
  const params: unknown[] = [];
  let where = '';
  if (userId) {
    params.push(userId);
    where = `WHERE user_id = $1`;
  }
  params.push(limit);
  const result = await pool.query<AttackLogRow>(
    `SELECT id, user_id, item_used, damage_dealt, created_at
       FROM public.attack_logs
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return result.rows;
}

export async function computeUserTotalDamage(userId: string): Promise<number> {
  const pool = getPostgresPool();
  const result = await pool.query<{ sum: string | null }>(
    `SELECT COALESCE(SUM(damage_dealt), 0) AS sum
       FROM public.attack_logs
      WHERE user_id = $1`,
    [userId]
  );
  return Number(result.rows[0]?.sum ?? 0);
}

/**
 * True if the user has reached any milestone threshold from the currently
 * active activity that has not yet been claimed. Used to drive the
 * "可领取" badge on the home banner carousel (PRD §2.9 / TC-BN-02).
 *
 * Pure read against milestone_rewards + activities.config.milestones;
 * no mutation. Returns false when there is no active activity.
 */
export async function hasUnclaimedMilestone(userId: string): Promise<boolean> {
  const active = await getActiveActivity();
  if (!active) return false;
  const cfg = active.config ?? {};
  const milestones = Array.isArray((cfg as Record<string, unknown>).milestones)
    ? ((cfg as Record<string, unknown>).milestones as Array<Record<string, unknown>>)
    : [];
  if (milestones.length === 0) return false;

  // Coerce threshold — accept both `threshold` (PRD canonical) and `id`
  // (legacy). Numeric strings are tolerated.
  const thresholds = milestones
    .map((m) => {
      const raw = m.threshold ?? m.id ?? 0;
      const n = typeof raw === 'string' ? Number(raw) : (raw as number);
      return Number.isFinite(n) ? n : 0;
    })
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (thresholds.length === 0) return false;

  const totalDamage = await computeUserTotalDamage(userId);
  if (totalDamage < thresholds[0]!) return false;

  // Only consider thresholds that the user has reached.
  const reached = thresholds.filter((t) => totalDamage >= t);
  if (reached.length === 0) return false;

  const claimed = await getMilestoneRewards(userId);
  const claimedIds = new Set(
    claimed.filter((r) => r.is_claimed).map((r) => r.milestone_id)
  );
  // A milestone is claimable if its threshold ≤ totalDamage AND no row
  // exists with is_claimed=true for that threshold. Legacy data may
  // have stored the threshold itself as milestone_id; we normalize
  // against the threshold set.
  return reached.some((t) => !claimedIds.has(String(t)));
}

// ── Milestones ───────────────────────────────────────────────────────────────

export async function getMilestoneRewards(userId: string): Promise<MilestoneRewardRow[]> {
  const pool = getPostgresPool();
  const result = await pool.query<MilestoneRewardRow>(
    `SELECT user_id, milestone_id, is_claimed, is_locked, claimed_at, reward_type, reward_value,
            admin_bypass, admin_bypass_source
       FROM public.milestone_rewards
      WHERE user_id = $1`,
    [userId]
  );
  return result.rows;
}

export async function getMilestoneReward(
  userId: string,
  milestoneId: number | string
): Promise<MilestoneRewardRow | null> {
  const pool = getPostgresPool();
  const result = await pool.query<MilestoneRewardRow>(
    `SELECT user_id, milestone_id, is_claimed, is_locked, claimed_at, reward_type, reward_value,
            admin_bypass, admin_bypass_source
       FROM public.milestone_rewards
      WHERE user_id = $1 AND milestone_id = $2
      LIMIT 1`,
    [userId, String(milestoneId)]
  );
  return result.rows[0] ?? null;
}

export async function upsertMilestoneReward(
  row: MilestoneRewardRow
): Promise<MilestoneRewardRow> {
  await ensureUserExists(row.user_id);
  const pool = getPostgresPool();
  const result = await pool.query<MilestoneRewardRow>(
    `INSERT INTO public.milestone_rewards
       (user_id, milestone_id, is_claimed, is_locked, claimed_at, reward_type, reward_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, milestone_id) DO UPDATE SET
       is_claimed  = EXCLUDED.is_claimed,
       is_locked   = EXCLUDED.is_locked,
       claimed_at  = EXCLUDED.claimed_at,
       reward_type = EXCLUDED.reward_type,
       reward_value = EXCLUDED.reward_value
     RETURNING user_id, milestone_id, is_claimed, is_locked, claimed_at, reward_type, reward_value`,
    [
      row.user_id,
      row.milestone_id,
      row.is_claimed,
      row.is_locked,
      row.claimed_at,
      row.reward_type,
      row.reward_value,
    ]
  );
  return result.rows[0]!;
}

/**
 * REPARK 7.0 (2026-09-14): Claim a milestone reward, marking it as claimed and
 * clearing the admin_bypass flag atomically.
 *
 * Strategy:
 *   1. Try atomic claim-with-bypass-clear in one SQL statement.
 *      If admin_bypass column exists (migration 17 applied) → succeeds, done.
 *   2. If "column does not exist" → fall back to plain upsert (no bypass).
 *      The is_claimed=true row already prevents a second grant regardless of
 *      any leaked bypass flag, so this fallback is safe.
 *
 * The extra UPDATE (claim + separate bypass clear) is avoided because a second
 * concurrent claim could see the intermediate state and attempt double-grant
 * before the bypass is cleared. One atomic statement eliminates this race.
 *
 * @param row    — same fields as upsertMilestoneReward
 * @param bypass — TRUE when the claim used admin_bypass to skip threshold check.
 *                 TRUE → clears admin_bypass after writing claim state.
 *                 FALSE → no bypass flag to clear (normal damage-based claim).
 */
export async function claimMilestoneReward(
  row: {
    user_id: string;
    milestone_id: string;
    is_claimed: boolean;
    is_locked: boolean;
    claimed_at: string | null;
    reward_type: string | null;
    reward_value: string | null;
  },
  bypass: boolean,
): Promise<void> {
  await ensureUserExists(row.user_id);
  const pool = getPostgresPool();

  // Fast path: try the atomic upsert with admin_bypass column.
  // This works when migration 17 has been applied.
  //
  // REPARK 7.0 (2026-09-15) hotfix: the previous code passed `null` when
  // bypass=false, which trips the NOT NULL constraint on
  // milestone_rewards.admin_bypass whenever the column was added WITHOUT a
  // default (migration 17 alter). PostgreSQL raises 23502 and the route
  // returns 500 to the client. Fix: use a literal `false` instead of NULL.
  // The semantics are unchanged: admin_bypass=TRUE is the special-unlock
  // permission, FALSE otherwise; bypassing the row completely still requires
  // admin_bypass_source to be set, which the override route writes.
  try {
    // Always set to FALSE on claim. bypass=true means the admin override
    // path was used; that permission is consumed exactly here and never reused.
    const bypassValue = false;
    await pool.query(
      `INSERT INTO public.milestone_rewards
         (user_id, milestone_id, is_claimed, is_locked, claimed_at, reward_type, reward_value, admin_bypass)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, milestone_id) DO UPDATE SET
         is_claimed   = EXCLUDED.is_claimed,
         is_locked    = EXCLUDED.is_locked,
         claimed_at   = EXCLUDED.claimed_at,
         reward_type  = EXCLUDED.reward_type,
         reward_value = EXCLUDED.reward_value,
         admin_bypass = EXCLUDED.admin_bypass
       RETURNING admin_bypass`,
      [
        row.user_id,
        row.milestone_id,
        row.is_claimed,
        row.is_locked,
        row.claimed_at,
        row.reward_type,
        row.reward_value,
        bypassValue,
      ]
    );
    return; // success
  } catch (e: unknown) {
    const msg = String((e as Error)?.message ?? '');
    if (!/column .* does not exist/i.test(msg)) {
      throw e; // re-throw unrelated errors (e.g. FK violation, NOT NULL)
    }
    // Fall-through: admin_bypass column doesn't exist yet. Use the plain upsert.
    // The is_claimed=true row already blocks double-grant; bypass flag, if any,
    // is irrelevant to the idempotency invariant.
  }

  // Safe fallback (pre-migration-17): plain upsert, bypass is irrelevant.
  await pool.query(
    `INSERT INTO public.milestone_rewards
       (user_id, milestone_id, is_claimed, is_locked, claimed_at, reward_type, reward_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, milestone_id) DO UPDATE SET
       is_claimed   = EXCLUDED.is_claimed,
       is_locked    = EXCLUDED.is_locked,
       claimed_at   = EXCLUDED.claimed_at,
       reward_type  = EXCLUDED.reward_type,
       reward_value = EXCLUDED.reward_value`,
    [
      row.user_id,
      row.milestone_id,
      row.is_claimed,
      row.is_locked,
      row.claimed_at,
      row.reward_type,
      row.reward_value,
    ]
  );
}

// ── Activities ──────────────────────────────────────────────────────────────

export async function listActivities(): Promise<ActivityRow[]> {
  const pool = getPostgresPool();
  const result = await pool.query<ActivityRow>(
    `SELECT id, name, type, start_time, end_time, status, config, created_at
       FROM public.activities
      ORDER BY id ASC`
  );
  return result.rows;
}

export async function getActivityById(id: number): Promise<ActivityRow | null> {
  const pool = getPostgresPool();
  const result = await pool.query<ActivityRow>(
    `SELECT id, name, type, start_time, end_time, status, config, created_at
       FROM public.activities
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function getActiveActivity(): Promise<ActivityRow | null> {
  const pool = getPostgresPool();
  const result = await pool.query<ActivityRow>(
    `SELECT id, name, type, start_time, end_time, status, config, created_at
       FROM public.activities
      WHERE (config->>'isGlobalEnabled')::boolean = true
      LIMIT 1`
  );
  return result.rows[0] ?? null;
}

export async function insertActivity(
  name: string,
  type: 'LIVE2D' | 'ENERGY',
  start_time: string,
  end_time: string,
  config: Record<string, unknown> = { isGlobalEnabled: false }
): Promise<ActivityRow> {
  const pool = getPostgresPool();
  const result = await pool.query<ActivityRow>(
    `INSERT INTO public.activities (name, type, start_time, end_time, status, config)
     VALUES ($1, $2, $3, $4, 'DISABLED', $5::jsonb)
     RETURNING id, name, type, start_time, end_time, status, config, created_at`,
    [name, type, start_time, end_time, JSON.stringify(config)]
  );
  return result.rows[0]!;
}

export async function updateActivity(
  id: number,
  updates: Partial<{
    name: string;
    type: 'LIVE2D' | 'ENERGY';
    start_time: string;
    end_time: string;
    status: 'ENABLED' | 'DISABLED';
    config: Record<string, unknown>;
  }>
): Promise<ActivityRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (key === 'config') {
      sets.push(`config = $${idx++}::jsonb`);
      params.push(JSON.stringify(value));
    } else {
      sets.push(`${key} = $${idx++}`);
      params.push(value);
    }
  }
  if (sets.length === 0) return await getActivityById(id);
  params.push(id);
  const pool = getPostgresPool();
  const result = await pool.query<ActivityRow>(
    `UPDATE public.activities
        SET ${sets.join(', ')}
      WHERE id = $${idx}
      RETURNING id, name, type, start_time, end_time, status, config, created_at`,
    params
  );
  return result.rows[0] ?? null;
}

export async function deleteActivity(id: number): Promise<boolean> {
  const pool = getPostgresPool();
  const result = await pool.query(`DELETE FROM public.activities WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function setActivityActive(targetId: number): Promise<ActivityRow | null> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Clear all flags, then set the target.
    await client.query(
      `UPDATE public.activities
          SET config = jsonb_set(config, '{isGlobalEnabled}', 'false', true)`
    );
    const result = await client.query<ActivityRow>(
      `UPDATE public.activities
          SET config = jsonb_set(config, '{isGlobalEnabled}', 'true', true)
        WHERE id = $1
        RETURNING id, name, type, start_time, end_time, status, config, created_at`,
      [targetId]
    );
    await client.query('COMMIT');
    return result.rows[0] ?? null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ── Activity-scoped personal damage ────────────────────────────────────────────

/**
 * REPARK v7.0 (2026-08-24): Read this player's accumulated damage for a
 * specific activity. This is the source of truth for milestone reward unlock
 * thresholds AND admin "本活动贡献伤害" display.
 *
 * REPARK 7.0 — P0 2026-08-30 (Batch D1-R1, feedback #76 / #85 follow-up):
 * STRICT activity-scoped read. Returns the value from `user_activity_stats`
 * row for (user, activity). When no row exists, returns 0 — NEVER falls
 * back to `user_inventory.total_damage_dealt` (a global lifetime
 * accumulator across all activities).
 *
 * The earlier D1 (2026-08-30) implementation read `user_inventory.total_
 * damage_dealt` on a missing row. That fallback caused two production P0
 * regressions:
 *   1. Cross-activity leak (#76) — Activity-A damage silently surfaced
 *      as Activity-B damage on the admin panel.
 *   2. False-positive milestone unlock (#85) — lifetime damage satisfied
 *      a current-activity threshold the user had not actually earned.
 *
 * Invariant: getActivityDamage(U, ActivityB) MUST NOT return damage earned
 * in ActivityA (or any other activity). The only acceptable missing-row
 * behaviour is 0. Historical users whose user_activity_stats row is
 * genuinely missing are reported as 0 until an explicit, schema-approved
 * backfill is performed in a separate batch.
 */
export async function getActivityDamage(userId: string, activityId: number): Promise<number> {
  const pool = getPostgresPool();
  const result = await pool.query<{ total_damage: string }>(
    `SELECT total_damage
       FROM public.user_activity_stats
      WHERE user_id = $1 AND activity_id = $2`,
    [userId, activityId]
  );
  if (result.rows[0]) {
    return Number(result.rows[0].total_damage);
  }
  // No per-activity row — strictly 0. See the function header for the
  // rationale; this is the contract the reward-claim, milestone-claim,
  // and admin-search readers all depend on.
  return 0;
}

// ── Task progress (user_daily_tasks) ─────────────────────────────────────────

export async function getDailyTask(
  userId: string,
  date: string
): Promise<{ daily_energy_consumed: number; daily_money_recharged: number; recharge_processed: boolean } | null> {
  const pool = getPostgresPool();
  const result = await pool.query<{
    daily_energy_consumed: number;
    daily_money_recharged: number;
    recharge_processed: boolean;
  }>(
    `SELECT daily_energy_consumed, daily_money_recharged, COALESCE(recharge_processed, false) AS recharge_processed
       FROM public.user_daily_tasks
      WHERE user_id = $1 AND date = $2
      LIMIT 1`,
    [userId, date]
  );
  return result.rows[0] ?? null;
}

export async function incrementDailyTask(
  userId: string,
  date: string,
  field: 'consume' | 'recharge',
  amount: number
): Promise<number> {
  console.log(`[incrementDailyTask] ENTRY: userId=${userId} date=${date} field=${field} amount=${amount}`);
  await ensureUserExists(userId);
  const pool = getPostgresPool();
  let result;
  if (field === 'consume') {
    result = await pool.query<{ value: number }>(
      `INSERT INTO public.user_daily_tasks (user_id, date, daily_energy_consumed, daily_money_recharged)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (user_id, date) DO UPDATE
         SET daily_energy_consumed = public.user_daily_tasks.daily_energy_consumed + $3,
             updated_at = NOW()
       RETURNING daily_energy_consumed AS value`,
      [userId, date, Math.max(0, amount)]
    );
  } else {
    // Explicit branch per column — avoids PostgreSQL RETURNING with interpolated
    // dynamic column names, which silently returns the wrong column's value in
    // some versions/configurations, producing the "newValue=0 but rows=1" bug
    // where recharge increments were lost.  See TC-P0-20 root-cause analysis.
    result = await pool.query<{ value: number }>(
      `INSERT INTO public.user_daily_tasks (user_id, date, daily_energy_consumed, daily_money_recharged)
       VALUES ($1, $2, 0, $3)
       ON CONFLICT (user_id, date) DO UPDATE
         SET daily_money_recharged = public.user_daily_tasks.daily_money_recharged + $3,
             updated_at = NOW()
       RETURNING daily_money_recharged AS value`,
      [userId, date, Math.max(0, amount)]
    );
  }
  const newValue = Number(result.rows[0]?.value ?? 0);
  console.log(`[incrementDailyTask] EXIT: userId=${userId} date=${date} field=${field} newValue=${newValue} rows=${result.rowCount}`);
  return newValue;
}

// ── Daily-task effective date (REPARK 7.0 Batch C, 2026-08-28) ───────────────
//
// Customer-requested toggle: 每日自动重置 ON / OFF.
// When ON (default — also true for all existing activities without the field),
// the daily-task bucket is "today" in UTC+8 (current production behaviour).
// When OFF, the bucket is anchored to the activity's start date so progress
// accumulates across calendar days for the duration of the activity.
//
// The toggle is read from activities.config.dailyReset.enabled:
//   undefined → ON (legacy activities behave exactly as today)
//   true      → ON
//   false     → OFF
//
// All daily-task reads/writes (battle/init, battle/task-claim,
// /api/user/status, /api/webhook/user-action) MUST funnel through this helper
// so the bucket key is identical across writers and readers.

export interface EffectiveDailyTaskDate {
  /** Date key to use in user_daily_tasks.date and task_progress.reset_date. */
  date: string;
  /** Whether the operator disabled the midnight reset (false = anchored). */
  dailyResetEnabled: boolean;
  /** The bucket's anchor date — same as `date` for ON, or the activity start for OFF. */
  anchorDate: string;
  /** Today's UTC+8 date (always returned, useful for ON→OFF migration). */
  todayDate: string;
}

/**
 * Resolve the effective daily-task bucket for an activity.
 *
 * Reads:
 *   - activities.config.dailyReset?.enabled  (default ON if missing)
 *   - activities.start_time                  (UTC+8 anchor when OFF)
 *
 * @param activityRow The activity row from `getActiveActivity()` /
 *                    `getActivityById()`. Pass `null` to get the ON-mode
 *                    default (today UTC+8), which is what every writer should
 *                    do when no active activity is configured.
 * @param now         Optional clock override (for tests). Defaults to wall time.
 */
export function resolveEffectiveDailyTaskDate(
  activityRow: Pick<ActivityRow, 'start_time' | 'config'> | null,
  now: Date = new Date(),
): EffectiveDailyTaskDate {
  const todayDate = dayjs(now).tz('Asia/Shanghai').format('YYYY-MM-DD');
  const config = (activityRow?.config ?? null) as Record<string, unknown> | null;
  const dailyResetRaw = config?.dailyReset;
  const dailyResetEnabled =
    dailyResetRaw !== undefined && dailyResetRaw !== null
      ? Boolean((dailyResetRaw as Record<string, unknown>).enabled)
      : true; // legacy default: ON

  if (dailyResetEnabled) {
    return {
      date: todayDate,
      dailyResetEnabled: true,
      anchorDate: todayDate,
      todayDate,
    };
  }

  // OFF: anchor to the activity's UTC+8 start date (the activity lifecycle
  // boundary). If start_time is missing/malformed we fall back to today to
  // avoid breaking the route — the operator can correct the activity later.
  let anchorDate = todayDate;
  if (activityRow?.start_time) {
    const parsed = dayjs(activityRow.start_time).tz('Asia/Shanghai');
    if (parsed.isValid()) {
      anchorDate = parsed.format('YYYY-MM-DD');
    }
  }

  return {
    date: anchorDate,
    dailyResetEnabled: false,
    anchorDate,
    todayDate,
  };
}

/**
 * Lazy ON→OFF migration: when the operator switches dailyReset to OFF, the
 * first subsequent read/write for a given user must preserve any progress
 * that was already accumulated under today's bucket. We copy that row into
 * the new anchor bucket once, idempotently, before the caller's normal
 * read/write proceeds. If the anchor bucket already exists, we never touch
 * it (the user's accumulated OFF-mode history is left intact).
 *
 * OFF→ON does NOT do a reverse copy. When the operator toggles back ON, the
 * next read/write uses today's bucket and the OFF-mode history simply stays
 * stored under the old anchor (and eventually ages out of any consumer that
 * only reads today). No data loss, no double counting.
 */
export async function migrateDailyTaskBucketOnTransition(
  userId: string,
  eff: EffectiveDailyTaskDate,
): Promise<void> {
  if (eff.dailyResetEnabled) return; // ON mode never migrates
  if (eff.date === eff.todayDate) return; // OFF today == anchor today, nothing to migrate

  await ensureUserExists(userId);
  const pool = getPostgresPool();

  // 1. user_daily_tasks: copy today's row into the anchor bucket IF the
  //    anchor bucket does not yet exist. ON CONFLICT DO NOTHING guarantees
  //    idempotency across repeated calls.
  await pool.query(
    `INSERT INTO public.user_daily_tasks
       (user_id, date, daily_energy_consumed, daily_money_recharged, recharge_processed, updated_at)
     SELECT $1, $2, daily_energy_consumed, daily_money_recharged,
            COALESCE(recharge_processed, false), NOW()
       FROM public.user_daily_tasks
      WHERE user_id = $1 AND date = $3
     ON CONFLICT (user_id, date) DO NOTHING`,
    [userId, eff.date, eff.todayDate],
  );

  // 2. task_progress: same one-shot copy for each (task_type) row.
  await pool.query(
    `INSERT INTO public.task_progress
       (user_id, task_type, reset_date, current_progress, is_claimed, claimed_count, updated_at)
     SELECT $1, task_type, $2, current_progress, is_claimed, COALESCE(claimed_count, 0), NOW()
       FROM public.task_progress
      WHERE user_id = $1 AND reset_date = $3
     ON CONFLICT (user_id, task_type, reset_date) DO NOTHING`,
    [userId, eff.date, eff.todayDate],
  );
}

// ── User alias resolution (long ↔ UUID) ─────────────────────────────────────
//
// The Main Station system stores its native user_id as BIGINT (a.k.a. "long").
// Our PostgreSQL schema declares public.users.id as UUID. Posting the raw long
// value into a UUID column produces `22P02 invalid input syntax for type uuid`
// and the webhook returns 500. To unblock the Main Station without forcing it
// to upgrade its schema, we resolve external identifiers through a stable
// alias table the first time they appear:
//
//   public.user_alias(alias_type, alias_value, uuid)  -- PK(alias_type, alias_value)
//
// Behaviour:
//   - Already-UUID inputs (regex match) pass through unchanged.
//   - Numeric/pure-string inputs are looked up; on miss we generate a fresh
//     UUID and upsert the alias row atomically.
//   - Same long → same UUID on every call (deterministic), so consume/recharge
//     for the same Main Station user land in the same daily-task row.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALIAS_TYPE_MASTER_LONG = 'master_long';

function newUuid(): string {
  // Node 14.17+ ships Web Crypto on the global scope; the route handler runs
  // in the Next.js Node runtime (Edge would not have `crypto`).
  return (globalThis.crypto?.randomUUID?.() ?? randomUUID()) as string;
}

/**
 * Resolve an incoming user_id (string, possibly a numeric long) into the
 * canonical UUID stored in public.users. Unknown identifiers get a fresh
 * UUID minted and persisted in public.user_alias so that subsequent calls
 * from the same Main Station user land on the same row.
 *
 * Throws if the database is unreachable — the route handler will catch this
 * and return 500, matching the existing error contract.
 */
export async function resolveAliasToUuid(rawId: string): Promise<string> {
  if (typeof rawId !== 'string' || rawId.length === 0) {
    throw new Error('user_id must be a non-empty string');
  }
  // Already a UUID? Pass through.
  if (UUID_REGEX.test(rawId)) {
    return rawId.toLowerCase();
  }

  // Alias path (numeric long or unknown shape).
  const pool = getPostgresPool();
  // Try lookup first.
  const found = await pool.query<{ uuid: string }>(
    `SELECT uuid FROM public.user_alias
      WHERE alias_type = $1 AND alias_value = $2
      LIMIT 1`,
    [ALIAS_TYPE_MASTER_LONG, rawId]
  );
  if (found.rowCount && found.rowCount > 0) {
    return found.rows[0]!.uuid;
  }

  // Mint and persist. Use INSERT ... ON CONFLICT DO NOTHING + re-SELECT to
  // make this race-safe: a concurrent request may have inserted concurrently.
  // The UUID must be deterministic from rawId so that webhook-side alias
  // resolution matches `lib/auth.ts → toUuid` (which the page side uses
  // when coercing the cookie value). Without determinism, the webhook
  // and the page can land on different accounts for the same Main Station
  // user — see the 2026-07-23 regression incident.
  const fresh = seedUuid(rawId);
  await pool.query(
    `INSERT INTO public.user_alias (alias_type, alias_value, uuid)
     VALUES ($1, $2, $3)
     ON CONFLICT (alias_type, alias_value) DO NOTHING`,
    [ALIAS_TYPE_MASTER_LONG, rawId, fresh]
  );
  const reread = await pool.query<{ uuid: string }>(
    `SELECT uuid FROM public.user_alias
      WHERE alias_type = $1 AND alias_value = $2
      LIMIT 1`,
    [ALIAS_TYPE_MASTER_LONG, rawId]
  );
  if (reread.rowCount && reread.rowCount > 0) {
    return reread.rows[0]!.uuid;
  }
  // Should be impossible — fall back to the freshly minted value.
  return fresh;
}

// ── Audit log ───────────────────────────────────────────────────────────────

export async function insertAuditLog(
  route: string,
  action: string,
  operatorId: string,
  targetUserId: string,
  ipAddress: string | null,
  fieldName: string | null = null,
  oldValue: string | null = null,
  newValue: string | null = null
): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(
    `INSERT INTO public.admin_audit_log
       (route, action, operator_id, target_user_id, ip_address, field_name, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [route, action, operatorId, targetUserId, ipAddress, fieldName, oldValue, newValue]
  );
}

// ── Webhook audit ────────────────────────────────────────────────────────────
//
// Mirrors admin_audit_log but tailored to the webhook payload shape. See
// supabase/migrations/15_webhook_audit_table.sql for the table schema.
//
// Called async (fire-and-forget) from lib/auditLog.ts → logWebhookEvent().
// Errors are logged but never block the webhook response — the table is
// for diagnostics, not for the hot path.

export interface WebhookAuditInput {
  txId?: string | null;
  actionType?: string | null;
  userId?: string | null;
  rawUserId?: string | null;
  clientIp: string;
  durationMs?: number | null;
  httpStatus?: number | null;
  success: boolean;
  result?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  rawBody?: string | null;        // capped to 8KB by caller before insertion
}

const RAW_BODY_CAP = 8192;

export async function insertWebhookAudit(input: WebhookAuditInput): Promise<void> {
  const pool = getPostgresPool();
  const rawBody =
    input.rawBody && input.rawBody.length > RAW_BODY_CAP
      ? input.rawBody.slice(0, RAW_BODY_CAP) + '...[truncated]'
      : input.rawBody ?? null;
  await pool.query(
    `INSERT INTO public.webhook_audit
       (tx_id, action_type, user_id, raw_user_id, client_ip, duration_ms,
        http_status, success, result, error_code, error_message, raw_body)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      input.txId ?? null,
      input.actionType ?? null,
      input.userId ?? null,
      input.rawUserId ?? null,
      input.clientIp,
      input.durationMs ?? null,
      input.httpStatus ?? null,
      input.success,
      input.result ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      rawBody,
    ]
  );
}

// ── Attack persistence (atomic transaction) ──────────────────────────────────
//
// REPARK 7.0 — P0 2026-08-30 (Batch D1-R1, feedback #76 / #85 follow-up):
//
// The previous attack route ran four independent `pool.query()` statements
// inside a `Promise.all` with NO surrounding transaction. PostgreSQL's
// auto-commit semantics meant each statement was its own transaction:
//   - user_inventory.total_damage_dealt (global lifetime)
//   - user_activity_stats.total_damage    (per-activity)
//   - attack_logs                         (immutable audit trail)
//   - boss_status                         (CAS-guarded HP update)
// could each commit independently of the others. If the per-activity
// statement failed (FK 23503, transient error) after the global one had
// already committed, the two stores drifted apart — the user appeared to
// have damage in `user_inventory` (lifetime) but NOT in
// `user_activity_stats` (current activity), producing the exact #76 / #85
// symptoms.
//
// D1-R1 fix: `persistAttackTransactionally()` wraps all FOUR sibling
// PG writes (damage + activity damage + attack log + ensure parent user
// row) in a single BEGIN/COMMIT transaction, so partial commit is
// impossible. Boss HP persistence stays in its separate helper
// (`updateBossStatus`) due to its own retry logic and Redis cache warm;
// its failure mode is preserved as-is to keep blast radius minimal.
//
// Invariant (proved by code path, not just by convention):
//   global damage committed ∧ activity damage failed  ⇒  impossible
//   activity damage committed ∧ global damage failed  ⇒  impossible
//   inventory committed ∧ attack log missing          ⇒  impossible
//
// REPARK 7.0 (2026-09-22) — Activity-Scoped Inventory:
// The inventory DECREMENT is now folded into this transaction (step 5).
// This closes the previous compensation inconsistency where the item was
// consumed from user_inventory OUTSIDE the transaction, so a PG write
// failure would leave the player with fewer items but no recorded damage.

export interface AttackPersistenceInput {
  userId: string;
  /** 0 when no activity is currently active — global damage still written. */
  activityId: number;
  /** activityId for the item decrement. Must match activityId when active; 0 skips. */
  inventoryActivityId: number;
  itemUsed: 'item_hand' | 'item_phallus';
  damageDealt: number;
}

export interface AttackPersistenceResult {
  /** True iff an active activity was provided and the per-activity damage row was written. */
  wroteActivityStats: boolean;
  /** True iff the activity-scoped item was successfully decremented. */
  inventoryDecremented: boolean;
}

export async function persistAttackTransactionally(
  input: AttackPersistenceInput
): Promise<AttackPersistenceResult> {
  const pool = getPostgresPool();
  const client = await pool.connect();

  // Defensive: clamp damage to non-negative so a hostile or buggy caller
  // cannot REVERSE a player's damage via a negative deltas. The route
  // already clamps at calculateDamage(), but defence-in-depth.
  const safeDamage = Math.max(0, Math.floor(Number(input.damageDealt) || 0));
  const userId = input.userId;

  try {
    await client.query('BEGIN');

    // 1. Ensure parent user row (FK target for user_inventory,
    //    user_activity_stats, attack_logs). Idempotent via ON CONFLICT
    //    DO NOTHING — a pre-existing row from a prior session is left
    //    untouched and is NOT affected by the eventual ROLLBACK below.
    await client.query(
      `INSERT INTO public.users (id, nickname, avatar)
       VALUES ($1, '', '👤')
       ON CONFLICT (id) DO NOTHING`,
      [userId]
    );

    // 2. Global lifetime damage (user_inventory).
    await client.query(
      `INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
       VALUES ($1, 0, 0, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         total_damage_dealt = public.user_inventory.total_damage_dealt + EXCLUDED.total_damage_dealt,
         updated_at = NOW()`,
      [userId, safeDamage]
    );

    // 3. Per-activity damage (user_activity_stats). Skipped when no
    //    activity is currently active — global damage still advances so
    //    the player keeps their lifetime counter.
    let wroteActivityStats = false;
    if (input.activityId > 0) {
      await client.query(
        `INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, activity_id) DO UPDATE SET
           total_damage = public.user_activity_stats.total_damage + EXCLUDED.total_damage,
           updated_at = NOW()`,
        [userId, input.activityId, safeDamage]
      );
      wroteActivityStats = true;
    }

    // 4. Activity-scoped item decrement (user_activity_inventory).
    // Only performed when a valid inventoryActivityId is provided.
    // STRICT conditional decrement: rowCount=0 if count==0 → fail the entire
    // transaction (no global damage, no activity damage, no log).
    let inventoryDecremented = false;
    if (input.inventoryActivityId > 0) {
      const invColumn = input.itemUsed === 'item_hand' ? 'item_hand_count' : 'item_phallus_count';
      const invDecrement = await client.query<{ [k: string]: number }>(
        `UPDATE public.user_activity_inventory
            SET ${invColumn} = ${invColumn} - 1,
                updated_at = NOW()
          WHERE user_id = $1
            AND activity_id = $2
            AND ${invColumn} > 0
          RETURNING ${invColumn}`,
        [userId, input.inventoryActivityId],
      );
      inventoryDecremented = (invDecrement.rowCount ?? 0) > 0;
    } else {
      // No active activity: attacks are free (no item consumption)
      inventoryDecremented = true;
    }

    // 5. Attack log (immutable audit trail). Only inserted when the inventory
    //    decrement succeeded. Prevents the previous "damage present, log missing"
    //    and "log present, inventory missing" drift bugs.
    if (inventoryDecremented) {
      await client.query(
        `INSERT INTO public.attack_logs (user_id, item_used, damage_dealt)
         VALUES ($1, $2, $3)`,
        [userId, input.itemUsed, safeDamage]
      );
    } else {
      // Force rollback by throwing — no damage, no log, no inventory consumption.
      throw new Error('INSUFFICIENT_ITEM');
    }

    await client.query('COMMIT');
    return { wroteActivityStats, inventoryDecremented };
  } catch (err) {
    // ROLLBACK is best-effort: if the connection is already broken,
    // `.catch(() => undefined)` swallows the error and we still surface
    // the original failure to the caller.
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ── Badge catalog (Phase 1: MVP, Phase 2: CRUD) ──────────────────────────────
//
// REPARK Phase 1: minimal read-only helpers to back the admin MilestoneCard
// badge-ID preview (`/api/admin/badge/[id]`) and the listing endpoint
// (`/api/admin/badge`).
//
// REPARK Phase 2 (2026-09-02): full CRUD surface for the badge admin page.
//
// Design contract:
//   - `getBadgeById(id)` accepts both numeric and numeric-string IDs. The
//     admin UI stores `medalId` as a string in `activity.config.milestones`,
//     so callers pass strings; the route normalises to a number before
//     sending. We coerce defensively in the helper itself so a future
//     caller that forgets to normalise still gets correct behaviour.
//   - `is_active=true` is required for `getBadgeById` so a "deleted"
//     (soft-deleted) badge stops previewing immediately without losing the
//     historical reward_value rows that referenced it.
//   - `listBadges` returns ALL badges (active + inactive) so the admin can
//     audit deactivated ones. Sort: active first, then id ascending.
//   - Phase 2 adds: `createBadge`, `updateBadge`, `deactivateBadge`,
//     `activateBadge`, `isBadgeNameUnique`. IDs are BIGSERIAL auto-assigned
//     (admin cannot edit). Delete policy: SOFT ONLY — `is_active=false`
//     preserved indefinitely. NO hard DELETE FROM is permitted.

export interface BadgeRow {
  id: number;
  name: string;
  thumbnail: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BadgeCreateInput {
  name: string;
  thumbnail: string;
  description?: string;
  is_active?: boolean;
}

export interface BadgeUpdatePatch {
  name?: string;
  thumbnail?: string;
  description?: string;
  is_active?: boolean;
}

function coerceBadgeId(raw: string | number): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.trunc(raw) : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
    // Reject scientific notation / leading zeros only after coercion —
    // Number('1e3') = 1000 which would silently change semantics.
    // Strict regex guards against that.
    if (!/^-?\d+$/.test(trimmed)) return null;
    return n;
  }
  return null;
}

export async function getBadgeById(id: string | number): Promise<BadgeRow | null> {
  const numericId = coerceBadgeId(id);
  if (numericId === null) return null;

  const pool = getPostgresPool();
  const result = await pool.query<BadgeRow>(
    `SELECT id, name, thumbnail, description, is_active, created_at, updated_at
       FROM public.badges
      WHERE id = $1 AND is_active = true
      LIMIT 1`,
    [numericId]
  );
  return result.rows[0] ?? null;
}

export async function listBadges(): Promise<BadgeRow[]> {
  const pool = getPostgresPool();
  const result = await pool.query<BadgeRow>(
    `SELECT id, name, thumbnail, description, is_active, created_at, updated_at
       FROM public.badges
      ORDER BY is_active DESC, id ASC`
  );
  return result.rows;
}

// ── Phase 2 CRUD helpers ──────────────────────────────────────────────────────
//
// Phase 2 (2026-09-02) badge admin page CRUD surface. All helpers are thin
// wrappers — validation lives in the route layer so the DB layer stays
// permissive enough for future batch/import jobs to reuse it.

/**
 * Create a new badge row. ID is BIGSERIAL auto-assigned.
 * Throws on DB error — caller surfaces as 500.
 */
export async function createBadge(input: BadgeCreateInput): Promise<BadgeRow> {
  const pool = getPostgresPool();
  const result = await pool.query<BadgeRow>(
    `INSERT INTO public.badges (name, thumbnail, description, is_active)
     VALUES ($1, $2, $3, COALESCE($4, true))
     RETURNING id, name, thumbnail, description, is_active, created_at, updated_at`,
    [
      input.name,
      input.thumbnail,
      input.description ?? '',
      input.is_active ?? true,
    ]
  );
  return result.rows[0];
}

/**
 * Partial update of a badge. Returns the updated row, or null if the ID
 * does not exist. Empty patch is a no-op that returns the current row.
 */
export async function updateBadge(
  id: number,
  patch: BadgeUpdatePatch,
): Promise<BadgeRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(patch.name);
  }
  if (patch.thumbnail !== undefined) {
    fields.push(`thumbnail = $${idx++}`);
    values.push(patch.thumbnail);
  }
  if (patch.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(patch.description);
  }
  if (patch.is_active !== undefined) {
    fields.push(`is_active = $${idx++}`);
    values.push(patch.is_active);
  }

  if (fields.length === 0) {
    // No-op patch — return current row.
    return getBadgeById(id);
  }

  values.push(id);
  const pool = getPostgresPool();
  const result = await pool.query<BadgeRow>(
    `UPDATE public.badges
        SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING id, name, thumbnail, description, is_active, created_at, updated_at`,
    values
  );
  return result.rows[0] ?? null;
}

/**
 * Soft-delete: flip is_active=false. Returns true if a row was updated.
 * Idempotent — calling on an already-inactive badge returns true.
 */
export async function deactivateBadge(id: number): Promise<boolean> {
  const pool = getPostgresPool();
  const result = await pool.query(
    `UPDATE public.badges
        SET is_active = false
      WHERE id = $1 AND is_active = true`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Re-activate a soft-deleted badge. Returns true if a row was updated.
 */
export async function activateBadge(id: number): Promise<boolean> {
  const pool = getPostgresPool();
  const result = await pool.query(
    `UPDATE public.badges
        SET is_active = true
      WHERE id = $1 AND is_active = false`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Check whether `name` is unique among ACTIVE badges.
 * Pass `excludeId` when editing an existing badge (so it doesn't conflict
 * with itself). Case-sensitive trim-aware comparison.
 */
export async function isBadgeNameUnique(
  name: string,
  excludeId?: number,
): Promise<boolean> {
  const pool = getPostgresPool();
  if (excludeId !== undefined) {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM public.badges
        WHERE name = $1 AND id <> $2 AND is_active = true`,
      [name, excludeId]
    );
    return parseInt(result.rows[0]?.count ?? '0', 10) === 0;
  }
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM public.badges
      WHERE name = $1 AND is_active = true`,
    [name]
  );
  return parseInt(result.rows[0]?.count ?? '0', 10) === 0;
}