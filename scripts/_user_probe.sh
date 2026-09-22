#!/usr/bin/env bash
# Query the DB for a real user_id then call /api/battle/init with the auth cookie
APP_DIR=/var/www/app
cd $APP_DIR
node <<'EOF'
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

const c = new Client({ connectionString: env.DATABASE_URL });
await c.connect();
const r = await c.query('SELECT user_id FROM users LIMIT 1');
console.log('user_id from DB:', JSON.stringify(r.rows[0]?.user_id));
await c.end();
EOF