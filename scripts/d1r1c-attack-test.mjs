// scripts/d1r1c-attack-test.mjs — Step 5 attack verification via direct PG connection
// Uses dynamic import to resolve pg from /var/www/app/node_modules
import { createRequire } from 'node:module';
const require = createRequire('/var/www/app/');
const pg = require('pg');

const TEST_USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PROD_APP_DIR = '/var/www/app';

async function loadEnv() {
  const fs = await import('node:fs');
  const envText = fs.readFileSync(`${PROD_APP_DIR}/.env.production`, 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

async function ensureUserAndActivity(client, activityId) {
  await client.query(`
    INSERT INTO public.users (id, nickname, avatar)
    VALUES ($1, 'd1r1c-test', '🧪')
    ON CONFLICT (id) DO NOTHING
  `, [TEST_USER_ID]);

  await client.query(`
    INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
    VALUES ($1, 50, 50, 0)
    ON CONFLICT (user_id) DO UPDATE SET
      item_hand_count = GREATEST(public.user_inventory.item_hand_count, 50),
      item_phallus_count = GREATEST(public.user_inventory.item_phallus_count, 50),
      updated_at = NOW()
  `, [TEST_USER_ID]);

  if (activityId > 0) {
    await client.query(`
      INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
      VALUES ($1, $2, 0)
      ON CONFLICT (user_id, activity_id) DO UPDATE SET
        updated_at = NOW()
    `, [TEST_USER_ID, activityId]);
  }
}

async function snapshotState(client, activityId, label) {
  const inv = await client.query(`
    SELECT COALESCE(item_hand_count, 0) AS hand, COALESCE(item_phallus_count, 0) AS phallus,
           COALESCE(total_damage_dealt, 0) AS global_damage
    FROM public.user_inventory WHERE user_id = $1
  `, [TEST_USER_ID]);
  const act = activityId > 0 ? (await client.query(`
    SELECT COALESCE(total_damage, 0) AS activity_damage
    FROM public.user_activity_stats WHERE user_id = $1 AND activity_id = $2
  `, [TEST_USER_ID, activityId])).rows[0] : { activity_damage: 0 };
  const logs = await client.query(`
    SELECT COUNT(*)::int AS cnt, COALESCE(SUM(damage_dealt), 0)::int AS sum
    FROM public.attack_logs WHERE user_id = $1
  `, [TEST_USER_ID]);
  const boss = await client.query(`
    SELECT current_hp FROM public.boss_status WHERE boss_id = '00000000-0000-0000-0000-000000000001'
  `);
  return {
    label,
    hand: Number(inv.rows[0]?.hand ?? 0),
    phallus: Number(inv.rows[0]?.phallus ?? 0),
    global_damage: Number(inv.rows[0]?.global_damage ?? 0),
    activity_damage: Number(act?.activity_damage ?? 0),
    log_count: logs.rows[0]?.cnt ?? 0,
    log_sum: logs.rows[0]?.sum ?? 0,
    boss_hp_pg: Number(boss.rows[0]?.current_hp ?? 0),
  };
}

async function getRedisBossHp() {
  const fs = await import('node:fs');
  const { execSync } = await import('node:child_process');
  // We don't want to bring in ioredis for a one-off read. Use redis-cli.
  const envText = fs.readFileSync(`${PROD_APP_DIR}/.env.production`, 'utf8');
  const m = envText.match(/^REDIS_URL=(.*)$/m);
  if (!m) return null;
  const url = m[1].replace(/^["']|["']$/g, '');
  try {
    const out = execSync(`redis-cli -u "${url}" GET '{battle}:boss:hp'`, { encoding: 'utf8' });
    return Number(out.trim());
  } catch {
    return null;
  }
}

async function main() {
  await loadEnv();
  console.log('[load] DATABASE_URL host:', (process.env.DATABASE_URL || '').replace(/:[^:@/]*@/, ':***@'));

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // 1. Find active activity
  const active = await client.query(`
    SELECT id FROM public.activities WHERE (config->>'isGlobalEnabled')::boolean = true LIMIT 1
  `);
  const activeId = active.rows[0]?.id ?? 0;
  console.log('[active] active_id =', activeId);

  // 2. Ensure user + inventory
  await ensureUserAndActivity(client, activeId);
  console.log('[setup] user ensured');

  // 3. Baseline
  const before = await snapshotState(client, activeId, 'before');
  before.boss_hp_redis = await getRedisBossHp();
  console.log('[before]', JSON.stringify(before));

  // 4. Execute attack via HTTP
  const nonce = `d1r1c-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  console.log('[attack] nonce =', nonce);
  const res = await fetch('http://127.0.0.1:3000/api/action/attack', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TEST_USER_ID}`,
    },
    body: JSON.stringify({ item_type: 'item_hand', nonce }),
  });
  const body = await res.text();
  console.log('[attack] HTTP', res.status, body);

  let damage = null;
  let attackOk = false;
  try {
    const parsed = JSON.parse(body);
    if (parsed.ok) {
      damage = Number(parsed.data.actual_damage);
      attackOk = true;
    } else {
      console.log('[attack] error:', parsed.error);
    }
  } catch {}

  // 5. After state
  const after = await snapshotState(client, activeId, 'after');
  after.boss_hp_redis = await getRedisBossHp();
  console.log('[after]', JSON.stringify(after));

  // 6. Compute deltas
  const deltas = {
    global_damage: after.global_damage - before.global_damage,
    activity_damage: after.activity_damage - before.activity_damage,
    log_count: after.log_count - before.log_count,
    log_sum: after.log_sum - before.log_sum,
    hand: after.hand - before.hand,
    phallus: after.phallus - before.phallus,
    boss_hp_pg: after.boss_hp_pg - before.boss_hp_pg,
    boss_hp_redis: (after.boss_hp_redis ?? 0) - (before.boss_hp_redis ?? 0),
  };
  console.log('[deltas]', JSON.stringify(deltas));
  console.log('[damage]', damage);

  // 7. Output consolidated result
  const result = {
    test_user_id: TEST_USER_ID,
    active_id: activeId,
    nonce,
    damage,
    before,
    after,
    deltas,
    attack_ok: attackOk,
    attack_http_status: res.status,
    attack_response_body: body,
  };
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/d1r1c-step5.json', JSON.stringify(result, null, 2));
  console.log('[done] saved to /tmp/d1r1c-step5.json');

  await client.end();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
