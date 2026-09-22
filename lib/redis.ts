import Redis from 'ioredis';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

// Identity Flow Patch — battle-path Redis primitives (singleton client,
// REDIS_KEYS, ATOMIC_ATTACK_LUA, atomicAttack, warmBossCacheFromDb) were
// moved to @/lib/battleRedis.ts on 2026-09-01. Re-exported here for
// backward compatibility with all existing call sites that still import
// from @/lib/redis (DB helpers, battle routes, admin routes, webhook handlers).
import { getRedisClient, REDIS_KEYS, atomicAttack, warmBossCacheFromDb } from './battleRedis';
export { getRedisClient, REDIS_KEYS, atomicAttack, warmBossCacheFromDb };
export type { AtomicAttackResult } from './battleRedis';

dayjs.extend(utc);
dayjs.extend(timezone);

export const BOSS_HP_ATOMIC_LUA = `
local current_hp = tonumber(redis.call("GET", KEYS[1]))

if (current_hp == nil) or (current_hp <= 0) then
  return {0, 0}
end

local damage = tonumber(ARGV[1])
local new_hp = current_hp - damage
local actual_damage = damage

if new_hp < 0 then
  new_hp = 0
  actual_damage = current_hp
end

redis.call("SET", KEYS[1], new_hp)

return {actual_damage, new_hp}
`;

export async function applyBossDamageAtomic(redisKey: string, damage: number) {
  const redis = getRedisClient();
  const result = (await redis.eval(BOSS_HP_ATOMIC_LUA, 1, redisKey, damage)) as [number, number];
  return {
    actualDamage: Number(result?.[0] ?? 0),
    newHp: Number(result?.[1] ?? 0),
  };
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function getBossHpFromCache(): Promise<number | null> {
  try {
    const redis = getRedisClient();
    const hp = await redis.get(REDIS_KEYS.BOSS_HP);
    return hp !== null ? parseInt(hp, 10) : null;
  } catch {
    return null;
  }
}

export async function getBossHpAndMaxFromCache(): Promise<{ currentHp: number | null; maxHp: number | null }> {
  try {
    const redis = getRedisClient();
    const [currentHp, maxHp] = await redis.mget(REDIS_KEYS.BOSS_HP, REDIS_KEYS.BOSS_MAX_HP);
    return {
      currentHp: currentHp !== null ? parseInt(currentHp, 10) : null,
      maxHp: maxHp !== null ? parseInt(maxHp, 10) : null,
    };
  } catch {
    return { currentHp: null, maxHp: null };
  }
}

export async function setBossHpInCache(hp: number): Promise<void> {
  const redis = getRedisClient();
  await redis.set(REDIS_KEYS.BOSS_HP, hp);
}

export async function checkRateLimit(userId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = REDIS_KEYS.rateLimit(userId);
  const exists = await redis.exists(key);
  return exists === 1;
}

// ════════════════════════════════════════════════════════════════════════════════
// ACTIVITY CONFIG CACHE
// ════════════════════════════════════════════════════════════════════════════════

export interface ActivityConfig {
  activityEnabled: boolean;
  activityName: string;
  startTime: string;
  endTime: string;
  rules: string;
  bossMaxHp: number;
  attackDamageMin: number;
  attackDamageMax: number;
  countdownEndDate: string;
  stages: {
    stage1Threshold: number;
    stage2Threshold: number;
    stage3Threshold: number;
    stage4Threshold: number;
  };
  milestones: Array<{
    id: number;
    hp_threshold: number;
    name: string;
    emoji: string;
  }>;
  updatedAt?: string;
}

export async function loadActivityConfig(): Promise<ActivityConfig | null> {
  try {
    const redis = getRedisClient();
    const data = await redis.get(REDIS_KEYS.CONFIG);
    if (data) {
      return JSON.parse(data) as ActivityConfig;
    }
  } catch {
    // Redis unavailable
  }
  return null;
}

export async function saveActivityConfig(config: ActivityConfig): Promise<void> {
  const redis = getRedisClient();
  await redis.set(REDIS_KEYS.CONFIG, JSON.stringify(config));
}

// ════════════════════════════════════════════════════════════════════════════════
// WEBHOOK REPLAY PROTECTION
// ════════════════════════════════════════════════════════════════════════════════

const WEBHOOK_PROCESSED_TTL = 600; // 10 minutes

/**
 * Checks if a webhook event has already been processed.
 * Uses Redis SET NX for atomic check-and-set.
 *
 * @param eventId - Unique event identifier (e.g., tx_id)
 * @returns true if already processed (duplicate), false if new
 */
export async function isWebhookProcessed(eventId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const key = REDIS_KEYS.webhookProcessed(eventId);
    const exists = await redis.exists(key);
    return exists === 1;
  } catch {
    // Redis unavailable - fail open but log warning
    console.warn('[WEBHOOK] Redis unavailable for duplicate check, allowing request');
    return false;
  }
}

/**
 * Marks a webhook event as processed.
 * Uses Redis SETEX for atomic set with TTL.
 *
 * @param eventId - Unique event identifier
 * @returns true if marked successfully, false if already exists
 */
