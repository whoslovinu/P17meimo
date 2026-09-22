import { NextResponse } from 'next/server';
import {
  getRedisClient,
  REDIS_KEYS,
  atomicAttack,
  warmBossCacheFromDb,
} from '@/lib/redis';
import {
  getActiveActivity,
  getActivityInventory,
  getUserInventory,
  getBossStatus,
  updateBossStatus,
  persistAttackTransactionally,
  ensureActivityInventoryExists,
  resolveAliasToUuid,
} from '@/lib/db/pg';
import { getPostgresPool } from '@/lib/db/postgres';
import { getUserIdFromRequest } from '@/lib/auth';

// ════════════════════════════════════════════════════════════════════════════════
// ATTACK API - Atomic Battle System
// REPARK 7.0 (2026-09-22): Activity-scoped item inventory
//
// Single code path for dev and prod:
//   Redis Lua = attack/idempotency source of truth
//   PostgreSQL = persistent store for HP, damage, attack_logs, activity inventory
// ════════════════════════════════════════════════════════════════════════════════

type AttackItemType = 'item_hand' | 'item_phallus';

interface AttackRequest {
  item_type: AttackItemType;
  nonce: string;
}

interface AttackResponse {
  ok: true;
  data: {
    item_type: AttackItemType;
    actual_damage: number;
    new_hp: number;
    total_damage: number;
    return_code: number;
    actualDamage: number;
    newHp: number;
    totalDamage: number;
    returnCode: number;
  };
}

interface AttackError {
  ok: false;
  error: { code: string; message: string };
}

function isAttackRequest(payload: unknown): payload is AttackRequest {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  return (
    (record.item_type === 'item_hand' || record.item_type === 'item_phallus') &&
    typeof record.nonce === 'string' &&
    record.nonce.length > 0 &&
    record.nonce.length <= 64
  );
}

interface DamageRow {
  minDamage: number;
  maxDamage: number;
  probability: number;
}

function pickDamageRow(rows: DamageRow[]): { minDamage: number; maxDamage: number } {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.probability;
    if (rand < cumulative) return { minDamage: row.minDamage, maxDamage: row.maxDamage };
  }
  const last = rows[rows.length - 1];
  return { minDamage: last?.minDamage ?? 1, maxDamage: last?.maxDamage ?? 5 };
}

/**
 * Calculate damage for the given item using the ACTIVE activity's config.
 * The activity is resolved once per request and passed in — never re-read mid-attack.
 */
