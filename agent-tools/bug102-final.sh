#!/bin/bash
set -u
echo '== rollback snapshot =='
ls -la /var/www/app/.rollback/bug-102-20260916T225834Z/ | head
echo
echo '== old .next kept for rollback =='
ls -d /var/www/app/.next_old.*
echo
echo '== BUILD_IDs =='
echo "NEW: $(cat /var/www/app/.next/BUILD_ID)"
echo "OLD (snapshot): $(cat /var/www/app/.rollback/bug-102-20260916T225834Z/BUILD_ID)"
echo
echo '== port 3000 =='
sudo -n ss -tlpn | grep :3000 || echo 'no ss match'
echo
echo '== pm2 repark-h5 =='
sudo -n pm2 jlist | python3 -c "import json,sys
d=json.loads(sys.stdin.read())
p=[x for x in d if x['name']=='repark-h5'][0]
print('name=%s pid=%s status=%s restarts=%s uptime=%s' % (p['name'], p['pid'], p['pm2_env']['status'], p['pm2_env'].get('restart_time'), p['pm2_env'].get('pm_uptime')))"
