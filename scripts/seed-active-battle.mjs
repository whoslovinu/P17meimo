// scripts/seed-active-battle.mjs
// Idempotently creates an ENABLED battle activity so /api/game/init returns
// real data instead of ACTIVITY_OFFLINE. Safe to re-run.
//
// REPARK 7.0 (2026-08-24) note: not a reward-claim helper. It seeds the
// active activity and Boss state — out of scope for the Activity Personal
// Damage migration. /api/game/init is the legacy alias of /api/battle/init
// (which now returns activity-scoped personal_damage + global global_damage).
// No code change required here; document-only clarification.

import pg from 'pg';
import { default as Redis } from 'ioredis';

const PG_URL = process.env.DATABASE_URL || 'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';
const REDIS_URL = process.env.REDIS_URL || 'rediss://127.0.0.1:6380';

const ACTIVITY = {
  id: 1,
  name: 'P17 魅魔来袭·第1期',
  type: 'LIVE2D',
  status: 'ENABLED',
  startTime: '2026-01-01T00:00:00Z',
  endTime: '2099-12-31T23:59:59Z',
};

const CONFIG = {
  boss: { totalHp: 100000, currentHp: 100000 },
  rules: '使用鞭子和手指道具攻击 Boss，达到血量阈值解锁奖励。',
  milestones: [
    { id: 75, threshold: 25000, rewardType: 'ENERGY', energyValue: 500 },
    { id: 50, threshold: 50000, rewardType: 'MEDAL', medalId: '初级挑战者' },
    { id: 25, threshold: 75000, rewardType: 'ENERGY', energyValue: 2000 },
  ],
  damageWeights: { item_hand: { min: 10, max: 30 }, item_phallus: { min: 50, max: 80 } },
  formThresholds: { stage2: 75000, stage3: 50000, stage4: 25000 },
};

async function seedPg() {
  console.log('--- Seeding PostgreSQL ---');
  const c = new pg.Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // 1. Upsert active battle activity
  await c.query(
    `INSERT INTO public.activities (id, name, type, start_time, end_time, status, config)
     VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       type = EXCLUDED.type,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       status = EXCLUDED.status,
       config = EXCLUDED.config`,
    [
      ACTIVITY.id,
      ACTIVITY.name,
      ACTIVITY.type,
      ACTIVITY.startTime,
      ACTIVITY.endTime,
      ACTIVITY.status,
      JSON.stringify(CONFIG),
    ]
  );
  console.log('  ✓ activities row id=1 ENABLED');

  // 2. Reset boss to 100% HP
  await c.query(
    `INSERT INTO public.boss_status (boss_id, max_hp, current_hp, version)
     VALUES ('00000000-0000-0000-0000-000000000001'::uuid, $1, $2, 1)
     ON CONFLICT (boss_id) DO UPDATE SET
       max_hp = EXCLUDED.max_hp,
       current_hp = EXCLUDED.current_hp,
       version = boss_status.version + 1,
       last_updated_at = timezone('utc'::text, now())`,
    [CONFIG.boss.totalHp, CONFIG.boss.currentHp]
  );
  console.log('  ✓ boss_status reset to 100000/100000');

  // 3. Show what's there
  const r = await c.query(
    `SELECT id, name, status, start_time, end_time FROM public.activities WHERE status = 'ENABLED' ORDER BY id`
  );
  console.log('  Active activities now:');
  for (const row of r.rows) {
    console.log('   -', row);
  }

  await c.end();
}

async function seedRedis() {
  console.log('\n--- Seeding Redis ---');
  const r = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    tls: REDIS_URL.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    lazyConnect: true,
  });
  await r.connect();
  await r.set('boss:hp', String(CONFIG.boss.currentHp));
  await r.set('boss:max_hp', String(CONFIG.boss.totalHp));
  await r.set('boss:version', '1');
  await r.set(
    'repark:activity:config',
    JSON.stringify({
      activityEnabled: true,
      activityName: ACTIVITY.name,
      startTime: ACTIVITY.startTime,
      endTime: ACTIVITY.endTime,
      rules: CONFIG.rules,
      bossMaxHp: CONFIG.boss.totalHp,
      attackDamageMin: 10,
      attackDamageMax: 30,
      stages: CONFIG.formThresholds,
      milestones: CONFIG.milestones.map((m) => ({
        id: m.id,
        hp_threshold: m.threshold,
        name: m.rewardType === 'ENERGY' ? `+${m.energyValue} 体力` : m.medalId,
        emoji: m.rewardType === 'ENERGY' ? '⚡' : '🏅',
      })),
    })
  );
  console.log('  ✓ boss:hp = 100000');
  console.log('  ✓ boss:max_hp = 100000');
  console.log('  ✓ repark:activity:config cached');
  r.disconnect();
}

try {
  await seedPg();
  await seedRedis();
  console.log('\n✅ Activity seeded. /api/game/init should now return ok:true');
  process.exit(0);
} catch (e) {
  console.error('\n❌ FAILED:', e.message);
  process.exit(1);
}