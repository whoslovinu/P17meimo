require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const PG_CONFIG = {
  host: process.env.PG_HOST ?? '127.0.0.1',
  port: Number(process.env.PG_PORT ?? 5433),
  user: process.env.PG_USER ?? 'postgres',
  password: process.env.PG_PASSWORD ?? 'postgres',
  database: process.env.PG_DATABASE ?? 'h5meimo',
};

const pool = new Pool(PG_CONFIG);

async function resetBossHp() {
  console.log('🔧 Resetting boss HP to 100000 via AWS RDS (pg.Pool)...');

  const updateResult = await pool.query(
    `UPDATE public.boss_status
        SET current_hp = 100000,
            max_hp = 100000,
            version = version + 1,
            last_updated_at = NOW()
      WHERE boss_id = $1`,
    ['00000000-0000-0000-0000-000000000001']
  );

  if (updateResult.rowCount === 0) {
    await pool.query(
      `INSERT INTO public.boss_status (boss_id, current_hp, max_hp, version, last_updated_at)
       VALUES ($1, 100000, 100000, 1, NOW())
       ON CONFLICT (boss_id) DO NOTHING`,
      ['00000000-0000-0000-0000-000000000001']
    );
    console.log('✅ Boss HP row created at 100000');
  } else {
    console.log('✅ Boss HP reset to 100000');
  }

  const verify = await pool.query(
    `SELECT current_hp, max_hp FROM public.boss_status WHERE boss_id = $1`,
    ['00000000-0000-0000-0000-000000000001']
  );

  const row = verify.rows[0];
  console.log(`📊 Boss state: ${row.current_hp}/${row.max_hp}`);

  await pool.end();
}

resetBossHp().catch((err) => {
  console.error('❌ Failed to reset boss HP:', err);
  process.exit(1);
});
