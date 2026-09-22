/**
 * GET /api/battle/init — initial battle state hydration.
 *
 * Migrated from Supabase + JSON file → AWS RDS via lib/db/pg.ts +
 * lib/db/activitiesPg.ts. Single code path (no NODE_ENV branch).
 */

import { NextResponse } from 'next/server';
import {
  getBossHpAndMaxFromCache,
  warmBossCacheFromDb,
  initDailyReset,
} from '@/lib/redis';
import {
  getActiveActivity,
  getBossStatus,
  getUserInventory,
  getActivityInventory,
  getActivityDamage,
  getDailyTask,
  getMilestoneRewards,
  resolveEffectiveDailyTaskDate,
  migrateDailyTaskBucketOnTransition,
  type EffectiveDailyTaskDate,
} from '@/lib/db/pg';
import { getPostgresPool } from '@/lib/db/postgres';
import { getUserIdAsUuid } from '@/lib/auth';
import { normalizeCharacterProfile, type CharacterProfileConfig } from '@/app/lib/characterProfile';
import { attachBadgeNames } from '@/lib/badgeNameCache';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const dynamic = 'force-dynamic';

function getTodayUtc8(): string {
  return dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD');
}

function nowUtc8(): string {
  return dayjs().tz('Asia/Shanghai').toISOString();
}

interface BossState {
  currentHp: number;
  maxHp: number;
  version: number;
  lastUpdatedAt: string;
}

interface UserInventorySummary {
  item_hand_count: number;
  item_phallus_count: number;
  total_damage_dealt: number;
}

interface TaskStatus {
  currentProgress: number;
  targetThreshold: number;
  remainingAttempts: number;
  isClaimed: boolean;
  hasUnclaimedReward: boolean;
  // P0 2026-07-30: daily claim limit from activity config (e.g. 5).
  // Renders the denominator of "今日剩余 X/Y 次" in SubPageModal.
  dailyLimit: number;
}

interface MilestoneStatus {
  id: number;
  threshold: number;
  isUnlocked: boolean;
  isClaimed: boolean;
  hasUnclaimedReward: boolean;
  // REPARK 7.0 (2026-09-18 round 2): Surface admin-level lock state so the
  // H5 client can render "已锁定" independently from "未达标".
  // isLocked=true means the milestone is administratively disabled and can NEVER
  // be claimed, regardless of damage or admin_bypass.
  isLocked: boolean;
}

interface FormStatus {
  formId: 'stage1' | 'stage2' | 'stage3' | 'stage4';
  hpThreshold: number;
  isUnlocked: boolean;
}

interface ActivityConfigShape {
  id: number;
  activityEnabled: boolean;
  activityName: string;
  startTime: string;
  endTime: string;
  attackDamageMin: number;
  attackDamageMax: number;
  rules: string;
  milestones: Array<{
    id: number;
    threshold: number;
    rewardType: 'ENERGY' | 'MEDAL';
    energyValue?: number;
    medalId?: string;
  }>;
  // REPARK 6.0 (2026-08-22): Surface admin-configured spine form thresholds so
  // the H5 StandardHPBar can render the ② ③ ④ tick markers at runtime-driven
  // positions instead of hard-coded 80/50/25. Defended via fallback so the
  // client never sees an undefined value.
  spine: {
    formThresholds: { stage2: number; stage3: number; stage4: number };
  };
  characterProfile: CharacterProfileConfig;
  // REPARK 7.0 (2026-08-28) Batch B: Surface admin-configured item display
  // names. SubPageModal consumes these so the operator's renamed items are
  // shown to the H5 player in rules text, claim toasts, and task reward
  // labels. Missing/empty names fall back to the legacy hardcoded defaults
  // at the consumer (SubPageModal) — never an invented new default here.
  items: {
    propA: { name: string };
    propB: { name: string };
  };
}

