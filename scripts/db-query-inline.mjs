const {Pool} = require('/var/www/app/node_modules/pg');
const p = new Pool({connectionString: process.env.DATABASE_URL || 'postgresql://postgres:YOUR_DATABASE_PASSWORD@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres', ssl: {rejectUnauthorized: false}});
(async () => {
  try {
    const r1 = await p.query("SELECT alias_type, alias_value, uuid, created_at FROM public.user_alias WHERE alias_value = '128'");
    console.log('=== aliases for 128 ===');
    console.log(JSON.stringify(r1.rows, null, 2));
    const r2 = await p.query("SELECT * FROM public.users WHERE id IN (SELECT uuid FROM public.user_alias WHERE alias_value='128') OR created_at > NOW() - INTERVAL '2 days' ORDER BY created_at DESC LIMIT 10");
    console.log('=== recent users + 128 uuid ===');
    console.log(JSON.stringify(r2.rows, null, 2));
    const r3 = await p.query("SELECT * FROM public.user_daily_tasks WHERE user_id IN (SELECT uuid FROM public.user_alias WHERE alias_value='128') OR date::date = CURRENT_DATE ORDER BY date DESC LIMIT 10");
    console.log('=== daily tasks for 128 + today ===');
    console.log(JSON.stringify(r3.rows, null, 2));
    const r4 = await p.query("SELECT * FROM public.users WHERE id = 'a41accae-27c9-449b-a820-e6d53d1b279a'");
    console.log('=== user a41accae row (128 alias) ===');
    console.log(JSON.stringify(r4.rows, null, 2));
    const r5 = await p.query("SELECT * FROM public.users WHERE id = '2747b7c7-1856-5ba5-b066-f0523b03e17f'");
    console.log('=== user 2747b7c7 (toUuid of "128") ===');
    console.log(JSON.stringify(r5.rows, null, 2));
    const r6 = await p.query("SELECT * FROM public.user_daily_tasks WHERE user_id = '2747b7c7-1856-5ba5-b066-f0523b03e17f'");
    console.log('=== daily tasks for 2747b7c7 ===');
    console.log(JSON.stringify(r6.rows, null, 2));
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    p.end();
  }
})();
