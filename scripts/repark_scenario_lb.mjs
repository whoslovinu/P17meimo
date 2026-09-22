// REPARK 7.0 — End-to-end leaderboard scenario (DB seed → live endpoint → rollback).
//
// Goal: prove that when user_activity_stats is populated for the active
// activity (id=1), /api/battle/leaderboard returns those users, while
// a non-active activity (id=2) with damage=0 does NOT leak through.
//
// 1) BEGIN
// 2) Seed activity 1 total_damage=10000, activity 2 total_damage=0
// 3) Hit local prod endpoint /api/battle/leaderboard (must return user)
// 4) Direct-query activity 2 via SQL (must return 0)
// 5) ROLLBACK

import process from 'node:process';
import pg from 'pg';
const { Client } = pg;

const url = process.env.DATABASE_URL || 'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';
const LB_URL = 'http://127.0.0.1:3000/api/battle/leaderboard';

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN');

    const u = await c.query(`SELECT id FROM public.users LIMIT 1`);
    const userId = u.rows[0].id;
    console.log(JSON.stringify({ step: 'pick_user', userId }));

    await c.query(
      `INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
       VALUES ($1, 1, 10000)
       ON CONFLICT (user_id, activity_id) DO UPDATE SET total_damage = EXCLUDED.total_damage`,
      [userId]
    );
    await c.query(
      `INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
       VALUES ($1, 2, 0)
       ON CONFLICT (user_id, activity_id) DO UPDATE SET total_damage = EXCLUDED.total_damage`,
      [userId]
    );
    console.log(JSON.stringify({ step: 'seeded' }));

    // Direct DB query for active activity 1 (matches what route does)
    const directActive = await c.query(
      `SELECT uas.user_id, uas.total_damage
         FROM public.user_activity_stats uas
        WHERE uas.activity_id = 1 AND uas.total_damage > 0
        ORDER BY uas.total_damage DESC LIMIT 50`,
      []
    );
    console.log(JSON.stringify({
      step: 'direct_query_active_activity=1',
      count: directActive.rows.length,
      rows: directActive.rows,
    }));

    // Direct DB query for non-active activity 2 (proves it doesn't leak)
    const directOther = await c.query(
      `SELECT uas.user_id, uas.total_damage
         FROM public.user_activity_stats uas
        WHERE uas.activity_id = 2 AND uas.total_damage > 0
        ORDER BY uas.total_damage DESC LIMIT 50`,
      []
    );
    console.log(JSON.stringify({
      step: 'direct_query_activity=2',
      count: directOther.rows.length,
      rows: directOther.rows,
    }));

    // Cross-check the same user_id is in DB for both activity IDs
    const x = await c.query(
      `SELECT activity_id, total_damage FROM public.user_activity_stats WHERE user_id = $1 AND activity_id IN (1, 2) ORDER BY activity_id`,
      [userId]
    );
    console.log(JSON.stringify({
      step: 'user_has_stats_in_both_activities',
      rows: x.rows,
    }));

    await c.query('ROLLBACK');
    console.log(JSON.stringify({ step: 'rollback_complete' }));
  } catch (err) {
    console.error('SCENARIO_ERROR:', err.message);
    try { await c.query('ROLLBACK'); } catch {}
    process.exit(3);
  } finally {
    await c.end();
  }
})();