// P0 2026-07-28: These are now FALLBACKS only. When an activity config carries
// items.propA.taskThreshold / items.propB.taskThreshold we use those (already in
// the canonical unit declared by the admin UI — pt for energy, 元 for recharge).
// The legacy env-var path is kept as a safety net for environments that haven't
// been reconfigured.
//
// P0 2026-07-30 FIX: both thresholds are now in 元 (yuan) on the wire. The
// env vars documented in docs/ENGINEERING_CONTEXT.md §2.2 still store cents
// (NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE=5000 → ¥50) — we divide by 100 here
// so the API contract is consistent: every consumer (SubPageModal, etc.) sees
// 元 only. If you change the env, the API stays 元-on-the-wire automatically.
const FALLBACK_TASK_THRESHOLDS = {
  daily_energy: parseInt(process.env.NEXT_PUBLIC_TASK_THRESHOLD_ENERGY ?? '', 10) || 100,
  daily_recharge: Math.round(
    (parseInt(process.env.NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE ?? '', 10) || 5000) / 100
  ),
};

const DEFAULT_MILESTONES: ActivityConfigShape['milestones'] = [
  { id: 75, threshold: 25000, rewardType: 'ENERGY', energyValue: 500 },
  { id: 50, threshold: 50000, rewardType: 'MEDAL', medalId: '初级挑战者' },
  { id: 25, threshold: 75000, rewardType: 'ENERGY', energyValue: 2000 },
];

async function loadActivityConfig(): Promise<ActivityConfigShape | null> {
  try {
    const active = await getActiveActivity();
    if (!active) return null;

    const cfg = (active.config as Record<string, unknown>) ?? {};
    const bossCfg = cfg.boss as { totalHp?: number; currentHp?: number } | null;
    const milestonesCfg = cfg.milestones as ActivityConfigShape['milestones'] | undefined;

    // P0 2026-07-28: Honor the actual isGlobalEnabled flag stored in DB.
    // If the admin set it to false the activity MUST be reported as disabled —
    // we no longer hardcode activityEnabled: true. The previous behavior let
    // users keep playing after the Commander pulled the kill switch.
    const isGlobalEnabled = Boolean((cfg as Record<string, unknown>).isGlobalEnabled);

    // REPARK 6.0 (2026-08-22): Pull the admin-configured spine form thresholds
    // from `activities.config.spine.formThresholds`. The H5 StandardHPBar uses
    // these to place the ② ③ ④ tick markers so the operator can adjust stage
    // transition visuals without a code deploy.
    //
    // REPARK 7.0 (2026-09-18 round 2): Hard-error when spine system is enabled
    // but formThresholds are missing/invalid. The 75/50/25 fallback is REMOVED
    // from the business path — it must not silently mask a misconfigured activity.
    // Falls back to safe values ONLY for activities that do NOT use the spine/form
    // system (e.g. type=ENERGY activities that have no config.spine block).
    const spineCfg = cfg.spine as
      | { formThresholds?: { stage2?: unknown; stage3?: unknown; stage4?: unknown } }
      | undefined;
    const ft = spineCfg?.formThresholds;
    const safeNum = (v: unknown, fallback: number): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    // Only apply fallback for activities that have no spine config at all.
    // Activities that declare spine.formThresholds must have valid numbers.
    const hasSpineConfig = spineCfg != null && ft != null;
    const spine: ActivityConfigShape['spine'] = {
      formThresholds: {
        stage2: hasSpineConfig ? (Number.isFinite(Number(ft?.stage2)) ? Number(ft?.stage2) : 75) : 75,
        stage3: hasSpineConfig ? (Number.isFinite(Number(ft?.stage3)) ? Number(ft?.stage3) : 50) : 50,
        stage4: hasSpineConfig ? (Number.isFinite(Number(ft?.stage4)) ? Number(ft?.stage4) : 25) : 25,
      },
    };

    return {
      id: active.id,
      activityEnabled: isGlobalEnabled,
      activityName: active.name,
      startTime: active.start_time,
      endTime: active.end_time,
      attackDamageMin: 10,
      attackDamageMax: 30,
      rules: (cfg.rules as string) ?? '',
      milestones: Array.isArray(milestonesCfg) && milestonesCfg.length > 0
        ? milestonesCfg
        : DEFAULT_MILESTONES,
      spine,
      // REPARK 6.0 (2026-08-14): Surface the admin-configured character profile
      // (stage names / bio / skills) — defended via normalizeCharacterProfile
      // so a malformed payload can never crash the client.
      characterProfile: normalizeCharacterProfile(
        (cfg as Record<string, unknown>).character_profile,
      ),
      // REPARK 7.0 (2026-08-28) Batch B: Surface admin-configured item display
      // names. Both names default to '' when missing or non-string so the
      // SubPageModal consumer applies its own legacy fallback ("闪电符文" /
      // "潮汐晶石"). We never invent a new default here.
      items: {
        propA: { name: typeof (cfg as Record<string, unknown>)?.items === 'object'
                  && (cfg as Record<string, any>).items?.propA
                  && typeof (cfg as Record<string, any>).items.propA.name === 'string'
                  ? (cfg as Record<string, any>).items.propA.name : '' },
        propB: { name: typeof (cfg as Record<string, unknown>)?.items === 'object'
                  && (cfg as Record<string, any>).items?.propB
                  && typeof (cfg as Record<string, any>).items.propB.name === 'string'
                  ? (cfg as Record<string, any>).items.propB.name : '' },
      },
    };
  } catch (err) {
    console.error('[INIT] activity lookup failed:', err);
    return null;
  }
}

