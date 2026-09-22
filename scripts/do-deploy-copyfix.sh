#!/bin/bash
set -e
echo '=== DEPLOY COPYFIX ==='
echo "--- extract ---"
cd /var/www/app
sudo -n tar -xzf /tmp/deploy-copyfix.tar.gz 2>&1
echo '--- ownership after extract ---'
stat -c '%U:%G' /var/www/app/.next 2>&1 || true
echo '--- BUILD_ID ---'
cat .next/BUILD_ID 2>&1
echo '--- admin users page line count ---'
wc -l app/admin/users/page.tsx 2>&1
echo '--- copyToClipboard grep ---'
grep -n 'copyToClipboard' app/admin/users/page.tsx 2>&1 || echo 'NOT FOUND'
echo '--- fix ownership ---'
sudo -n chown -R ubuntu:ubuntu /var/www/app/.next 2>&1 || true
echo '--- starting production build ---'
cd /var/www/app
sudo -n NODE_ENV=production npx next build 2>&1 | tail -30
BUILD_EXIT=$?
echo "--- build exit: $BUILD_EXIT ---"
echo '--- post-build ownership ---'
stat -c '%U:%G' /var/www/app/.next 2>&1
echo '--- PM2 stop ---'
sudo -n pm2 stop repark-h5 2>&1
sleep 2
echo '--- PM2 start ---'
sudo -n pm2 start /var/www/app/ecosystem.config.js --only repark-h5 --env production 2>&1
sleep 10
echo '--- PM2 status ---'
sudo -n pm2 list 2>&1 | head -10
echo '--- health check ---'
curl -s -o /dev/null -w 'HTTP %{http_code} time=%{time_total}s' http://127.0.0.1:3000/api/time
echo ''
echo '=== DONE ==='
