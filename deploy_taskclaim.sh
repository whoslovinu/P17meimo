#!/bin/bash
set -e

echo "=== Step 1: Deploy task-claim/route.ts ==="
TMP=$(mktemp -d)
python3 -c "import zipfile; zipfile.ZipFile('/tmp/repark-taskclaim-fix.zip').extractall('$TMP')"
sudo cp "$TMP/app/api/battle/task-claim/route.ts" /var/www/app/app/api/battle/task-claim/route.ts
sudo chown root:root /var/www/app/app/api/battle/task-claim/route.ts
rm -rf "$TMP"

echo ""
echo "=== Step 2: Verify data-source alignment in deployed file ==="
grep -n "getDailyTask\|rechargeProgressYuan\|currentProgressRaw" /var/www/app/app/api/battle/task-claim/route.ts

echo ""
echo "=== Step 3: Build ==="
sudo -E env NODE_ENV=production PORT=3000 npx next build 2>&1 | tail -5

echo ""
echo "=== Step 4: Restart PM2 ==="
sudo pm2 delete repark-h5 2>/dev/null || true
sleep 1
sudo fuser -k 3000/tcp 2>/dev/null || true
sleep 1
sudo pm2 start /var/www/app/ecosystem.config.js --env production
sleep 6
sudo pm2 list