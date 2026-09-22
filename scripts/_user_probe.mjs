import { Client } from 'pg';
import { readFileSync } from 'fs';

const envContent = readFileSync('/var/www/app/.env.production', 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq < 0) continue;
  env[t.slice(0, eq)] = t.slice(eq + 1).trim();
}

const c = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LIMIT 20");
console.log('tables:', r.rows.map(x => x.table_name).join(', '));

const r2 = await c.query('SELECT id FROM users LIMIT 1');
console.log('user id:', r2.rows[0]?.id);
console.log('user_id:', JSON.stringify(r.rows[0]?.user_id));
await c.end();