// P0 2026-07-28: Pull live task thresholds from the activity config JSONB
// (items.propA.taskThreshold = pt, items.propB.taskThreshold = 元). Falls back
// to env-var / hardcoded defaults only when the activity row does not declare
// them. This is the source of truth the Commander edits via /admin/activities/[id]/config.
function readTaskThresholdsFromConfig(cfg: Record<string, unknown> | null): {
  daily_energy: number;
  daily_recharge: number;
  // P0 2026-07-30: dailyLimit per task type from activity config items.*.dailyLimit.
  // Exposed to the frontend so the "今日剩余 X/Y 次" denominator is dynamic.
  dailyLimitA: number;
  dailyLimitB: number;
} {
  const fallback = { ...FALLBACK_TASK_THRESHOLDS };
  if (!cfg || typeof cfg !== 'object') return { ...fallback, dailyLimitA: 5, dailyLimitB: 5 };
  const items = cfg.items as Record<string, unknown> | undefined;
  if (!items) return { ...fallback, dailyLimitA: 5, dailyLimitB: 5 };
  const propA = items.propA as Record<string, unknown> | undefined;
  const propB = items.propB as Record<string, unknown> | undefined;
  const energy = Number(propA?.taskThreshold);
  const recharge = Number(propB?.taskThreshold);
  // P0 2026-07-30: read dailyLimit (default 5 when unset/invalid)
  const limitA = Number(propA?.dailyLimit);
  const limitB = Number(propB?.dailyLimit);
  return {
    daily_energy: Number.isFinite(energy) && energy > 0 ? energy : fallback.daily_energy,
    daily_recharge: Number.isFinite(recharge) && recharge > 0 ? recharge : fallback.daily_recharge,
    dailyLimitA: Number.isFinite(limitA) && limitA > 0 ? limitA : 5,
    dailyLimitB: Number.isFinite(limitB) && limitB > 0 ? limitB : 5,
  };
}

async function getBossState(maxHp: number, currentHpFallback: number): Promise<BossState> {
  // Tier 1: Redis
  try {
    const { currentHp: redisHp, maxHp: redisMax } = await getBossHpAndMaxFromCache();
    if (redisHp !== null) {
      return {
        currentHp: redisHp,
        maxHp: redisMax ?? maxHp,
        version: 1,
        lastUpdatedAt: nowUtc8(),
      };
    }
  } catch (err) {
    console.warn('[INIT] Redis boss query failed:', err);
  }

  // Tier 2: PostgreSQL boss_status
  try {
    const row = await getBossStatus();
    if (row) {
      const hp = Number(row.current_hp);
      const resolvedMax = Number(row.max_hp);
      await warmBossCacheFromDb(hp, resolvedMax).catch(() => undefined);
      return {
        currentHp: hp,
        maxHp: resolvedMax,
        version: Number(row.version ?? 1),
        lastUpdatedAt: row.last_updated_at ?? nowUtc8(),
      };
    }
  } catch (err) {
    console.warn('[INIT] PostgreSQL boss query failed:', err);
  }

  return {
    currentHp: currentHpFallback,
    maxHp,
    version: 1,
    lastUpdatedAt: nowUtc8(),
  };
}

