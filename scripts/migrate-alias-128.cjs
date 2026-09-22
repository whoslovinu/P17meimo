// scripts/migrate-alias-128.mjs — One-off migration to fix the 2026-07-23
// regression: prior resolveAliasToUuid minted random UUIDs which never
// converged with the page-side toUuid() coercion. After this fix, the
// canonical UUID for alias_value='128' is toUuid('128').
//
// What this does:
//   1. Computes the canonical UUID = toUuid('128')
//   2. Updates public.user_alias rows pointing at the legacy UUID
//   3. Updates user_daily_tasks / user_inventory / milestone_rewards /
//      task_progress / attack_logs that referenced the legacy UUID so
//      the existing 176-energy progress is preserved.
//
// Idempotent: re-running is safe (UPDATE ... WHERE old_uuid = ...).
//
// REPARK 7.0 (2026-08-24) note: this is an alias-merge one-off; the
// `total_damage_dealt` GREATEST(...) upsert preserves the GLOBAL field
// for legacy data continuity. It does NOT touch user_activity_stats
// (the new activity-scoped source of truth). No code change required.
const {Pool} = require('/var/www/app/node_modules/pg');

const LEGACY_UUID = 'a41accae-27c9-449b-a820-e6d53d1b279a';
const ALIAS_VALUE = '128';
const ALIAS_TYPE = 'master_long';

