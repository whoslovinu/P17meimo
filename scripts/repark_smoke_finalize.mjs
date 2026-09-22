// REPARK 7.0 — Finalize RPC smoke test (production).
//
// Goal: prove that finalize_activity_milestone_rewards is now activity-scoped.
// Everything runs inside a single transaction that is rolled back at the end.
//
// 1) BEGIN
// 2) Pick an existing user, upsert user_activity_stats(activity_id=1, total=60000)
// 3) Call finalize_activity_milestone_rewards(dry_run=true)  → check eligible counts
// 4) Call finalize_activity_milestone_rewards(dry_run=false) → check insert counts
// 5) ROLLBACK (production untouched)

import process from 'node:process';
import pg from 'pg';
const { Client } = pg;

const url = process.env.DATABASE_URL || 'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN');

    // Snapshot pre-state
    const preStats = await c.query(`SELECT COUNT(*)::int AS n FROM public.user_activity_stats WHERE activity_id=1`);
    const preRewards = await c.query(`SELECT COUNT(*)::int AS n FROM public.milestone_rewards`);

    // Pick any existing user
    const u = await c.query(`SELECT id FROM public.users LIMIT 1`);
    if (u.rows.length === 0) {
      console.log(JSON.stringify({ ok: false, err: 'no users in DB' }));
      await c.query('ROLLBACK');
      return;
    }
    const userId = u.rows[0].id;
    console.log(JSON.stringify({ step: 'pick_user', userId }));

    // Seed user_activity_stats for activity 1 = 60000
    await c.query(
      `INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
       VALUES ($1, 1, 60000)
       ON CONFLICT (user_id, activity_id) DO UPDATE SET total_damage = EXCLUDED.total_damage, updated_at = NOW()`,
      [userId]
    );

    const seedCheck = await c.query(
      `SELECT total_damage FROM public.user_activity_stats WHERE user_id=$1 AND activity_id=1`,
      [userId]
    );
    console.log(JSON.stringify({ step: 'seed', total_damage: seedCheck.rows[0]?.total_damage }));

    // DRY-RUN: payload mirrors the activity 1 milestones (25000 / 50000 / 75000)
    const dryResult = await c.query(
      `SELECT finalize_activity_milestone_rewards(
         $1::bigint, $2::jsonb, TRUE
       ) AS out`,
      [
        1,
        JSON.stringify([
          { id: 75, threshold: 25000, rewardType: 'ENERGY', energyValue: 500 },
          { id: 50, threshold: 50000, rewardType: 'ENERGY', energyValue: 1000 },
          { id: 25, threshold: 75000, rewardType: 'ENERGY', energyValue: 2001 },
        ]),
      ]
    );
    const dryOut = dryResult.rows[0].out;
    console.log(JSON.stringify({ step: 'dry_run', out: dryOut }));

    // PRODUCTION: now insert the rows
    const realResult = await c.query(
      `SELECT finalize_activity_milestone_rewards(
         $1::bigint, $2::jsonb, FALSE
       ) AS out`,
      [
        1,
        JSON.stringify([
          { id: 75, threshold: 25000, rewardType: 'ENERGY', energyValue: 500 },
          { id: 50, threshold: 50000, rewardType: 'ENERGY', energyValue: 1000 },
          { id: 25, threshold: 75000, rewardType: 'ENERGY', energyValue: 2001 },
        ]),
      ]
    );
    const realOut = realResult.rows[0].out;
    console.log(JSON.stringify({ step: 'production_run', out: realOut }));

    // Confirm milestone_rewards now has rows for this user (still inside txn)
    const after = await c.query(
      `SELECT milestone_id, is_claimed, reward_type, reward_value
         FROM public.milestone_rewards
        WHERE user_id=$1`,
      [userId]
    );
    console.log(JSON.stringify({ step: 'milestone_rewards_after', rows: after.rows }));

    // Test cross-activity isolation: if a different activity has total_damage=0,
    // then finalize_activity_milestone_rewards(p_activity_id=99, …) should
    // return eligibleUsers=0 for this same user.
    const crossIso = await c.query(
      `SELECT finalize_activity_milestone_rewards(
         $1::bigint, $2::jsonb, TRUE
       ) AS out`,
      [
        99,
        JSON.stringify([
          { id: 75, threshold: 25000, rewardType: 'ENERGY', energyValue: 500 },
        ]),
      ]
    );
    console.log(JSON.stringify({ step: 'cross_activity_isolation', out: crossIso.rows[0].out }));

    // ROLLBACK — production must stay untouched
    await c.query('ROLLBACK');
    const finalStats = await c.query(`SELECT COUNT(*)::int AS n FROM public.user_activity_stats WHERE activity_id=1`);
    const finalRewards = await c.query(`SELECT COUNT(*)::int AS n FROM public.milestone_rewards`);
    console.log(JSON.stringify({
      step: 'rollback_complete',
      pre_stats_count: preStats.rows[0].n,
      post_stats_count: finalStats.rows[0].n,
      pre_rewards_count: preRewards.rows[0].n,
      post_rewards_count: finalRewards.rows[0].n,
      production_unchanged: preStats.rows[0].n === finalStats.rows[0].n
                          && preRewards.rows[0].n === finalRewards.rows[0].n,
    }));
  } catch (err) {
    console.error('SMOKE_ERROR:', err.message);
    try { await c.query('ROLLBACK'); } catch {}
    process.exit(3);
  } finally {
    await c.end();
  }
})();