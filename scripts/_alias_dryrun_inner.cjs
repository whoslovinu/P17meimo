const { Client } = require('/var/www/app/node_modules/pg');
const c = new Client({ host:'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com', port:5432, user:'postgres', password:'YOUR_DATABASE_PASSWORD', database:'postgres', ssl:{ rejectUnauthorized:false } });

(async () => {
  await c.connect();
  const alias = 'TEST_MASTER_' + Date.now();

  // Step 1: simulate alias resolution
  let r = await c.query("SELECT uuid FROM public.user_alias WHERE alias_type='master_long' AND alias_value=$1", [alias]);
  if (!r.rowCount) {
    const ins = await c.query("INSERT INTO public.user_alias(alias_type, alias_value, uuid) VALUES('master_long', $1, gen_random_uuid()) ON CONFLICT DO NOTHING RETURNING uuid", [alias]);
    console.log('INSERT result:', ins.rowCount, 'rows');
    r = await c.query("SELECT uuid FROM public.user_alias WHERE alias_type='master_long' AND alias_value=$1", [alias]);
  }
  const uuid = r.rows[0].uuid;
  console.log('Resolved UUID for alias ' + alias + ':', uuid);

  // Step 2: ensure user row exists
  await c.query("INSERT INTO public.users (id, nickname, avatar) VALUES($1, '', '👤') ON CONFLICT(id) DO NOTHING", [uuid]);
  console.log('Users row ensured for', uuid);

  // Step 3: simulate task_progress upsert (no NEW uuid inserted; uses existing uuid FK target)
  await c.query(
    "INSERT INTO public.task_progress (user_id, task_type, reset_date, current_progress, is_claimed) VALUES($1, 'daily_energy', '2026-07-22', 100, false) ON CONFLICT (user_id, task_type, reset_date) DO UPDATE SET current_progress = EXCLUDED.current_progress",
    [uuid]
  );
  console.log('task_progress upsert OK');

  // Step 4: simulate user_daily_tasks upsert
  const dt = await c.query(
    "INSERT INTO public.user_daily_tasks (user_id, date, daily_energy_consumed, daily_money_recharged, recharge_processed) VALUES($1, '2026-07-22', 100, 0, false) ON CONFLICT (user_id, date) DO UPDATE SET daily_energy_consumed = public.user_daily_tasks.daily_energy_consumed + 100 RETURNING daily_energy_consumed",
    [uuid]
  );
  console.log('user_daily_tasks upsert OK; new total =', dt.rows[0].daily_energy_consumed);

  // Step 5: idem test — same alias should return same uuid
  r = await c.query("SELECT uuid FROM public.user_alias WHERE alias_type='master_long' AND alias_value=$1", [alias]);
  console.log('Idem test: same alias →', r.rows[0].uuid === uuid ? 'SAME UUID ✓' : 'DIFFERENT UUID ✗');

  // Cleanup
  await c.query("DELETE FROM public.user_daily_tasks WHERE user_id=$1", [uuid]);
  await c.query("DELETE FROM public.task_progress WHERE user_id=$1", [uuid]);
  await c.query("DELETE FROM public.user_alias WHERE uuid=$1", [uuid]);
  await c.query("DELETE FROM public.users WHERE id=$1", [uuid]);
  console.log('Cleanup done.');

  await c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });