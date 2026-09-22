#!/bin/bash
# BUG-102 atomic cutover
set -euo pipefail
SC=/var/www/source-convergence
APP=/var/www/app
NEW_ID=$(cat $SC/.next/BUILD_ID)
OLD_ID=$(cat $APP/.next/BUILD_ID)
echo "OLD=$OLD_ID"
echo "NEW=$NEW_ID"

echo '== rsync .next into a staging swap dir =='
mkdir -p $APP/.next_swap
rsync -a --delete $SC/.next/ $APP/.next_swap/

echo '== verify staging BUILD_ID matches new =='
SWAP_ID=$(cat $APP/.next_swap/BUILD_ID)
echo "SWAP=$SWAP_ID"
test "$SWAP_ID" = "$NEW_ID" || { echo 'STAGING BUILD_ID MISMATCH'; exit 1; }

echo '== atomic swap: rename current .next -> .next_old, .next_swap -> .next =='
mv $APP/.next $APP/.next_old.$(date -u +%Y%m%dT%H%M%SZ)
mv $APP/.next_swap $APP/.next

echo '== current prod BUILD_ID =='
cat $APP/.next/BUILD_ID
echo '== files quick check =='
ls -la $APP/.next/BUILD_ID
ls -la $APP/.next/server/app/admin/users/page.js
sha256sum $APP/.next/server/app/admin/users/page.js

echo '== pm2 reload repark-h5 with --update-env =='
sudo -n pm2 reload repark-h5 --update-env
sleep 6
sudo -n pm2 jlist | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(json.dumps([{'name':p['name'],'pid':p.get('pid'),'pm2_env_status':p['pm2_env'].get('status'),'pm_uptime':p['pm2_env'].get('pm_uptime')} for p in d if p['name']=='repark-h5'], indent=2))"
