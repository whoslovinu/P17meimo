#!/bin/bash
set -euo pipefail
DB='postgresql://postgres:PhbcRcx5Wt@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres'
SNAP=/var/www/snapshot-20260915T1648

echo "=== SNAPSHOT ==="
sudo mkdir -p "$SNAP"
sudo cp -r /var/www/app/.next "$SNAP/.next"
echo "OK: $SNAP ($(sudo du -sh $SNAP/.next | cut -f1))"

echo ""
echo "=== BUILD ID ==="
cat /var/www/app/.next/BUILD_ID

echo ""
echo "=== CHECK: admin_bypass exists? ==="
# Use Node.js since psql is not available
node -e "
const pg = require('pg');
const c = new pg.Client({connectionString: process.env.DB});
c.connect().then(() => c.query('SELECT column_name FROM information_schema.columns WHERE table_name=\\'milestone_rewards\\' ORDER BY ordinal_position')).then(r => { console.log(JSON.stringify(r.rows)); c.end(); }).catch(e => { console.error(e.message); process.exit(1); });
" 2>&1 || echo 'node_pg_failed'

echo ""
echo "=== PM2 STATUS ==="
sudo pm2 list 2>&1 | head -6

echo ""
echo "=== grantBadge check ==="
grep -l grantBadge /var/www/app/app/api/game/milestone/claim/route.ts 2>/dev/null && echo FOUND || echo NOT_FOUND

echo ""
echo "=== READY ==="
