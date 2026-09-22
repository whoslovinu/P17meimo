#!/bin/bash
echo '--- health ---'
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/api/time || true
echo '--- port ---'
ss -ltnp 2>/dev/null | grep :3000 || echo 'FREE'
echo '--- delete pm2 ---'
sudo -n pm2 delete repark-h5 2>/dev/null || true
echo '--- .next owner ---'
stat -c '%U:%G' /var/www/app/.next 2>&1 || true
echo '--- pm2 start ---'
sudo -n pm2 start /var/www/app/ecosystem.config.js --env production 2>&1 && sleep 15 && echo '--- pm2 list ---' && sudo -n pm2 list 2>&1 | head -10 && echo '--- pm2 pid ---' && sudo -n pm2 pid repark-h5 2>&1 || true && echo '--- port 3000 ---' && ss -ltnp 2>/dev/null | grep :3000 || echo 'NONE' && echo '--- /api/time ---' && curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/api/time || echo 'FAILED' && echo '--- /api/battle/leaderboard ---' && curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/api/battle/leaderboard || echo 'FAILED' && echo '--- BUILD_ID ---' && cat /var/www/app/.next/BUILD_ID && echo '--- pm2 save ---' && sudo -n pm2 save 2>&1 && echo 'SAVED' || echo 'SAVE_FAIL' && echo '--- systemd ---' && ls /etc/systemd/system/pm2*.service 2>/dev/null && echo 'SYSTEMD_OK' || echo 'NO_SYSTEMD' && crontab -l 2>/dev/null | grep pm2 && echo 'CRON_OK' || echo 'NO_CRON' && echo '=== DONE ==='
