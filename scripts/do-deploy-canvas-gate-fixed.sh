#!/bin/bash
# do-deploy-canvas-gate-fixed.sh
set -e
echo '=== DEPLOY CANVAS-GATE FIXED ==='
echo '--- remove stray root-level copies ---'
sudo -n rm -f /var/www/app/BattleLayout.tsx /var/www/app/LoadingScreen.tsx 2>&1
echo '--- extract ---'
cd /var/www/app
sudo -n tar -xzf /tmp/deploy-canvas-gate.tar.gz 2>&1
echo '--- modified files (mtime) ---'
stat -c '%n %y' /var/www/app/app/components/features/battle/LoadingScreen.tsx
stat -c '%n %y' /var/www/app/app/components/features/battle/BattleLayout.tsx
echo '--- canvas-gate markers ---'
echo -n "[isCanvasRendered in LoadingScreen.tsx]: "; grep -c 'isCanvasRendered' /var/www/app/app/components/features/battle/LoadingScreen.tsx
echo -n "[isCanvasRendered in BattleLayout.tsx]: "; grep -c 'isCanvasRendered' /var/www/app/app/components/features/battle/BattleLayout.tsx
echo '--- NO stray root-level ---'
ls /var/www/app/BattleLayout.tsx /var/www/app/LoadingScreen.tsx 2>&1 || echo 'OK - no strays'
echo '--- fix ownership ---'
sudo -n chown -R ubuntu:ubuntu /var/www/app/.next 2>&1 || true
sudo -n chown -R ubuntu:ubuntu /var/www/app/app 2>&1 || true
echo '--- starting production build ---'
cd /var/www/app
sudo -n rm -rf .next 2>&1
sudo -n NODE_ENV=production npx next build 2>&1 | tail -25
BUILD_EXIT=${PIPESTATUS[0]}
echo "--- build exit: $BUILD_EXIT ---"
if [ "$BUILD_EXIT" -ne 0 ]; then
  echo "BUILD FAILED - abort"
  exit 1
fi
echo '--- new BUILD_ID ---'
cat /var/www/app/.next/BUILD_ID
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