function calculateDamageFromConfig(
  itemType: AttackItemType,
  active: { id: number; config: Record<string, unknown> | null } | null,
): number {
  if (!active) {
    return itemType === 'item_hand' ? 10 + Math.floor(Math.random() * 6) : 25 + Math.floor(Math.random() * 6);
  }
  try {
    const items = (active.config as Record<string, unknown> | undefined)?.items as
      | Record<string, unknown>
      | undefined;
    const tier = itemType === 'item_hand' ? items?.propA : items?.propB;
    const tierObj = (tier && typeof tier === 'object') ? (tier as Record<string, unknown>) : null;
    const rows = tierObj?.rows as DamageRow[] | undefined;
    if (Array.isArray(rows) && rows.length > 0) {
      const { minDamage, maxDamage } = pickDamageRow(rows);
      return minDamage + Math.floor(Math.random() * (maxDamage - minDamage + 1));
    }
  } catch {
    // fall through to fallback
  }
  return itemType === 'item_hand' ? 10 + Math.floor(Math.random() * 6) : 25 + Math.floor(Math.random() * 6);
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════════════════

export async function POST(req: Request) {
  const startTime = Date.now();
  console.log('[ATTACK] Processing attack request');

  try {
    // STEP 1: Auth
    const authResult = getUserIdFromRequest(req);
    if (!authResult) {
      return NextResponse.json(
        { ok: false, error: { code: 'UNAUTHORIZED', message: '请先登录后再访问' } } as AttackError,
        { status: 401 }
      );
    }
    const userId = await resolveAliasToUuid(authResult.userId);
    console.log(`[ATTACK] User: ${userId} (raw=${authResult.userId}, source: ${authResult.source})`);

    // STEP 2: Validate body
    let payload: AttackRequest;
    try {
      const raw = await req.json();
      if (!isAttackRequest(raw)) {
        return NextResponse.json(
          { ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid item_type or nonce' } } as AttackError,
          { status: 400 }
        );
      }
      payload = raw;
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } } as AttackError,
        { status: 400 }
      );
    }

    // STEP 3: Warm Redis boss HP cache from PostgreSQL on cold start
    try {
      const redis = getRedisClient();
      const exists = await redis.exists(REDIS_KEYS.BOSS_HP);
      if (!exists) {
        const row = await getBossStatus();
        const currentHp = Number(row?.current_hp ?? 100000);
        const maxHp = Number(row?.max_hp ?? 100000);
        await warmBossCacheFromDb(currentHp, maxHp);
      }
    } catch (cacheErr) {
      console.warn('[ATTACK] Cache warm failed:', cacheErr);
    }

    // STEP 4: Resolve activity ONCE. Used for both damage calculation and
    // inventory operations. The activity cannot change mid-attack.
    let activeActivityId = 0;
    let activeActivity: { id: number; config: Record<string, unknown> | null } | null = null;
    let maxHpForWrite = 0;
    try {
      activeActivity = await getActiveActivity();
      if (activeActivity) {
        activeActivityId = activeActivity.id;
        const bossCfg = (activeActivity.config as { boss?: { maxHp?: number; totalHp?: number } } | undefined)?.boss;
        if (bossCfg && typeof bossCfg.maxHp === 'number' && bossCfg.maxHp > 0) {
          maxHpForWrite = bossCfg.maxHp;
        } else if (bossCfg && typeof bossCfg.totalHp === 'number' && bossCfg.totalHp > 0) {
          maxHpForWrite = bossCfg.totalHp;
        } else {
          const statusRow = await getBossStatus();
          maxHpForWrite = Number(statusRow?.max_hp ?? 0);
          if (!Number.isFinite(maxHpForWrite) || maxHpForWrite <= 0) {
            maxHpForWrite = 0;
          }
        }
      }
    } catch (cfgErr) {
      console.warn('[ATTACK] Activity lookup failed:', cfgErr);
    }

    // STEP 5: Calculate damage using the resolved activity config.
    const requestedDamage = calculateDamageFromConfig(payload.item_type, activeActivity);

    // STEP 6: Atomic Redis Lua — idempotency + rate-limit gate
    let luaResult;
    try {
      luaResult = await atomicAttack(userId, payload.nonce, requestedDamage);
    } catch (luaErr) {
      console.error('[ATTACK] Lua script failed:', luaErr);
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Redis operation failed' } } as AttackError,
        { status: 500 }
      );
    }

    switch (luaResult.returnCode) {
      case -1:
        return NextResponse.json(
          { ok: false, error: { code: 'DUPLICATE_ATTACK', message: 'Attack already processed' } } as AttackError,
          { status: 409 }
        );
      case -2:
        return NextResponse.json(
          { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many attacks, please wait' } } as AttackError,
          { status: 429 }
        );
      case 0:
        return NextResponse.json({
          ok: true,
          data: {
            item_type: payload.item_type,
            actual_damage: 0, new_hp: 0, total_damage: 0, return_code: 0,
            actualDamage: 0, newHp: 0, totalDamage: 0, returnCode: 0,
          },
        } as AttackResponse);
      case 1:
        break;
      default:
        return NextResponse.json(
          { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Unknown error' } } as AttackError,
          { status: 500 }
        );
    }

    // STEP 7: Activity-scoped inventory check.
    // REPARK 7.0 (2026-09-22): The transaction itself performs the conditional
    // decrement with `count > 0` guard, so a pre-check is not strictly needed.
    // We DO ensure the row exists here to avoid a not-found INSERT round-trip
    // during the transaction. Dev-only starter kit grants 3 of each item to
    // smoke users when their inventory is empty.
    if (activeActivityId > 0) {
      const inv = await getActivityInventory(userId, activeActivityId);
      const count = payload.item_type === 'item_hand'
        ? (inv?.item_hand_count ?? 0)
        : (inv?.item_phallus_count ?? 0);
      // Dev-only starter kit: brand-new users get 3/3 items on first attack.
      if (count === 0 && process.env.NODE_ENV !== 'production') {
        await ensureActivityInventoryExists(userId, activeActivityId);
        const pool = getPostgresPool();
        await pool.query(
          `UPDATE public.user_activity_inventory
              SET item_hand_count = 3,
                  item_phallus_count = 3,
                  updated_at = NOW()
            WHERE user_id = $1 AND activity_id = $2`,
          [userId, activeActivityId],
        );
        console.log(`[ATTACK] Dev starter kit granted to ${userId} for activity ${activeActivityId}`);
      }
    }

    // STEP 8: Persist atomically — single BEGIN/COMMIT for damage +
    // activity-scoped inventory decrement + attack log. The transaction
    // throws if the inventory count is 0 (INSUFFICIENT_ITEM), so partial
    // writes are impossible.
    let persistenceResult: { wroteActivityStats: boolean; inventoryDecremented: boolean } = {
      wroteActivityStats: false,
      inventoryDecremented: false,
    };
    try {
      persistenceResult = await persistAttackTransactionally({
        userId,
        // activityId: for user_activity_stats (damage ledger per activity)
        activityId: activeActivityId,
        // inventoryActivityId: for user_activity_inventory (item consumption)
        inventoryActivityId: activeActivityId,
        itemUsed: payload.item_type,
        damageDealt: luaResult.actualDamage,
      });
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      // Translate the transaction's INSUFFICIENT_ITEM rollback into a 400.
      if (msg === 'INSUFFICIENT_ITEM') {
        // Compensate Redis HP for the damage Lua already recorded.
        try {
          const redis = getRedisClient();
          await redis.incrby(REDIS_KEYS.BOSS_HP, luaResult.actualDamage);
        } catch {
          /* best-effort */
        }
        return NextResponse.json(
          { ok: false, error: { code: 'INSUFFICIENT_ITEM', message: 'Not enough items' } } as AttackError,
          { status: 400 }
        );
      }
      console.error('[ATTACK] Damage persistence FAILED:', dbErr);
      try {
        const redis = getRedisClient();
        await redis.incrby(REDIS_KEYS.BOSS_HP, luaResult.actualDamage);
      } catch {
        /* best-effort */
      }
      return NextResponse.json(
        { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to persist attack' } } as AttackError,
        { status: 500 }
      );
    }

    // If the inventory decrement was requested but didn't succeed (should not
    // happen with correct logic, but defensive), compensate HP.
    // This can only occur if the row existed at check time but was consumed
    // by a concurrent request between check and transaction — the transaction
    // itself handles this gracefully with GREATEST(0, col-1).
    if (activeActivityId > 0 && !persistenceResult.inventoryDecremented) {
      try {
        const redis = getRedisClient();
        await redis.incrby(REDIS_KEYS.BOSS_HP, luaResult.actualDamage);
      } catch {
        /* best-effort */
      }
      return NextResponse.json(
        { ok: false, error: { code: 'INSUFFICIENT_ITEM', message: 'Not enough items' } } as AttackError,
        { status: 400 }
      );
    }

    // STEP 9: Boss HP persistence — separate failure-tolerant path.
    // Damage is already committed. Redis warm inside updateBossStatus reconciles.
    try {
      await updateBossStatus(luaResult.newHp, maxHpForWrite);
    } catch (bossErr) {
      console.error('[ATTACK] Boss HP persistence FAILED:', bossErr);
    }

    // STEP 10: Fetch updated total damage for response.
    let totalDamage = 0;
    try {
      const inv = await getUserInventory(userId);
      totalDamage = Number(inv?.total_damage_dealt ?? 0);
    } catch {
      /* non-fatal */
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[ATTACK] Complete in ${elapsed}ms — user=${userId} dmg=${luaResult.actualDamage} ` +
      `newHp=${luaResult.newHp} inventoryDecremented=${persistenceResult.inventoryDecremented}`
    );

    return NextResponse.json({
      ok: true,
      data: {
        item_type: payload.item_type,
        actual_damage: luaResult.actualDamage,
        new_hp: luaResult.newHp,
        total_damage: totalDamage,
        return_code: 1,
        actualDamage: luaResult.actualDamage,
        newHp: luaResult.newHp,
        totalDamage,
        returnCode: 1,
      },
    } as AttackResponse, { status: 200 });
  } catch (error) {
    console.error('[REPARK FATAL ERROR] 攻击接口崩溃:', error);
    const detail = error instanceof Error
      ? `${error.message}${error.stack ? '\n' + error.stack : ''}`
      : String(error);
    return NextResponse.json(
      { ok: false, message: '服务器异常', error: detail },
      { status: 500 }
    );
  }
}