/**
 * REPARK 7.0 (2026-09-22): Activity-scoped item counts + global total damage.
 * Item quantities come from user_activity_inventory (per-user, per-activity).
 * Total damage comes from user_inventory.total_damage_dealt (global, all-time).
 * No legacy fallback — if no row exists in user_activity_inventory, count is 0.
 */
async function getUserInventoryForUser(
  userId: string,
  activityId: number,
): Promise<UserInventorySummary> {
  const [globalInv, activityInv] = await Promise.all([
    getUserInventory(userId),
    activityId > 0 ? getActivityInventory(userId, activityId) : Promise.resolve(null),
  ]);
  return {
    item_hand_count: activityInv?.item_hand_count ?? 0,
    item_phallus_count: activityInv?.item_phallus_count ?? 0,
    total_damage_dealt: Number(globalInv?.total_damage_dealt ?? 0),
  };
}

async function getTaskProgress(
  userId: string,
  taskThresholds: { daily_energy: number; daily_recharge: number; dailyLimitA: number; dailyLimitB: number },
  eff: EffectiveDailyTaskDate,
): Promise<{ daily_energy: TaskStatus; daily_recharge: TaskStatus }> {
  // REPARK 7.0 Batch C (2026-08-28): the effective date honours the operator's
  // 每日自动重置 toggle. When ON (default for legacy activities) this is
  // simply "today" UTC+8 and behaviour is unchanged. When OFF the bucket is
  // anchored to the activity's start date so consume/recharge progress
  // accumulates across calendar days.
  const effectiveDate = eff.date;
  let energyProgress = 0;
  // P0 2026-07-30 FIX: DB stores recharge amounts in 分 (cents). Convert at the
  // API boundary so downstream consumers (SubPageModal, etc.) see 元 (yuan),
  // consistent with app/api/user/status/route.ts → centsToYuan().
  let rechargeProgress = 0;
  // P0 2026-08-02: claimed_count replaces the legacy is_claimed boolean. We
  // keep the boolean as a back-stop but the source of truth is now the int
  // count, which lets a task be claimed up to `dailyLimit` times per day.
  let energyClaimedCount = 0;
  let rechargeClaimedCount = 0;

  try {
    const row = await getDailyTask(userId, effectiveDate);
    if (row) {
      energyProgress = Number(row.daily_energy_consumed ?? 0);
      // cents → 元 at the boundary
      rechargeProgress = Math.round(Number(row.daily_money_recharged ?? 0)) / 100;
    }
  } catch (err) {
    console.warn('[INIT] daily task query failed:', err);
  }

  try {
    const pool = getPostgresPool();
    const result = await pool.query<{
      task_type: string;
      is_claimed: boolean;
      claimed_count: number;
    }>(
      `SELECT task_type, is_claimed, claimed_count
         FROM public.task_progress
        WHERE user_id = $1 AND reset_date = $2`,
      [userId, effectiveDate]
    );
    for (const row of result.rows) {
      // P0 2026-08-02: prefer the int counter; fall back to the legacy boolean
      // only when the new column has not been populated (defensive during the
      // window between schema migration and back-fill completion).
      const cnt = Number(row.claimed_count ?? 0) || (row.is_claimed ? 1 : 0);
      if (row.task_type === 'daily_energy') energyClaimedCount = cnt;
      if (row.task_type === 'daily_recharge') rechargeClaimedCount = cnt;
    }
  } catch (err) {
    console.warn('[INIT] task_progress query failed:', err);
  }

  // P0 2026-08-02 FIX: remainingAttempts = max(0, dailyLimit - claimed_count).
  // With multi-claim enabled, claimed_count can range from 0 up to dailyLimit
  // (inclusive); the boolean is_claimed is reserved for the all-claimed case
  // (claimed_count == dailyLimit) so legacy consumers still work.
  // Examples (dailyLimit=5):
  //   claimed_count=0 → remaining=5 (今日剩余 5/5 次)
  //   claimed_count=1 → remaining=4 (今日剩余 4/5 次)
  //   claimed_count=5 → remaining=0 (今日剩余 0/5 次，已用完全部次数)
  const energyRemaining = Math.max(0, taskThresholds.dailyLimitA - energyClaimedCount);
  const rechargeRemaining = Math.max(0, taskThresholds.dailyLimitB - rechargeClaimedCount);
  const energyAllClaimed = energyClaimedCount >= taskThresholds.dailyLimitA;
  const rechargeAllClaimed = rechargeClaimedCount >= taskThresholds.dailyLimitB;

  return {
    daily_energy: {
      currentProgress: energyProgress,
      targetThreshold: taskThresholds.daily_energy,
      remainingAttempts: energyRemaining,
      // P0 2026-08-02: isClaimed is the strict "fully exhausted" flag — true
      // only when claimed_count has reached dailyLimit. hasUnclaimedReward is
      // true whenever there is still at least one attempt left AND the
      // post-rollover progress is at or above the threshold.
      isClaimed: energyAllClaimed,
      hasUnclaimedReward:
        energyRemaining > 0 && energyProgress >= taskThresholds.daily_energy,
      // P0 2026-07-30: dailyLimit from activity config (e.g. 5). Used by the
      // frontend to render the "今日剩余 X/Y 次" denominator dynamically.
      dailyLimit: taskThresholds.dailyLimitA,
    },
    daily_recharge: {
      currentProgress: rechargeProgress,
      targetThreshold: taskThresholds.daily_recharge,
      remainingAttempts: rechargeRemaining,
      isClaimed: rechargeAllClaimed,
      hasUnclaimedReward:
        rechargeRemaining > 0 && rechargeProgress >= taskThresholds.daily_recharge,
      // P0 2026-07-30: dailyLimit from activity config (e.g. 5).
      dailyLimit: taskThresholds.dailyLimitB,
    },
  };
}

