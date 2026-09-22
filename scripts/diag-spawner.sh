#!/bin/bash
echo '=== WHO IS SPAWNING next-server? ==='
echo '--- ps tree ---'
ps auxf | grep -A 5 -B 1 'next-server' | head -40
echo '---'
echo '--- systemd unit? ---'
sudo -n systemctl list-units --type=service 2>&1 | grep -i 'next\|repark\|h5' || echo '(none)'
echo '---'
echo '--- cron jobs ---'
sudo -n ls -la /etc/cron.d/ 2>&1 | head -10
echo '---'
echo '--- supervisor? ---'
ls -la /etc/supervisor/conf.d/ 2>&1 | head -5 || true
echo '---'
echo '--- pm2 startup ---'
sudo -n pm2 startup 2>&1 | head -10 || echo '(not configured)'
echo '---'
echo '--- pid 903957 parent ---'
cat /proc/903957/status 2>&1 | grep -E 'PPid|Name|State' | head -5 || echo '(gone)'
echo '---'
echo '--- which pm2 has repark-h5 ---'
sudo -n pm2 jlist 2>&1 | head -30
