// scripts/_db_inspect.cjs — look at REAL users.id type + sample rows
const { Client: SshClient } = require('ssh2');
const path = require('path');
const fs = require('fs');

const cmd = `cd /tmp && cat > inspect.cjs <<'EOF'
const { Client } = require('/var/www/app/node_modules/pg');
const c = new Client({ host:'rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com', port:5432, user:'postgres', password:'YOUR_DATABASE_PASSWORD', database:'postgres', ssl:{ rejectUnauthorized:false } });
(async () => {
  await c.connect();
  // 1. EXACT column type
  const t = await c.query(`
    SELECT column_name, data_type, udt_name, character_maximum_length, is_nullable
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='users'
     ORDER BY ordinal_position
  `);
  console.log('USERS columns:');
  t.rows.forEach(r => console.log('  ', r.column_name, '-', r.data_type, '(' + r.udt_name + ')', r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'));

  // 2. Other related tables
  const tbls = ['user_daily_tasks', 'task_progress', 'user_inventory'];
  for (const tn of tbls) {
    const tt = await c.query(`
      SELECT column_name, data_type, udt_name
        FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position
    `, [tn]);
    console.log(tn + ' columns:');
    tt.rows.forEach(r => console.log('  ', r.column_name, '-', r.data_type, '(' + r.udt_name + ')'));
  }

  // 3. Sample user rows
  const sample = await c.query('SELECT * FROM public.users LIMIT 5');
  console.log('USERS sample (rows: ' + sample.rowCount + '):');
  sample.rows.forEach(r => console.log(' ', JSON.stringify(r)));

  // 4. Sample daily tasks
  const sdt = await c.query('SELECT * FROM public.user_daily_tasks LIMIT 5');
  console.log('DAILY sample (rows: ' + sdt.rowCount + '):');
  sdt.rows.forEach(r => console.log(' ', JSON.stringify(r)));

  // 5. Total counts
  const cnt = await c.query(\`
    SELECT
      (SELECT COUNT(*) FROM public.users) AS users_n,
      (SELECT COUNT(*) FROM public.user_daily_tasks) AS daily_n,
      (SELECT COUNT(*) FROM public.task_progress) AS tp_n
  \`);
  console.log('COUNTS:', JSON.stringify(cnt.rows[0]));

  await c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
EOF
node inspect.cjs`;

const main = async () => {
  const pk = await fs.promises.readFile(path.resolve('keys/mercenary_h5_project.pem'), 'utf8');
  const c2 = new SshClient();
  c2.on('ready', () => {
    c2.exec(cmd, (err, stream) => {
      if (err) { console.error(err); process.exit(1); }
      stream.on('data', d => process.stdout.write(d));
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.on('close', (code) => { c2.end(); process.exit(code ?? 0); });
    });
  });
  c2.on('error', e => { console.error(e); process.exit(1); });
  c2.connect({ host: '98.93.252.250', port: 22, username: 'ubuntu', privateKey: pk, readyTimeout: 30000 });
};
main();