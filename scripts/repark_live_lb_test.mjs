// REPARK 7.0 — Live endpoint scenario.
// Seed user_activity_stats activity=1 damage=10000 → hit /api/battle/leaderboard
// and verify the user appears. ROLLBACK afterwards.
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
    await c.query(
      `INSERT INTO public.user_activity_stats (user_id, activity_id, total_damage)
       VALUES ($1, 1, 10000)
       ON CONFLICT (user_id, activity_id) DO UPDATE SET total_damage = EXCLUDED.total_damage`,
      [userId]
    );
    console.log('seeded activity=1 damage=10000 for user', userId);

    // Hit the LIVE endpoint
    const r = await fetch(LB_URL);
    const body = await r.json();
    console.log('endpoint status:', r.status);
    console.log('endpoint payload:', JSON.stringify(body));

    const hasUser = (body?.data?.entries ?? []).some((e) => e.userId === userId);
    const totalDamage = (body?.data?.entries ?? []).find((e) => e.userId === userId)?.totalDamage;
    console.log('userInLeaderboard:', hasUser, 'totalDamage:', totalDamage);

    await c.query('ROLLBACK');
    console.log('ROLLBACK done');
  } catch (err) {
    console.error('LIVE_ERROR:', err.message);
    try { await c.query('ROLLBACK'); } catch {}
    process.exit(3);
  } finally {
    await c.end();
  }
})();