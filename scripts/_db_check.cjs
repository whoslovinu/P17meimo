// scripts/_db_check.cjs — directly hit RDS to confirm UUID error
const { Client } = require('pg');

(async () => {
  const c = new Client({
    host: 'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com',
    port: 5432,
    user: 'postgres',
    password: 'YOUR_DATABASE_PASSWORD',
    database: 'postgres',
  });
  await c.connect();
  // 1) Insert with non-UUID user_id (replicate customer's request)
  try {
    const r = await c.query(
      `INSERT INTO public.users (id, nickname, avatar)
       VALUES ($1, '', '👤')
       ON CONFLICT (id) DO NOTHING`,
      ['test_user_002']
    );
    console.log('INSERT OK', r.rowCount);
  } catch (e) {
    console.log('INSERT ERR:', e.code, '-', e.message);
  }
  // 2) Check column type
  const t = await c.query(`
    SELECT data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name='users' AND column_name='id'
  `);
  console.log('Column type:', t.rows[0]?.data_type);
  await c.end();
})();