const {Pool} = require('/var/www/app/node_modules/pg');
const p = new Pool({connectionString: process.env.DATABASE_URL || 'postgresql://postgres:YOUR_DATABASE_PASSWORD@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres'});
(async () => {
  try {
    const r1 = await p.query("SELECT alias_type, alias_value, uuid, created_at FROM public.user_alias WHERE alias_value = '128'");
    console.log('=== aliases for 128 ===');
    console.log(JSON.stringify(r1.rows, null, 2));

    const r2 = await p.query("SELECT id, uuid, energy, last_daily_reset_at FROM public.users ORDER BY created_at DESC LIMIT 10");
    console.log('=== recent users ===');
    console.log(JSON.stringify(r2.rows, null, 2));

    const r3 = await p.query("SELECT user_id, date, energy_consumed, recharge_count FROM public.daily_task_progress WHERE user_id IN (SELECT uuid FROM public.user_alias WHERE alias_value='128') OR date = CURRENT_DATE ORDER BY date DESC LIMIT 5");
    console.log('=== daily_task_progress for today ===');
    console.log(JSON.stringify(r3.rows, null, 2));
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    p.end();
  }
})();
