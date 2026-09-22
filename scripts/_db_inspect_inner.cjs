const { Client } = require('/var/www/app/node_modules/pg');
const c = new Client({ host:'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com', port:5432, user:'postgres', password:'YOUR_DATABASE_PASSWORD', database:'postgres', ssl:{ rejectUnauthorized:false } });
(async () => {
  await c.connect();
  const t = await c.query("SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position");
  console.log('USERS columns:');
  for (const r of t.rows) console.log(' ', r.column_name, '-', r.data_type, '(' + r.udt_name + ')', r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL');
  const tbls = ['user_daily_tasks', 'task_progress', 'user_inventory'];
  for (const tn of tbls) {
    const tt = await c.query("SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [tn]);
    console.log(tn + ' columns:');
    for (const r of tt.rows) console.log(' ', r.column_name, '-', r.data_type, '(' + r.udt_name + ')');
  }
  const sample = await c.query('SELECT * FROM public.users LIMIT 5');
  console.log('USERS sample (rows: ' + sample.rowCount + '):');
  for (const r of sample.rows) console.log(' ', JSON.stringify(r));
  const sdt = await c.query('SELECT * FROM public.user_daily_tasks LIMIT 5');
  console.log('DAILY sample (rows: ' + sdt.rowCount + '):');
  for (const r of sdt.rows) console.log(' ', JSON.stringify(r));
  const cnt = await c.query("SELECT (SELECT COUNT(*) FROM public.users) AS users_n, (SELECT COUNT(*) FROM public.user_daily_tasks) AS daily_n, (SELECT COUNT(*) FROM public.task_progress) AS tp_n");
  console.log('COUNTS:', JSON.stringify(cnt.rows[0]));
  await c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });