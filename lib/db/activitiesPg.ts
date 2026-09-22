/**
 * PostgreSQL-backed activities store.
 *
 * REPLACES the legacy local-JSON `db.ts` (which read/wrote
 * `mock_db_activities.json`). The serverless filesystem cannot host
 * writable JSON DBs — every operation now goes to AWS RDS via
 * `lib/db/pg.ts`.
 *
 * Public surface (unchanged from the old fs-backed module so callers
 * don't need to change import paths):
 *   - listActivities()
 *   - getActivityById(id)
 *   - createActivity(input)
 *   - updateActivity(id, updates)
 *   - deleteActivity(id)
 *   - setActivityActive(id)
 *
 * All functions throw on DB error — callers handle 500 responses.
 */

import {
  listActivities as pgListActivities,
  getActivityById as pgGetActivityById,
  insertActivity as pgInsertActivity,
  updateActivity as pgUpdateActivity,
  deleteActivity as pgDeleteActivity,
  setActivityActive as pgSetActivityActive,
  type ActivityRow,
} from '@/lib/db/pg';

// ── Re-export shared types ─────────────────────────────────────────────────

export type ActivityType = 'LIVE2D' | 'ENERGY';
export type ActivityStatus = 'ENABLED' | 'DISABLED';

export interface ActivityBoss {
  totalHp: number;
  currentHp: number;
}

export interface DamageRow {
  id: string;
  minDamage: number;
  maxDamage: number;
  probability: number;
}

export interface ItemTier {
  name: string;
  rows: DamageRow[];
  taskThreshold: number;
  dailyLimit: number;
}

export interface ItemConfig {
  propA: ItemTier;
  propB: ItemTier;
}

export type RewardType = 'ENERGY' | 'MEDAL';

export interface Milestone {
  id: string;
  threshold: number;
  rewardType: RewardType;
  energyValue?: number;
  medalId?: string;
}

export interface SpineFormThresholds {
  stage2: number;
  stage3: number;
  stage4: number;
}

export interface SpineConfig {
  baseUrl: string;
  formThresholds: SpineFormThresholds;
}

export interface ActivityConfig {
  isGlobalEnabled: boolean;
  rules: string;
  boss: ActivityBoss;
  items: ItemConfig;
  milestones: Milestone[];
  spine: SpineConfig;
}

export interface Activity {
  id: number;
  name: string;
  type: ActivityType;
  start_time: string;
  end_time: string;
  status: ActivityStatus;
  config: ActivityConfig;
  created_at: string;
}

export interface ActivityInsert {
  name: string;
  type: ActivityType;
  start_time: string;
  end_time: string;
}

export interface ActivityUpdate {
  name?: string;
  type?: ActivityType;
  start_time?: string;
  end_time?: string;
  status?: ActivityStatus;
  config?: Partial<ActivityConfig>;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export function defaultItemTier(taskThreshold = 100, dailyLimit = 5): ItemTier {
  return {
    name: '',
    rows: [
      { id: 'default-1', minDamage: 1, maxDamage: 3, probability: 50 },
      { id: 'default-2', minDamage: 4, maxDamage: 5, probability: 50 },
    ],
    taskThreshold,
    dailyLimit,
  };
}

export function defaultItemConfig(): ItemConfig {
  return {
    propA: { ...defaultItemTier(100, 5), name: '闪电符文' },
    propB: { ...defaultItemTier(100, 5), name: '潮汐晶石' },
  };
}

export function defaultConfig(): ActivityConfig {
  return {
    isGlobalEnabled: false,
    rules: '',
    boss: { totalHp: 100000, currentHp: 100000 },
    items: defaultItemConfig(),
    milestones: [],
    spine: {
      baseUrl: '/spine/assets',
      formThresholds: { stage2: 75, stage3: 50, stage4: 25 },
    },
  };
}

// ── Row ↔ Domain Translation ────────────────────────────────────────────────

function rowToActivity(row: ActivityRow): Activity {
  const config = (row.config as Partial<ActivityConfig>) ?? {};
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    config: {
      ...defaultConfig(),
      ...config,
      boss: config.boss ?? defaultConfig().boss,
      items: config.items ?? defaultConfig().items,
      milestones: config.milestones ?? defaultConfig().milestones,
      spine: config.spine ?? defaultConfig().spine,
    },
    created_at: row.created_at ?? new Date().toISOString(),
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function listActivities(): Promise<Activity[]> {
  const rows = await pgListActivities();
  return rows.map(rowToActivity);
}

export async function getActivityById(id: number): Promise<Activity | null> {
  const row = await pgGetActivityById(id);
  return row ? rowToActivity(row) : null;
}

export async function createActivity(input: ActivityInsert): Promise<Activity> {
  const row = await pgInsertActivity(
    input.name,
    input.type,
    input.start_time,
    input.end_time,
    { isGlobalEnabled: false }
  );
  return rowToActivity(row);
}

export async function updateActivity(
  id: number,
  updates: ActivityUpdate
): Promise<Activity | null> {
  const pgUpdates: Parameters<typeof pgUpdateActivity>[1] = {};
  if (updates.name !== undefined) pgUpdates.name = updates.name;
  if (updates.type !== undefined) pgUpdates.type = updates.type;
  if (updates.start_time !== undefined) pgUpdates.start_time = updates.start_time;
  if (updates.end_time !== undefined) pgUpdates.end_time = updates.end_time;
  if (updates.status !== undefined) pgUpdates.status = updates.status;
  if (updates.config !== undefined) {
    pgUpdates.config = updates.config as Record<string, unknown>;
  }
  const row = await pgUpdateActivity(id, pgUpdates);
  return row ? rowToActivity(row) : null;
}

export async function deleteActivity(id: number): Promise<boolean> {
  return await pgDeleteActivity(id);
}

export async function setActivityActive(id: number): Promise<Activity | null> {
  const row = await pgSetActivityActive(id);
  return row ? rowToActivity(row) : null;
}

/**
 * Read-only compatibility shim for callers that previously consumed
 * the JSON DB via `readDB()` (which returned `Activity[]`). Returns
 * the same shape but loads from RDS.
 */
export async function readDB(): Promise<Activity[]> {
  return await listActivities();
}