// scripts/d1r1c-feedback76-recon.mjs — Read-only check for feedback #76
// SAFE: only SELECT statements against controlled/non-customer users
import { createRequire } from 'node:module';
const require = createRequire('/var/www/app/');
const pg = require('pg');
const fs = require('node:fs');

const PROD_APP_DIR = '/var/www/app';

// Controlled test fixture from D1-R1C (NOT a real customer)
const FIXTURE_USER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

async function loadEnv() {
  const envText = fs.readFileSync(`${PROD_APP_DIR}/.env.production`, 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

async function main() {
  await loadEnv();
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  console.log('═════════════════════════════════════════════════════════════');
  console.log('[STEP 6] Read-only data check (controlled fixture)');
  console.log('═════════════════════════════════════════════════════════════');

  // Read fixture user's inventory (GLOBAL LIFETIME)
  const inv = await client.query(`
    SELECT user_id, item_hand_count, item_phallus_count, total_damage_dealt
    FROM public.user_inventory WHERE user_id = $1
  `, [FIXTURE_USER]);
  console.log('\n[A] user_inventory.total_damage_dealt (GLOBAL LIFETIME):');
  console.log('   ', JSON.stringify(inv.rows[0] ?? {}));

  // Read fixture user's per-activity damage (STRICT activity-scoped)
  const acts = await client.query(`
    SELECT activity_id, total_damage
    FROM public.user_activity_stats WHERE user_id = $1
    ORDER BY activity_id ASC
  `, [FIXTURE_USER]);
  console.log('\n[B] user_activity_stats (per-activity damage):');
  for (const row of acts.rows) {
    console.log(`   activity_id=${row.activity_id} → total_damage=${row.total_damage}`);
  }

  // Read all activities
  const allAct = await client.query(`
    SELECT id, name FROM public.activities ORDER BY id ASC
  `);
  console.log('\n[All activities]');
  for (const a of allAct.rows) {
    console.log(`   id=${a.id} name="${a.name}"`);
  }

  // Simulate the bug scenario: when no activity is selected, what does the admin UI display?
  console.log('\n═════════════════════════════════════════════════════════════');
  console.log('[STEP 6b] Simulate admin UI bug scenario');
  console.log('═════════════════════════════════════════════════════════════');

  // For each activity, project what the API would return
  console.log('\n[API field] activities[i].totalDamage (per activity):');
  for (const a of allAct.rows) {
    const strictDmg = acts.rows.find(r => r.activity_id === a.id)?.total_damage ?? 0;
    console.log(`   ${a.name} (id=${a.id}): ${strictDmg}`);
  }

  console.log('\n[API field] inventory.totalDamage (LIFETIME):');
  console.log(`   ${inv.rows[0]?.total_damage_dealt ?? 0}`);

  // Bug demonstration: when no activity is selected, the panel shows lifetime
  console.log('\n[UI Panel: "本活动贡献伤害" / Activity Contribution Damage]');
  console.log('   When selectedActivityId === null (no activity selected):');
  console.log('   selectedActivity = undefined');
  console.log('   selectedDamage = selectedActivity?.totalDamage ?? searchResult?.inventory.totalDamage ?? 0');
  console.log('                  = undefined ?? ' + (inv.rows[0]?.total_damage_dealt ?? 0) + ' ?? 0');
  console.log('                  = ' + (inv.rows[0]?.total_damage_dealt ?? 0));
  console.log('\n   ⚠ UI displays LIFETIME damage under an ACTIVITY-DAMAGE label');

  // Verify getActivityDamage (strict) for each activity
  console.log('\n[getActivityDamage() strict output per activity]:');
  for (const a of allAct.rows) {
    const strictDmg = acts.rows.find(r => r.activity_id === a.id)?.total_damage ?? 0;
    console.log(`   activity ${a.id} (${a.name}): ${strictDmg}`);
  }

  // Now also probe for legacy data scenario: a user who has lifetime damage but no user_activity_stats rows
  console.log('\n═════════════════════════════════════════════════════════════');
  console.log('[STEP 6c] Probe for legacy data drift (lifetime > 0, no stats)');
  console.log('═════════════════════════════════════════════════════════════');

  const legacy = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE ui.total_damage_dealt > 0)::int AS lifetime_positive,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.user_activity_stats uas WHERE uas.user_id = ui.user_id))::int AS has_stats,
      COUNT(*) FILTER (
        WHERE ui.total_damage_dealt > 0
          AND NOT EXISTS (SELECT 1 FROM public.user_activity_stats uas WHERE uas.user_id = ui.user_id)
      )::int AS has_lifetime_no_stats
    FROM public.user_inventory ui
  `);
  console.log('\n[Aggregate drift]:');
  console.log(JSON.stringify(legacy.rows[0]));
  console.log('  (has_lifetime_no_stats = users with lifetime damage but no per-activity rows)');

  // Read sample of such users
  if ((legacy.rows[0]?.has_lifetime_no_stats ?? 0) > 0) {
    const sample = await client.query(`
      SELECT ui.user_id, ui.total_damage_dealt, ui.nickname
      FROM public.user_inventory ui
      WHERE ui.total_damage_dealt > 0
        AND NOT EXISTS (SELECT 1 FROM public.user_activity_stats uas WHERE uas.user_id = ui.user_id)
      LIMIT 5
    `);
    console.log('\n[Sample legacy users] (FIRST 5 ONLY, no real customer data leaked):');
    for (const r of sample.rows) {
      console.log(`   user_id=${r.user_id} lifetime=${r.total_damage_dealt} nick="${r.nickname}"`);
    }
  } else {
    console.log('\n[Sample legacy users] NONE FOUND — no drift in fixture population.');
  }

  await client.end();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