export async function markWebhookProcessed(eventId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const key = REDIS_KEYS.webhookProcessed(eventId);
    // SETNX with TTL - only succeeds if key doesn't exist
    const result = await redis.set(key, '1', 'EX', WEBHOOK_PROCESSED_TTL, 'NX');
    return result === 'OK';
  } catch {
    console.error('[WEBHOOK] Failed to mark webhook as processed');
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// DAILY RESET — Redis Key-Spacing Pattern (FIX P-04)
// ════════════════════════════════════════════════════════════════════════════════
//
// Key format: user:{user_id}:tasks:{YYYYMMDD}
// Example: user:abc123:tasks:20260513
//
// All keys expire at midnight UTC+8 (20:00 UTC).
// Redis TTL handles automatic cleanup — no cron needed for the Redis layer.
//
// On first request of the day, we create the key with TTL.
// On subsequent requests, we just INCR the existing key.
//
// For the Supabase/PostgreSQL layer, pg_cron should call reset_daily_tasks() at 00:00 UTC+8.
// See: app/api/admin/user/reset/route.ts
//

const _DAILY_KEY_TTL_SECONDS = 24 * 60 * 60; // 24 hours in seconds
// Calculate seconds until midnight UTC+8 from now
function secondsUntilMidnightUtc8(): number {
  // FIX M-1: previously this used Date#getTimezoneOffset() which reflects the
  // host's local offset (UTC on Vercel/AWS, CST on a dev machine). That made
  // the daily reset TTL drift by hours across deployments and could collide
  // with a still-live key from the previous day on roll-over.
  //
  // We now compute the TTL against an explicit Asia/Shanghai timezone anchor
  // — the daily reset is a calendar boundary for the activity region, not for
  // the server. The result is host-agnostic and matches the activity clock
  // every player actually sees in the TopNav countdown.
  const nowUtc8 = dayjs().tz('Asia/Shanghai');
  const nextMidnightUtc8 = nowUtc8.add(1, 'day').startOf('day');
  const diffSeconds = nextMidnightUtc8.diff(nowUtc8, 'second');
  return Math.max(1, diffSeconds);
}

function getTodayKey(date?: Date): string {
  const d = date ?? new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Initializes the daily reset system.
 * Call once at server startup (via /api/internal/startup).
 *
 * This creates the daily task key for today with proper TTL,
 * so Redis auto-expires old task keys.
 *
 * @returns The TTL in seconds set for today's key
 */
export async function initDailyReset(): Promise<number> {
  try {
    const redis = getRedisClient();
    const todayKey = `daily:init:${getTodayKey()}`;
    const ttl = secondsUntilMidnightUtc8();
    // SET with NX — only creates if not exists
    const result = await redis.set(todayKey, '1', 'EX', ttl);
    if (result === 'OK') {
      console.log(`[DAILY-RESET] Initialized today key "${todayKey}" with TTL=${ttl}s`);
    } else {
      console.log(`[DAILY-RESET] Today key "${todayKey}" already exists`);
    }
    return ttl;
  } catch (err) {
    console.error('[DAILY-RESET] Failed to initialize daily reset:', err);
    return 0;
  }
}

/**
 * Increments a user's daily task progress in Redis with automatic TTL.
 *
 * Key format: user:{user_id}:tasks:{YYYYMMDD}
 * TTL: Seconds until midnight UTC+8 (auto-expires at 00:00)
 *
 * @param userId - The user ID
 * @param field  - 'consume' or 'recharge'
 * @param amount - Amount to add
 * @returns The new value after increment
 */
export async function incrementDailyTask(
  userId: string,
  field: 'consume' | 'recharge',
  amount: number
): Promise<number> {
  try {
    const redis = getRedisClient();
    const today = getTodayKey();
    const key = `user:${userId}:tasks:${today}`;
    const ttl = secondsUntilMidnightUtc8();

    // HINCRBY on a hash field with TTL
    // We use a separate "expiry tracker" key to manage TTL
    const _trackerKey = `${key}:updated`;
    const ttlKey = `${key}:ttl:${today}`;

    // Atomic: increment field in hash, set TTL on tracker
    const pipeline = redis.pipeline();
    pipeline.hincrby(key, field, amount);
    pipeline.setex(ttlKey, ttl, '1');
    const results = await pipeline.exec();

    if (results) {
      const incrResult = results[0];
      if (incrResult && !incrResult[0]) {
        return Number(incrResult[1]);
      }
    }
    return 0;
  } catch (err) {
    console.error('[DAILY-RESET] Failed to increment daily task:', err);
    return 0;
  }
}

/**
 * Gets a user's daily task progress from Redis.
 * Returns null if no progress recorded today.
 */
export async function getDailyTaskProgress(
  userId: string,
  field: 'consume' | 'recharge'
): Promise<number | null> {
  try {
    const redis = getRedisClient();
    const today = getTodayKey();
    const key = `user:${userId}:tasks:${today}`;
    const value = await redis.hget(key, field);
    return value !== null ? parseInt(value, 10) : null;
  } catch {
    return null;
  }
}