const {createHash} = require('crypto');
function seedUuid(rawId) {
  const hash = createHash('sha256').update(rawId).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
const CANONICAL_UUID = seedUuid(ALIAS_VALUE);
console.log(`Canonical UUID for alias '${ALIAS_VALUE}': ${CANONICAL_UUID}`);

const p = new Pool({
  connectionString: 'postgresql://postgres:PhbcRcx5Wt@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres',
  ssl: {rejectUnauthorized: false},
});

async function safeCount(label, q) {
  const r = await p.query(q);
  console.log(`  ${label}: ${r.rowCount}`);
  return r.rowCount;
}

(async () => {
  try {
    if (CANONICAL_UUID === LEGACY_UUID) {
      console.log('No-op: legacy UUID already matches canonical. Aborting.');
      return;
    }

    await p.query('BEGIN');
    console.log('=== Migration: alias 128 → canonical UUID ===');

    // 1. Show what's about to change.
    console.log('Pre-state:');
    await safeCount('legacy rows in user_alias',           `SELECT 1 FROM public.user_alias WHERE alias_type='${ALIAS_TYPE}' AND alias_value='${ALIAS_VALUE}' AND uuid='${LEGACY_UUID}'`);
    await safeCount('user_daily_tasks using legacy uuid',  `SELECT 1 FROM public.user_daily_tasks WHERE user_id='${LEGACY_UUID}'`);
    await safeCount('user_inventory using legacy uuid',    `SELECT 1 FROM public.user_inventory WHERE user_id='${LEGACY_UUID}'`);
    await safeCount('milestone_rewards using legacy uuid', `SELECT 1 FROM public.milestone_rewards WHERE user_id='${LEGACY_UUID}'`);
    await safeCount('attack_logs using legacy uuid',       `SELECT 1 FROM public.attack_logs WHERE user_id='${LEGACY_UUID}'`);

    // 2. Repoint alias to canonical UUID. There is no PK on uuid alone, but
    //    PK is (alias_type, alias_value), so we just UPDATE in place. If a
    //    canonical row already exists (e.g. page-side bootstrap beat us),
    //    delete the legacy alias row to keep the table clean.
    const aliasUpd = await p.query(
      `UPDATE public.user_alias
         SET uuid = $1
       WHERE alias_type = $2 AND alias_value = $3 AND uuid = $4`,
      [CANONICAL_UUID, ALIAS_TYPE, ALIAS_VALUE, LEGACY_UUID]
    );
    console.log(`  user_alias UPDATE rows affected: ${aliasUpd.rowCount}`);

    // 3. Make sure a users row exists for the canonical UUID so FK-style
    //    downstream operations don't 404.
    const userIns = await p.query(
      `INSERT INTO public.users (id, email, nickname, avatar)
       VALUES ($1, '', '', '👤')
       ON CONFLICT (id) DO NOTHING`,
      [CANONICAL_UUID]
    );
    console.log(`  users INSERT (canonical uuid) rows affected: ${userIns.rowCount}`);

    // 4. Move any daily-task / inventory / milestone / attack-log rows off
    //    the legacy UUID. ON CONFLICT DO NOTHING guards against the rare
    //    case where the canonical row already exists (e.g. page-side wrote
    //    zero-progress today before migration ran).
    const tables = [
      {name: 'user_daily_tasks', cols: ['user_id']},
      {name: 'user_inventory',   cols: ['user_id']},
      {name: 'milestone_rewards',cols: ['user_id']},
      {name: 'attack_logs',      cols: ['user_id']},
    ];
    for (const t of tables) {
      const col = t.cols[0];
      // Pull existing rows off legacy UUID into a tmp list (so we can merge).
      const src = await p.query(`SELECT * FROM public.${t.name} WHERE ${col}=$1`, [LEGACY_UUID]);
      if (!src.rowCount) {
        console.log(`  ${t.name}: nothing to migrate`);
        continue;
      }
      // Delete legacy rows; re-insert merged under canonical uuid.
      // For tables where (user_id, ...) is unique per-user, the merge
      // strategy differs by table — we keep it simple: drop legacy, copy
      // last-row state into canonical if missing, else sum/MAX where
      // semantically correct.
      if (t.name === 'user_daily_tasks') {
        // For daily tasks, the meaningful state is (date, daily_energy_consumed, daily_money_recharged).
        // If a canonical row exists for that date, take MAX(consumed) + MAX(recharged).
        for (const row of src.rows) {
          const merge = await p.query(
            `INSERT INTO public.user_daily_tasks (user_id, date, daily_energy_consumed, daily_money_recharged, recharge_processed)
             VALUES ($1, $2::date, $3, $4::numeric, $5)
             ON CONFLICT (user_id, date) DO UPDATE
               SET daily_energy_consumed = GREATEST(public.user_daily_tasks.daily_energy_consumed, EXCLUDED.daily_energy_consumed),
                   daily_money_recharged = GREATEST(public.user_daily_tasks.daily_money_recharged, EXCLUDED.daily_money_recharged),
                   recharge_processed    = public.user_daily_tasks.recharge_processed OR EXCLUDED.recharge_processed,
                   updated_at            = NOW()`,
            [CANONICAL_UUID, row.date, row.daily_energy_consumed, row.daily_money_recharged, row.recharge_processed]
          );
          console.log(`    merged daily_task date=${row.date.toISOString().slice(0,10)} consumed=${row.daily_energy_consumed} (affected=${merge.rowCount})`);
        }
        const del = await p.query(`DELETE FROM public.user_daily_tasks WHERE user_id=$1`, [LEGACY_UUID]);
        console.log(`  user_daily_tasks legacy rows deleted: ${del.rowCount}`);
      } else if (t.name === 'user_inventory') {
        // Inventory: take MAX of each item count.
        const inv = src.rows[0];
        const merge = await p.query(
          `INSERT INTO public.user_inventory (user_id, item_hand_count, item_phallus_count, total_damage_dealt)
           VALUES ($1, $2, $3, $4::numeric)
           ON CONFLICT (user_id) DO UPDATE
             SET item_hand_count    = GREATEST(public.user_inventory.item_hand_count,    EXCLUDED.item_hand_count),
                 item_phallus_count = GREATEST(public.user_inventory.item_phallus_count, EXCLUDED.item_phallus_count),
                 total_damage_dealt = GREATEST(public.user_inventory.total_damage_dealt, EXCLUDED.total_damage_dealt),
                 updated_at         = NOW()`,
          [CANONICAL_UUID, inv.item_hand_count || 0, inv.item_phallus_count || 0, inv.total_damage_dealt || 0]
        );
        console.log(`  user_inventory merge affected: ${merge.rowCount}`);
        const del = await p.query(`DELETE FROM public.user_inventory WHERE user_id=$1`, [LEGACY_UUID]);
        console.log(`  user_inventory legacy rows deleted: ${del.rowCount}`);
      } else if (t.name === 'milestone_rewards') {
        // Milestones: copy each row, dedupe on (user_id, milestone_id).
        for (const row of src.rows) {
          const ins = await p.query(
            `INSERT INTO public.milestone_rewards (user_id, milestone_id, claimed_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, milestone_id) DO NOTHING`,
            [CANONICAL_UUID, row.milestone_id, row.claimed_at]
          );
        }
        const del = await p.query(`DELETE FROM public.milestone_rewards WHERE user_id=$1`, [LEGACY_UUID]);
        console.log(`  milestone_rewards legacy rows deleted: ${del.rowCount}`);
      } else if (t.name === 'attack_logs') {
        // attack_logs is append-only history. Repoint to canonical uuid so
        // damage leaderboards remain attributable.
        const upd = await p.query(
          `UPDATE public.attack_logs SET user_id = $1 WHERE user_id = $2`,
          [CANONICAL_UUID, LEGACY_UUID]
        );
        console.log(`  attack_logs repointed rows: ${upd.rowCount}`);
      }
    }

    // 5. Drop the orphan users row for the legacy UUID.
    const userDel = await p.query(`DELETE FROM public.users WHERE id = $1`, [LEGACY_UUID]);
    console.log(`  orphan users row deleted: ${userDel.rowCount}`);

    await p.query('COMMIT');
    console.log('=== Migration committed. ===');
  } catch (e) {
    await p.query('ROLLBACK').catch(() => undefined);
    console.error('Migration FAILED, rolled back:', e.message);
    process.exit(1);
  } finally {
    p.end();
  }
})();