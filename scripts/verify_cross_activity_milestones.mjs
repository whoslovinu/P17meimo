#!/usr/bin/env node
/**
 * verify_cross_activity_milestones.mjs
 *
 * READ-ONLY verification of milestone_rewards cross-activity ID situation.
 * Connects via the SSH tunnel that `scripts/dev_tunnel.mjs` establishes.
 *
 * Usage:
 *   node scripts/dev_tunnel.mjs   # in terminal 1 (leave running)
 *   node scripts/verify_cross_activity_milestones.mjs  # in terminal 2
 *
 * Exit codes:
 *   0 = verified OK (no conflicts found, or conflict confirmed and reported)
 *   1 = connection/query error
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';
const { Client } = pg;

// Use the same tunnel endpoint as inject_sql.mjs
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

function mask(s) {
  return s.replace(/(password=)([^&]+)/gi, '$1***')
    .replace(/(postgresql:\/\/[^:]+:)([^@]+)(@)/, '$1***$3');
}

function buildConfig(urlStr) {
  const url = new URL(urlStr);
  if (!url.searchParams.has('sslmode')) {
    url.searchParams.set('sslmode', 'require');
  }
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
}

async function main() {
  const config = buildConfig(DATABASE_URL);
  console.log('\n[VERIFY] Connecting to:', mask(DATABASE_URL));
  console.log('[VERIFY] READ-ONLY verification — no data will be modified.\n');

  const client = new Client(config);
  await client.connect();

  // ── 1. All activities ────────────────────────────────────────────────
  console.log('── 1. All activities ─────────────────────────────────────');
  const acts = await client.query(
    `SELECT id, name, type, status, created_at,
            (config->>'isGlobalEnabled')::boolean AS is_enabled
       FROM public.activities ORDER BY id`
  );
  console.log(`Found ${acts.rows.length} activities:`);
  for (const r of acts.rows) {
    console.log(`  [${r.id}] "${r.name}" type=${r.type} status=${r.status} isGlobalEnabled=${r.is_enabled}`);
  }

  // ── 2. All milestone IDs per activity ────────────────────────────────
  console.log('\n── 2. All milestone IDs per activity ─────────────────────');
  const allMs = await client.query(
    `SELECT id, name,
            config->'milestones' AS milestones
       FROM public.activities
      WHERE (config->'milestones') IS NOT NULL
        AND jsonb_array_length(config->'milestones') > 0
      ORDER BY id`
  );
  if (allMs.rows.length === 0) {
    console.log('  No milestones found in any activity config.');
  }
  for (const r of allMs.rows) {
    const milestones = r.milestones ?? [];
    console.log(`\n  Activity [${r.id}] "${r.name}":`);
    for (const ms of milestones) {
      console.log(`    milestone id=${ms.id} threshold=${ms.threshold} rewardType=${ms.rewardType} medalId=${ms.medalId ?? '—'}`);
    }
  }

  // ── 3. Normalise all IDs and check for cross-activity conflicts ────
  console.log('\n── 3. Normalised ID conflict check ─────────────────────────');
  function normalize(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const stripped = s.replace(/^m/i, '');
    const n = Number(stripped);
    if (!isFinite(n) || n <= 0) return null;
    return String(Math.floor(n));
  }

  const normalizedMap = new Map(); // normalized → [{activityId, activityName, originalId}]
  for (const r of allMs.rows) {
    const milestones = r.milestones ?? [];
    for (const ms of milestones) {
      const norm = normalize(ms.id);
      if (!norm) continue;
      const key = norm;
      if (!normalizedMap.has(key)) normalizedMap.set(key, []);
      normalizedMap.get(key).push({
        activityId: r.id,
        activityName: r.name,
        originalId: String(ms.id),
      });
    }
  }

  let conflictCount = 0;
  for (const [normId, usages] of normalizedMap.entries()) {
    if (usages.length > 1) {
      conflictCount++;
      console.log(`  CONFLICT: normalised ID="${normId}" used by ${usages.length} activities:`);
      for (const u of usages) {
        console.log(`    - Activity [${u.activityId}] "${u.activityName}" (original: "${u.originalId}")`);
      }
    }
  }
  if (conflictCount === 0) {
    console.log('  ✅ No normalised milestone ID conflicts across activities.');
  } else {
    console.log(`  ⚠️  ${conflictCount} conflict(s) found — see above.`);
  }

  // ── 4. milestone_rewards schema check ─────────────────────────────────
  console.log('\n── 4. milestone_rewards columns ───────────────────────────');
  const cols = await client.query(
    `SELECT column_name, data_type, column_default, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'milestone_rewards'
      ORDER BY ordinal_position`
  );
  const colNames = new Set(cols.rows.map(r => r.column_name));
  console.log(`Columns (${cols.rows.length}):`);
  for (const c of cols.rows) {
    const flag = c.column_name === 'admin_bypass' ? ' ← admin bypass (m17 target)' :
                c.column_name === 'admin_bypass_source' ? ' ← bypass audit trail (m17 target)' :
                '';
    console.log(`  ${c.column_name} ${c.data_type} default=${c.column_default} nullable=${c.is_nullable}${flag}`);
  }
  console.log(`\n  admin_bypass present: ${colNames.has('admin_bypass')}`);
  console.log(`  admin_bypass_source present: ${colNames.has('admin_bypass_source')}`);

  // ── 5. Existing milestone_rewards rows ─────────────────────────────────
  console.log('\n── 5. milestone_rewards row sample ────────────────────────');
  const rows = await client.query(
    `SELECT user_id, milestone_id, is_claimed, is_locked, claimed_at,
            reward_type, reward_value
       FROM public.milestone_rewards
      ORDER BY user_id, milestone_id
      LIMIT 20`
  );
  console.log(`Total rows (sample): ${rows.rowCount} shown of all (first 20):`);
  for (const r of rows.rows) {
    console.log(`  user=${r.user_id} ms_id=${r.milestone_id} claimed=${r.is_claimed} locked=${r.is_locked} bypass=${r.admin_bypass} reward=${r.reward_type}@${r.reward_value}`);
  }

  // ── 6. Summary ─────────────────────────────────────────────────────
  console.log('\n── Summary ───────────────────────────────────────────────');
  console.log(`  Activities in DB:         ${acts.rows.length}`);
  console.log(`  Activities with milestones: ${allMs.rows.length}`);
  console.log(`  Normalised unique IDs:     ${normalizedMap.size}`);
  console.log(`  Cross-activity conflicts:  ${conflictCount}`);
  console.log(`  migration17 applied:       ${colNames.has('admin_bypass') ? 'YES (column exists)' : 'NO (column missing)'}`);

  await client.end();
  console.log('\n[VERIFY] Done. Exit code 0.');
}

main().catch(err => {
  console.error('\n[VERIFY] ERROR:', err.message);
  process.exit(1);
});