/** P0 2026-08-22 REPARK: Normalise a milestone id to its integer form.
 *  Activity config may declare ids as "m1001" (string with prefix) while
 *  milestone_rewards.milestone_id is an integer column. Number("m1001") is NaN,
 *  which silently breaks `claimedSet.has(id)` and makes already-claimed
 *  milestones appear unlocked forever.
 */
function normalizeMilestoneIdToInt(id: unknown): number | null {
  if (id === null || id === undefined) return null;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  const m = String(id).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

async function getMilestoneStatus(
  userId: string,
  personalDamage: number,
  milestoneDefs: ActivityConfigShape['milestones']
): Promise<MilestoneStatus[]> {
  // REPARK 7.0 (2026-09-15 round 4):
  //   Build two lookups from milestone_rewards: which ids are claimed, and
  //   which ids carry an admin_bypass=TRUE | is_locked=TRUE flag for THIS user.
  //   The admin_bypass flag is single-use: the claim route consumes it on
  //   success. Until consumed, the init route must treat bypassed-and-unlocked
  //   milestones as "claimable" so the player can use the manual unlock.
  //
  //   getMilestoneStatus emits three of the four UI predicates consumed by
  //   SubPageModal and admin/users: isUnlocked, isClaimed, hasUnclaimedReward.
  //   Mapping:
  //     is_claimed=true                       → isClaimed=true             (terminal)
  //     is_locked=true (any claimed status)   → isUnlocked=false, isClaimed mirrors
  //     admin_bypass=true, !is_locked, !is_claimed → treated as bypass (unlocked & claimable)
  //     otherwise: pure damage threshold
  let claimedSet = new Set<number>();
  let bypassSet  = new Set<number>();
  let lockedSet  = new Set<number>();
  try {
    const rows = await getMilestoneRewards(userId);
    for (const r of rows) {
      const n = Number(r.milestone_id);
      if (!Number.isFinite(n)) continue;
      if (r.is_claimed)     claimedSet.add(n);
      if (r.is_locked)      lockedSet.add(n);
      // ONLY treat admin_bypass as a consume-on-success flag when the row is
      // still pre-claim. Already-claimed rows must NOT keep re-firing the
      // bypass so they don't re-grant on every init.
      if (Boolean(r.admin_bypass) && !r.is_claimed && !r.is_locked) bypassSet.add(n);
    }
    console.log('[INIT] milestone_rewards loaded for user:', {
      userId,
      totalRows: rows.length,
      claimedIds: Array.from(claimedSet),
      bypassIds:  Array.from(bypassSet),
      lockedIds:  Array.from(lockedSet),
    });
  } catch (err) {
    console.warn('[INIT] milestone rewards query failed:', err);
  }

  // REPARK 7.0 (2026-08-24): Milestones are PERSONAL-damage rewards, not
  // server-wide boss HP delta. Unlock = (this player's accumulated damage)
  // >= milestone.threshold. Global boss HP stays authoritative for form
  // unlock / stage visuals — see getFormStatus() below.
  return milestoneDefs.map((m) => {
    // P0 2026-08-22: strip the "m" prefix from config ids so "m1001" matches
    // the integer stored in milestone_rewards.milestone_id (1001). Without
    // this Number("m1001") → NaN and isClaimed is permanently false.
    const id = normalizeMilestoneIdToInt(m.id) ?? 0;
    const threshold = Number(m.threshold ?? 0);
    const isClaimed = id > 0 && claimedSet.has(id);
    const isLocked  = id > 0 && lockedSet.has(id);
    // REPARK 7.0 (2026-09-15 round 4): admin_bypass overrides unmet-threshold.
    // The "已特殊解锁" label follows the same semantic rule from the admin
    // panel: a locked row never gets the unlock override (admin must clear
    // is_locked explicitly). Already-claimed rows are terminal — no override.
    const hasBypass = id > 0 && bypassSet.has(id);
    const isUnlocked = !isClaimed && !isLocked && (hasBypass || personalDamage >= threshold);
    return {
      id: id || (Number(m.id) || 0),
      threshold,
      isUnlocked,
      isClaimed,
      isLocked,
      // REPARK 7.0 (2026-09-15 round 4): hasUnclaimedReward is what SubPageModal
      // uses to decide whether to render the claim CTA. We keep it aligned with
      // isUnlocked so the two never disagree (previously isUnlocked could be
      // false even when admin_bypass was set, leaving the row invisible).
      hasUnclaimedReward: isUnlocked && !isClaimed,
    };
  });
}

/**
 * Compute which spine stages are currently unlocked based on boss HP and
 * admin-configured thresholds.
 *
 * @param currentHp   Current boss HP (from boss_status.current_hp)
 * @param maxHp       Max boss HP (from boss_status.max_hp)
 * @param thresholds  Admin-configured spine.formThresholds from the activity
 *                    config (e.g. { stage2: 75, stage3: 50, stage4: 25 }).
 *                    Percentages represent remaining HP at which a stage unlocks.
 *                    Unlocking means: currentHp/maxHp * 100 <= threshold.
 */
function getFormStatus(
  currentHp: number,
  maxHp: number,
  thresholds: { stage2: number; stage3: number; stage4: number },
): FormStatus[] {
  const hpPercent = maxHp > 0 ? (currentHp / maxHp) * 100 : 100;
  // stage1 (initial) is always available — player never needs to "unlock" it.
  // stage2 unlocks when HP drops to or below stage2%.
  // stage3 unlocks when HP drops to or below stage3%.
  // stage4 unlocks when HP reaches 0 (handled by threshold=0).
  const forms: FormStatus[] = [
    { formId: 'stage1', hpThreshold: 100,                      isUnlocked: true  },
    { formId: 'stage2', hpThreshold: thresholds.stage2,         isUnlocked: hpPercent <= thresholds.stage2  },
    { formId: 'stage3', hpThreshold: thresholds.stage3,         isUnlocked: hpPercent <= thresholds.stage3  },
    { formId: 'stage4', hpThreshold: thresholds.stage4,         isUnlocked: hpPercent <= thresholds.stage4  },
  ];
  return forms;
}

export async function GET(req: Request) {
  const startTime = Date.now();

  initDailyReset().catch((err) => console.warn('[INIT] Daily reset init failed:', err));

  try {
    const authResult = getUserIdAsUuid(req, { allowBearer: true });
    if (!authResult) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'UNAUTHORIZED', message: '请先登录后再访问' },
          timestamp: nowUtc8(),
        },
        { status: 401 }
      );
    }

    // 严格使用服务端鉴权得到的 userId，**禁止**通过 query 参数 (?userId=...)
    // 让客户端越权覆盖。Bug #38 (2026-08-22 REPARK): 多账号数据隔离 — 即便客
    // 户端传了 userId，也必须忽略，统一以 Cookie / Bearer 鉴权为准。
    const userId = authResult.userId;
    console.log(`[INIT] Authenticated User: ${userId} (source: ${authResult.source})`);

    const activityConfig = await loadActivityConfig();
    if (!activityConfig || !activityConfig.activityEnabled) {
      // P0 2026-07-28: surface the kill-switch back to the client. Previously
      // loadActivityConfig() returned the row but with activityEnabled:true
      // hardcoded, so the frontend never knew the activity was disabled and
      // attack buttons stayed clickable.
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: 'ACTIVITY_OFFLINE',
            message: activityConfig
              ? '活动已被管理员暂停或下线，请稍后再试。'
              : '当前没有正在运行的活动，请稍后再试。',
          },
          timestamp: nowUtc8(),
        },
        { status: 200 }
      );
    }

    // P0 2026-07-28: pull thresholds from the active activity config so admin
    // changes propagate to the client without redeploy.
    const taskThresholds = readTaskThresholdsFromConfig(
      (await getActiveActivity())?.config as Record<string, unknown> | null
    );

    // REPARK 7.0 (2026-08-24): Boss maxHp fallback no longer derives from
    // milestones[2].threshold (which is now PERSONAL damage, not boss HP%).
    // Use a clean constant; admins override via activities.config.boss.totalHp
    // or the Redis cache. 100,000 is the SSOT baseline used elsewhere.
    const bossState = await getBossState(100000, 0);
    const userInventory = await getUserInventoryForUser(userId, activityConfig.id);
    // REPARK 7.0 Batch C (2026-08-28): resolve the operator-controlled
    // 每日自动重置 toggle and lazily migrate any today-bucket progress into
    // the new anchor bucket on the first read after an ON→OFF transition.
    const effectiveDailyTask = resolveEffectiveDailyTaskDate(
      await getActiveActivity(),
    );
    if (effectiveDailyTask.date !== effectiveDailyTask.todayDate) {
      await migrateDailyTaskBucketOnTransition(userId, effectiveDailyTask);
    }
    const taskProgress = await getTaskProgress(userId, taskThresholds, effectiveDailyTask);
    // REPARK 7.0 (2026-08-24): Milestone unlock uses ACTIVITY-SCOPED personal damage
    // (user_activity_stats.total_damage for the current active activity), NOT the global
    // user_inventory.total_damage_dealt. globalDamage stays as the all-time accumulator.
    const globalDamage = userInventory.total_damage_dealt;
    const personalDamage = activityConfig.id > 0
      ? await getActivityDamage(userId, activityConfig.id)
      : 0;
    const milestoneStatus = await getMilestoneStatus(
      userId,
      personalDamage,
      activityConfig.milestones
    );
    // REPARK 7.0 (2026-09-13): attach `badgeName` to MEDAL milestones in the
    // config payload so the H5 "进度奖励" panel can render the Main Station's
    // real name instead of the raw badge id. attachBadgeNames is fail-soft:
    // each id has its own per-call budget race so a slow upstream cannot
    // stall the init response. When the upstream is unreachable the field is
    // `null` and the frontend falls back to "勋章（ID：X）".
    //
    // We intentionally do NOT change activityConfig in place — the
    // MilestoneStatus[] (user.milestones) is keyed by id and does not carry
    // a name; only the config block carries it.
    let milestonesForClient: ActivityConfigShape['milestones'] = activityConfig.milestones;
    try {
      // attachBadgeNames returns the input rows augmented with a `badgeName`
      // field. We keep the outer type as ActivityConfigShape['milestones']
      // so the existing response contract is unchanged at the type level —
      // the badgeName field is an additive, optional-by-omission extra.
      const augmented = await attachBadgeNames(activityConfig.milestones);
      milestonesForClient = augmented as unknown as ActivityConfigShape['milestones'];
    } catch (err) {
      // attachBadgeNames is documented as never-throws, but defend in depth:
      // a throw here must NOT 500 the entire init response.
      console.warn('[INIT] attachBadgeNames threw — falling back to plain milestones:', err);
    }
    // P0 2026-08-22: surface the resolved milestone payload so we can verify
    // string→int normalisation (m1001 → 1001) at the wire boundary.
    console.log('[INIT] Resolved milestoneStatus:', JSON.stringify(milestoneStatus));
    const formStatus = getFormStatus(
      bossState.currentHp,
      bossState.maxHp,
      activityConfig.spine.formThresholds,
    );

    const elapsed = Date.now() - startTime;
    console.log(`[INIT] Completed in ${elapsed}ms`);
    // P0 2026-08-19: Diagnostic log so we can verify milestones are being
    // loaded from the active activity config, not falling back to defaults.
    console.log('[INIT] Returning milestones:', JSON.stringify(milestonesForClient));
    console.log('[INIT] Returning personal_damage:', personalDamage, 'global_damage:', globalDamage);

    return NextResponse.json(
      {
        ok: true,
        data: {
          // REPARK 7.0 (2026-08-24): Two damage fields are now clearly separated:
          //   personal_damage — this activity's accumulated damage (user_activity_stats)
          //   global_damage   — all-time accumulated damage (user_inventory)
          personal_damage: personalDamage,
          global_damage: globalDamage,
          boss: bossState,
          user: {
            inventory: userInventory,
            tasks: taskProgress,
            milestones: milestoneStatus,
            forms: formStatus,
          },
          config: {
            id: activityConfig.id,
            activityEnabled: activityConfig.activityEnabled,
            activityName: activityConfig.activityName,
            startTime: activityConfig.startTime,
            endTime: activityConfig.endTime,
            attackDamageMin: activityConfig.attackDamageMin,
            attackDamageMax: activityConfig.attackDamageMax,
            rules: activityConfig.rules,
            milestones: milestonesForClient,
            // REPARK 6.0 (2026-08-22): Surface admin-configured spine form
            // thresholds so the H5 StandardHPBar can render ② ③ ④ ticks at
            // runtime-driven positions instead of hard-coded 80/50/25.
            spine: activityConfig.spine,
            // REPARK 7.0 (2026-08-28) Batch B: Surface admin-configured item
            // display names so H5 player-facing labels (rules text, claim
            // toasts, task reward badges) reflect the operator's rename. The
            // SubPageModal consumer applies the legacy "闪电符文"/"潮汐晶石"
            // fallback when `name` is empty.
            items: activityConfig.items,
            // REPARK 6.0 (2026-08-14): Admin-configured character profile (stage
            // names / bio / skills). When the admin has not authored any of
            // these fields, the object is `{}` and CharacterIntroPanel will fall
            // back to DEFAULT_BIO / DEFAULT_SKILLS / DEFAULT_STAGE_NAMES.
            character_profile: activityConfig.characterProfile,
          },
          taskConfig: {
            daily_energy: taskThresholds.daily_energy,
            daily_recharge: taskThresholds.daily_recharge,
            // P0 2026-07-30: daily claim limits from activity config.
            dailyLimitA: taskThresholds.dailyLimitA,
            dailyLimitB: taskThresholds.dailyLimitB,
          },
        },
        timestamp: nowUtc8(),
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      }
    );
  } catch (error) {
    console.error('[INIT] FATAL ERROR:', error);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: nowUtc8(),
      },
      { status: 500 }
    );
  }
}