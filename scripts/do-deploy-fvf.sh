#!/bin/bash
DEPLOY_DIR="/tmp/deploy-2026-08-25T08-59-41"
echo "=== CHECK SOURCE ==="
ls "$DEPLOY_DIR/.next/BUILD_ID" 2>&1 || exit 1
cat "$DEPLOY_DIR/.next/BUILD_ID" || exit 1
echo ""
echo "=== STOP PM2 ==="
sudo -n pm2 delete repark-h5 2>/dev/null || true
echo "=== KILL PORT ==="
sudo fuser -k 3000/tcp 2>/dev/null || true
sleep 4
echo "=== PORT NOW ==="
ss -ltnp 2>/dev/null | grep :3000 || echo FREE
echo "=== COPY .next ==="
sudo mkdir -p /tmp/.next-new && sudo rm -rf /tmp/.next-new/*
cp -rT "$DEPLOY_DIR/.next" /tmp/.next-new && sudo cp -rT /tmp/.next-new /var/www/app/.next && sudo chown -R ubuntu:ubuntu /var/www/app/.next && echo COPY_OK || echo COPY_FAILED
echo "=== COPY package.json ecosystem ==="
cp "$DEPLOY_DIR/package.json" /tmp/.package-new && sudo cp /tmp/.package-new /var/www/app/package.json
cp "$DEPLOY_DIR/ecosystem.config.js" /tmp/.ecosystem-new && sudo cp /tmp/.ecosystem-new /var/www/app/ecosystem.config.js && echo COPY_CONFIG_OK || echo COPY_CONFIG_FAIL
echo "=== NEW BUILD_ID ==="
cat /var/www/app/.next/BUILD_ID
echo ""
echo "=== PM2 START ==="
sudo -n pm2 start /var/www/app/ecosystem.config.js --env production 2>&1
sleep 20
echo "=== PM2 STATUS ==="
sudo -n pm2 list 2>&1 | head -10
NPID=$(sudo -n pm2 pid repark-h5 2>/dev/null | head -1)
echo "tracked_pid=$NPID"
echo "=== PORT 3000 ==="
ss -ltnp 2>/dev/null | grep :3000 || echo NONE
echo "=== ACTUAL PARENT ==="
NPID2=$(ss -ltnp 2>/dev/null | grep ':3000' | grep -oP 'pid=\K[0-9]+')
echo "actual_pid=$NPID2"
if [ -n "$NPID2" ]; then
  PPID=$(ps -o ppid= -p $NPID2 2>/dev/null | tr -d ' ' || echo '')
  echo "parent=$PPID"
  PM2D=$(pm2 pid 2>/dev/null | head -1 || echo '')
  echo "pm2_daemon=$PM2D"
  if [ "$PPID" = "$PM2D" ]; then echo "RESULT=ONLINE_UNDER_PM2"; else echo "RESULT=ORPHAN"; fi
fi
echo "=== HEALTH ==="
curl -s -o /dev/null -w '/api/time: %{http_code}\n' http://127.0.0.1:3000/api/time || echo FAILED
curl -s -o /dev/null -w '/lb: %{http_code}\n' http://127.0.0.1:3000/api/battle/leaderboard || echo FAILED
echo "=== VERIFY afterrender GATE ==="
grep -n 'afterrender\|firstVisibleFrame' /var/www/app/app/components/features/battle/SpineViewer.tsx 2>&1 | head -10
echo "=== PM2 SAVE ==="
sudo -n pm2 save 2>&1 && echo SAVED || echo SAVE_FAIL
echo "=== DONE ==="
