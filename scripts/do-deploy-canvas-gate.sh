#!/bin/bash
# do-deploy-canvas-gate.sh
# Minimal blast-radius deploy: ONLY LoadingScreen.tsx + BattleLayout.tsx
set -e
echo '=== DEPLOY CANVAS-GATE (2 files only) ==='
echo '--- extract ---'
cd /var/www/app
sudo -n tar -xzf /tmp/deploy-canvas-gate.tar.gz 2>&1
echo '--- modified files (mtime) ---'
stat -c '%n %y' /var/www/app/app/components/features/battle/LoadingScreen.tsx
stat -c '%n %y' /var/www/app/app/components/features/battle/BattleLayout.tsx
echo '--- canvas-gate markers in source ---'
echo -n "[isCanvasRendered in LoadingScreen.tsx]: "; grep -c 'isCanvasRendered' /var/www/app/app/components/features/battle/LoadingScreen.tsx
echo -n "[isCanvasRendered in BattleLayout.tsx]: "; grep -c 'isCanvasRendered' /var/www/app/app/components/features/battle/BattleLayout.tsx
echo '--- fix ownership ---'
sudo -n chown -R ubuntu:ubuntu /var/www/app/.next 2>&1 || true
sudo -n chown -R ubuntu:ubuntu /var/www/app/app/components/features/battle 2>&1 || true
echo '--- pre-build BUILD_ID ---'
cat /var/www/app/.next/BUILD_ID 2>/dev/null || echo "(no prior build)"
echo '--- starting production build ---'
cd /var/www/app
sudo -n NODE_ENV=production npx next build 2>&1 | tail -20
BUILD_EXIT=$?
echo "--- build exit: $BUILD_EXIT ---"
echo '--- new BUILD_ID ---'
cat /var/www/app/.next/BUILD_ID
echo '--- post-build ownership ---'
stat -c '%U:%G' /var/www/app/.next 2>&1
echo '--- killing any stale next-server ---'
sudo -n pkill -f 'next-server' 2>&1 || true
sleep 2
echo '--- PM2 stop ---'
sudo -n pm2 stop repark-h5 2>&1 || true
sleep 2
echo '--- PM2 delete ---'
sudo -n pm2 delete repark-h5 2>&1 || true
sleep 1
echo '--- PM2 start ---'
sudo -n pm2 start /var/www/app/ecosystem.config.js --only repark-h5 --env production 2>&1
sleep 10
echo '--- PM2 status ---'
sudo -n pm2 list 2>&1 | head -10
echo '--- port 3000 listener ---'
sudo -n ss -ltnp 2>&1 | grep ':3000' || echo '(none)'
echo '--- health check /api/time ---'
curl -s -o /dev/null -w 'HTTP %{http_code} time=%{time_total}s' http://127.0.0.1:3000/api/time
echo ''
echo '=== DONE ==='
