const { Client } = require('/var/www/app/node_modules/pg');
const c = new Client({ host:'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com', port:5432, user:'postgres', password:'YOUR_DATABASE_PASSWORD', database:'postgres', ssl:{ rejectUnauthorized:false } });
(async () => {
  await c.connect();
  await c.query(`
    CREATE TABLE IF NOT EXISTS public.user_alias (
      alias_type  TEXT        NOT NULL,    -- 'master_long' (主站长 long)
      alias_value TEXT        NOT NULL,    -- '12345678' (主站原始 long 字符串)
      uuid        UUID        NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (alias_type, alias_value)
    )
  `);
  await c.query(`CREATE INDEX IF NOT EXISTS ix_user_alias_uuid ON public.user_alias(uuid)`);
  const rows = await c.query("SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='user_alias' ORDER BY ordinal_position");
  console.log('user_alias columns:');
  for (const r of rows.rows) console.log(' ', r.column_name, '-', r.data_type, '(' + r.udt_name + ')');
  await c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });