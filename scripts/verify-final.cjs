const {Pool} = require('/var/www/app/node_modules/pg');
const p = new Pool({connectionString: 'postgresql://postgres:PhbcRcx5Wt@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres', ssl: {rejectUnauthorized: false}});
(async () => {
  const a = await p.query("SELECT alias_value, uuid FROM public.user_alias WHERE alias_value='128'");
  console.log('alias:', JSON.stringify(a.rows));
  const d = await p.query("SELECT user_id, daily_energy_consumed, daily_money_recharged FROM public.user_daily_tasks WHERE date::date = CURRENT_DATE");
  console.log('today tasks:', JSON.stringify(d.rows));
  const u = await p.query("SELECT id FROM public.users ORDER BY created_at DESC LIMIT 5");
  console.log('recent users:', JSON.stringify(u.rows));
  p.end();
})();