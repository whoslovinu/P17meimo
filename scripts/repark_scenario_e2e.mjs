// REPARK 7.0 — End-to-end scenario (DB seed → DB-driven verification → rollback).
//
// The live endpoint already returned empty on the previous probe (no rows in
// user_activity_stats for activity 1). This script:
//   1) Seeds activity 1 = 10000 for a real user
//   2) Runs the EXACT SQL the route runs, asserts user appears
//   3) Seeds activity 2 = 0, asserts user does NOT appear for activity 2
//   4) ROLLBACK

import process from 'node:process';
import pg from 'pg';
const { Client } = pg;

const url = process.env.DATABASE_URL || 'postgresql://postgres:PhbcRcx5Wt@127.0.0.1:5433/postgres';

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('BEGIN');

    const u = await c.query(`SELECT id FROM public.users LIMIT 1`);
    const userId = u.rows[0].id;

    // Activity 1 = active (per getActiveActivity config)
    await c.query(
      `INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
       VALUES ($1, 1, 10000)
       ON CONFLICT (user_id, activity_id) DO UPDATE SET total_damage = EXCLUDED.total_damage`,
      [userId]
    );
    // Activity 2 = inactive, user has 0 there
    await c.query(
      `INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
       VALUES ($1, 2, 0)
       ON CONFLICT (user_id, activity_id) DO UPDATE SET total_damage = EXCLUDED.total_damage`,
      [userId]
    );

    // Re-confirm: getActiveActivity returns activity 1
    const active = await c.query(
      `SELECT id, name FROM public.activities WHERE (config->>'isGlobalEnabled')::boolean = true LIMIT 1`
    );
    console.log(JSON.stringify({ activeActivity: active.rows[0] }));

    // Re-confirm: simulate the live route query
    const liveQuery = await c.query(
      `SELECT uas.user_id, uas.total_damage, COALESCE(NULLIF(u.nickname, ''), '神秘玩家') AS nickname
         FROM public.user_activity_stats uas
         LEFT JOIN public.users u ON u.id = uas.user_id
        WHERE uas.activity_id = $1 AND uas.total_damage > 0
        ORDER BY uas.total_damage DESC
        LIMIT $2`,
      [active.rows[0].id, 50]
    );
    console.log(JSON.stringify({
      step: 'live_query_for_active_activity',
      activityId: active.rows[0].id,
      count: liveQuery.rows.length,
      rows: liveQuery.rows,
    }));

    // Cross-check non-active activity
    const inactiveQuery = await c.query(
      `SELECT uas.user_id, uas.total_damage
         FROM public.user_activity_stats uas
        WHERE uas.activity_id = 2 AND uas.total_damage > 0
        ORDER BY uas.total_damage DESC LIMIT 50`
    );
    console.log(JSON.stringify({
      step: 'query_for_inactive_activity_2',
      count: inactiveQuery.rows.length,
      rows: inactiveQuery.rows,
    }));

    // User confirmation
    const userInActive = liveQuery.rows.some((r) => r.user_id === userId);
    const userInInactive = inactiveQuery.rows.some((r) => r.user_id === userId);
    console.log(JSON.stringify({
      step: 'assertions',
      userInActive: userInActive,
      userInInactive: userInInactive,
      pass: userInActive && !userInInactive,
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