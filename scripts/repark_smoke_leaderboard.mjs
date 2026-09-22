// REPARK 7.0 — Leaderboard migration scenario test (production tunnel).
//
// Goal: verify that the same user has different ranks / damage across two
// activities, matching the leaderboard contract.
//
// 1) BEGIN
// 2) Pick an existing user, seed user_activity_stats for activity A=10000
//    and activity B=0 (or no row at all)
// 3) Run the new leaderboard SQL for each activity_id, compare
// 4) ROLLBACK

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
    if (u.rows.length === 0) {
      console.log(JSON.stringify({ ok: false, err: 'no users' }));
      await c.query('ROLLBACK');
      return;
    }
    const userId = u.rows[0].id;
    console.log(JSON.stringify({ step: 'pick_user', userId }));

    // Activity A: damage = 10000 (real activity_id=1, which is the active one)
    // Activity B: damage = 0 (real activity_id=2) — both yield same result
    const seedA = await c.query(
      `INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
       VALUES ($1, $2, 10000)
       ON CONFLICT (user_id, activity_id) DO UPDATE SET total_damage = EXCLUDED.total_damage, updated_at = NOW()
       RETURNING total_damage`,
      [userId, 1]
    );
    const seedB = await c.query(
      `INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
       VALUES ($1, $2, 0)
       ON CONFLICT (user_id, activity_id) DO UPDATE SET total_damage = EXCLUDED.total_damage, updated_at = NOW()
       RETURNING total_damage`,
      [userId, 2]
    );
    console.log(JSON.stringify({ step: 'seed', activityA: seedA.rows[0]?.total_damage, activityB: seedB.rows[0]?.total_damage }));

    // Query for activity 1 — should include user with damage 10000
    const qA = await c.query(
      `SELECT uas.user_id, uas.total_damage, COALESCE(NULLIF(u.nickname, ''), '神秘玩家') AS nickname
         FROM public.user_activity_stats uas
         LEFT JOIN public.users u ON u.id = uas.user_id
        WHERE uas.activity_id = $1 AND uas.total_damage > 0
        ORDER BY uas.total_damage DESC
        LIMIT 50`,
      [1]
    );
    console.log(JSON.stringify({ step: 'leaderboard_A', count: qA.rows.length, rows: qA.rows }));

    // Query for activity 2 — user is in there but total_damage=0, so filtered out
    const qB = await c.query(
      `SELECT uas.user_id, uas.total_damage, COALESCE(NULLIF(u.nickname, ''), '神秘玩家') AS nickname
         FROM public.user_activity_stats uas
         LEFT JOIN public.users u ON u.id = uas.user_id
        WHERE uas.activity_id = $1 AND uas.total_damage > 0
        ORDER BY uas.total_damage DESC
        LIMIT 50`,
      [2]
    );
    console.log(JSON.stringify({ step: 'leaderboard_B', count: qB.rows.length, rows: qB.rows }));

    // Cross-check: confirm user has activity_id=1 with damage=10000 AND
    // activity_id=2 with damage=0 in the SAME table row.
    const cross = await c.query(
      `SELECT activity_id, total_damage FROM public.user_activity_stats WHERE user_id = $1 AND activity_id IN (1, 2) ORDER BY activity_id`,
      [userId]
    );
    console.log(JSON.stringify({ step: 'cross_check_user_activity_stats', rows: cross.rows }));

    // Critical assertion: user_id must NOT appear in qB.rows (because
    // total_damage = 0 in activity 102, filtered by WHERE ... > 0).
    const userAppearsInB = qB.rows.some((r) => r.user_id === userId);
    console.log(JSON.stringify({
      step: 'assertions',
      userInA: qA.rows.some((r) => r.user_id === userId),
      userInB: userAppearsInB,
      pass: !userAppearsInB,
    }));

    await c.query('ROLLBACK');
    console.log(JSON.stringify({ step: 'rollback_complete' }));
  } catch (err) {
    console.error('SMOKE_ERROR:', err.message);
    try { await c.query('ROLLBACK'); } catch {}
    process.exit(3);
  } finally {
    await c.end();
  }
})();