/**
 * PostgreSQL-backed user store — REPLACES both the old fs-based
 * `mockUserDb.ts` (read/write of `mock_db_users.json`) and the
 * Supabase-based `app/api/admin/activity/update/userDb.ts`.
 *
 * Serverless filesystems cannot host writable mock DBs and the
 * Supabase SaaS project has been decommissioned — every read/write
 * now goes to AWS RDS via `lib/db/pg.ts`.
 *
 * Public surface (kept compatible with old callers):
 *   - getUserById(userId)
 *   - listUsers(options)
 *   - updateUserInventory(userId, propA?, propB?)
 *   - getComputedTotalDamage(userId)
 *   - getUserMilestones(userId, _activityId)
 *   - findUser(userId)           ← kept for backward compat
 *   - claimMilestone(userId, id) ← kept for backward compat
 *   - isMilestoneClaimed(userId, id)
 *   - claimDailyTask(userId, type)
 *   - updateUserTaskProgress(userId, type, amount)
 *   - incrementTotalDamage(userId, damage)
 *   - getMilestoneClaims(userId)
 *
 * All functions are async. Throws on DB error — callers handle 500.
 */

import {
  getUserInventory as pgGetUserInventory,
  getMilestoneReward as pgGetMilestoneReward,
  getMilestoneRewards as pgGetMilestoneRewards,
  upsertMilestoneReward,
  upsertUserInventory,
  incrementUserDamage,
  computeUserTotalDamage,
  type UserInventoryRow,
  type MilestoneRewardRow,
} from '@/lib/db/pg';

// ── Public Types (frontend contract) ───────────────────────────────────────

export interface UserInventory {
  propA: number;
  propB: number;
}

export type UserStatus = 'normal' | 'banned';

export interface UserItem {
  id: string;
  email: string;
  nickname: string;
  avatar: string;
  inventory: UserInventory;
  totalDamage: number;
  status: UserStatus;
  lastLogin: string;
  createdAt: string;
  milestone_claims: Record<string, string[]>;
}

export interface UserListOptions {
  search?: string;
  limit?: number;
}

export interface DailyTasks {
  consumeProgress: number;
  rechargeProgress: number;
  consumeClaimed: boolean;
  rechargeClaimed: boolean;
}

// ── Translation helpers ─────────────────────────────────────────────────────

function inventoryToUserItem(
  inv: Partial<UserInventoryRow> | null,
  userId: string,
  milestoneClaims: Record<string, string[]>
): UserItem {
  return {
    id: userId,
    email: '',
    nickname: '',
    avatar: '👤',
    inventory: {
      propA: inv?.item_hand_count ?? 0,
      propB: inv?.item_phallus_count ?? 0,
    },
    totalDamage: Number(inv?.total_damage_dealt ?? 0),
    status: 'normal',
    lastLogin: inv?.updated_at ?? inv?.created_at ?? new Date().toISOString(),
    createdAt: inv?.created_at ?? new Date().toISOString(),
    milestone_claims: milestoneClaims,
  };
}

function milestoneRowsToClaims(
  rows: MilestoneRewardRow[]
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    const key = String(r.milestone_id);
    if (!map[key]) map[key] = [];
    if (r.is_claimed) map[key].push(key);
  }
  return map;
}

// ── Public reads ────────────────────────────────────────────────────────────

