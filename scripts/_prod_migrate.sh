#!/bin/bash
set -euo pipefail
DB='postgresql://postgres:PhbcRcx5Wt@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres'
SNAP=/var/www/snapshot-20260915T1648

echo "=== STEP 1: APPLY MIGRATION 17 ==="
# Run from /var/www/app so pg module is in node_modules path
cd /var/www/app
node -e "
const {Client} = require('pg');
const c = new Client({connectionString: 'postgresql://postgres:PhbcRcx5Wt@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres'});
c.connect().then(() => {
  return c.query('SELECT column_name FROM information_schema.columns WHERE table_name=\\'milestone_rewards\\' ORDER BY ordinal_position');
}).then(r => {
  console.log('Before:', JSON.stringify(r.rows.map(x=>x.column_name)));
  return c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
" 2>&1

echo ""
echo "=== Adding admin_bypass_source (partial migration fix) ==="
cd /var/www/app
node -e "
const {Client} = require('pg');
const c = new Client({connectionString: 'postgresql://postgres:PhbcRcx5Wt@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres'});
c.connect().then(async () => {
  try {
    await c.query('ALTER TABLE public.milestone_rewards ADD COLUMN IF NOT EXISTS admin_bypass_source TEXT DEFAULT NULL');
    console.log('admin_bypass_source added OK');
  } catch(e) {
    console.log('admin_bypass_source error:', e.message);
  }
  try {
    await c.query('CREATE INDEX IF NOT EXISTS idx_milestone_rewards_admin_bypass ON public.milestone_rewards (user_id) WHERE admin_bypass = TRUE');
    console.log('index created OK');
  } catch(e) {
    console.log('index error:', e.message);
  }
  const r = await c.query('SELECT column_name FROM information_schema.columns WHERE table_name=\\'milestone_rewards\\' ORDER BY ordinal_position');
  console.log('After:', JSON.stringify(r.rows.map(x=>x.column_name)));
  await c.end();
}).catch(e => { console.error(e.message); process.exit(1); });
" 2>&1

echo ""
echo "=== MIGRATION DONE ==="
