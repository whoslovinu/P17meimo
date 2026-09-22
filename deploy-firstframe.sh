#!/bin/bash
set -e

echo "=== Step 1: Extract zip to /tmp ==="
mkdir -p /tmp/repark-ff-fix
python3 -c "import zipfile; zipfile.ZipFile('/tmp/repark-firstframe-fix.zip').extractall('/tmp/repark-ff-fix')"
echo "Extracted"
ls /tmp/repark-ff-fix/app/components/features/battle/

echo ""
echo "=== Step 2: Copy files ==="
cp /tmp/repark-ff-fix/app/components/features/battle/SpineViewer.tsx /var/www/app/app/components/features/battle/SpineViewer.tsx
cp /tmp/repark-ff-fix/app/components/features/battle/BattleLayout.tsx /var/www/app/app/components/features/battle/BattleLayout.tsx
chown root:root /var/www/app/app/components/features/battle/SpineViewer.tsx
chown root:root /var/www/app/app/components/features/battle/BattleLayout.tsx
echo "Files copied"

echo ""
echo "=== Step 3: Verify ==="
grep -c "onCurrentModelRendered" /var/www/app/app/components/features/battle/SpineViewer.tsx
grep -cE "onCurrentModelRendered|isCurrentModelRendered" /var/www/app/app/components/features/battle/BattleLayout.tsx

echo ""
echo "=== Step 4: Build ==="
cd /var/www/app
sudo -E env NODE_ENV=production PORT=3000 npx next build 2>&1 | tail -8

echo ""
echo "=== Step 5: Restart ==="
sudo fuser -k 3000/tcp 2>/dev/null || true
sleep 2
sudo pm2 restart repark-h5 --update-env 2>&1
sleep 8
sudo pm2 list