export async function listUsers(options: UserListOptions = {}): Promise<UserItem[]> {
  // In this schema users are virtual — backed by `user_inventory`. We expose
  // distinct user_ids from the inventory + attack_logs joined with public.users.
  const { getPostgresPool } = await import('@/lib/db/postgres');
  const pool = getPostgresPool();
  const limit = options.limit ?? 1000;
  const result = await pool.query<{
    id: string;
    item_hand_count: number;
    item_phallus_count: number;
    total_damage_dealt: number;
    updated_at: string;
    created_at: string;
  }>(
    `SELECT user_id AS id, item_hand_count, item_phallus_count, total_damage_dealt, updated_at, created_at
       FROM public.user_inventory
      ORDER BY total_damage_dealt DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
  let rows = result.rows;
  if (options.search) {
    const q = options.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((u) => u.id.toLowerCase().includes(q));
    }
  }
  return rows.map((row) =>
    inventoryToUserItem(row, row.id, {})
  );
}

export async function getUserById(userId: string): Promise<UserItem | null> {
  const inv = await pgGetUserInventory(userId);
  if (!inv) return null;
  const milestones = await pgGetMilestoneRewards(userId);
  return inventoryToUserItem(inv, userId, milestoneRowsToClaims(milestones));
}

export async function findUser(userId: string): Promise<UserItem | null> {
  return await getUserById(userId);
}

export async function getComputedTotalDamage(userId: string): Promise<number> {
  return await computeUserTotalDamage(userId);
}

export async function getUserMilestones(
  userId: string,
  _activityId: number
): Promise<Record<string, { is_claimed: boolean; is_locked: boolean; claimed_at: string | null }>> {
  const rows = await pgGetMilestoneRewards(userId);
  const result: Record<string, { is_claimed: boolean; is_locked: boolean; claimed_at: string | null }> = {};
  for (const row of rows) {
    result[String(row.milestone_id)] = {
      is_claimed: row.is_claimed,
      is_locked: row.is_locked,
      claimed_at: row.claimed_at,
    };
  }
  return result;
}

// ── Public writes ───────────────────────────────────────────────────────────

export async function updateUserInventory(
  userId: string,
  propA: number | null,
  propB: number | null
): Promise<boolean> {
  try {
    await upsertUserInventory(
      userId,
      propA !== null ? propA : undefined,
      propB !== null ? propB : undefined
    );
    return true;
  } catch {
    return false;
  }
}

export async function incrementTotalDamage(
  userId: string,
  damage: number
): Promise<boolean> {
  try {
    await incrementUserDamage(userId, damage);
    return true;
  } catch {
    return false;
  }
}

export async function getMilestoneClaims(userId: string): Promise<string[]> {
  const rows = await pgGetMilestoneRewards(userId);
  return rows.filter((r) => r.is_claimed).map((r) => String(r.milestone_id));
}

export async function isMilestoneClaimed(
  userId: string,
  milestoneId: number | string
): Promise<boolean> {
  const row = await pgGetMilestoneReward(userId, Number(milestoneId));
  return Boolean(row?.is_claimed);
}

export async function claimMilestone(
  userId: string,
  milestoneId: number | string
): Promise<'ok' | 'user_not_found' | 'already_claimed' | 'save_failed'> {
  const id = Number(milestoneId);
  const existing = await pgGetMilestoneReward(userId, id);
  if (!existing) {
    // No inventory row means user doesn't exist in this schema. We allow
    // claiming without an inventory check (claim is per milestone).
  }
  if (existing?.is_claimed) {
    return 'already_claimed';
  }
  try {
    await upsertMilestoneReward({
      user_id: userId,
      milestone_id: String(id),
      is_claimed: true,
      is_locked: false,
      claimed_at: new Date().toISOString(),
      reward_type: null,
      reward_value: null,
    });
    return 'ok';
  } catch {
    return 'save_failed';
  }
}

// ── Daily task helpers (used by webhook + task-claim) ──────────────────────

import { getDailyTask, incrementDailyTask } from '@/lib/db/pg';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

function getTodayUtc8(): string {
  return dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
}

export async function getTaskProgressRedis(
  userId: string,
  type: 'consume' | 'recharge'
): Promise<number> {
  const date = getTodayUtc8();
  const row = await getDailyTask(userId, date).catch(() => null);
  if (!row) return 0;
  return type === 'consume'
    ? Number(row.daily_energy_consumed ?? 0)
    : Number(row.daily_money_recharged ?? 0);
}

export async function incrementTaskRedis(
  userId: string,
  type: 'consume' | 'recharge',
  amount: number
): Promise<number | null> {
  const date = getTodayUtc8();
  return await incrementDailyTask(
    userId,
    date,
    type,
    amount
  );
}

export async function claimDailyTask(
  userId: string,
  _taskType: 'consume' | 'recharge'
): Promise<boolean> {
  // In the new schema, daily-task claiming is tracked in `user_inventory`
  // by incrementing item counts. For now we mark the day as claimed via
  // a synthetic milestone_rewards row keyed on user+date.
  const date = getTodayUtc8();
  const id = -1 * Number(dayjs(date).diff(dayjs('1970-01-01'), 'day')); // synthetic
  const existing = await pgGetMilestoneReward(userId, id).catch(() => null);
  if (existing?.is_claimed) return false;
  try {
    await upsertMilestoneReward({
      user_id: userId,
      milestone_id: String(id),
      is_claimed: true,
      is_locked: false,
      claimed_at: new Date().toISOString(),
      reward_type: `daily_task:${_taskType}`,
      reward_value: date,
    });
    return true;
  } catch {
    return false;
  }
}

export async function updateUserTaskProgress(
  userId: string,
  type: 'consume' | 'recharge',
  amount: number
): Promise<boolean> {
  try {
    await incrementDailyTask(
      userId,
      getTodayUtc8(),
      type,
      amount
    );
    return true;
  } catch {
    return false;
  }
}