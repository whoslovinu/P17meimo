#!/bin/bash
set -euo pipefail
SC=/var/www/source-convergence
APP=/var/www/app
NEW_ID=$(cat $SC/.next/BUILD_ID)
OLD_ID=$(cat $APP/.next/BUILD_ID)
echo "OLD=$OLD_ID"
echo "NEW=$NEW_ID"

mkdir -p $APP/.next_swap
rsync -a --delete $SC/.next/ $APP/.next_swap/
SWAP_ID=$(cat $APP/.next_swap/BUILD_ID)
echo "SWAP=$SWAP_ID"
test "$SWAP_ID" = "$NEW_ID" || { echo 'MISMATCH'; exit 1; }

mv $APP/.next $APP/.next_old.$(date -u +%Y%m%dT%H%M%SZ)
mv $APP/.next_swap $APP/.next

echo "== BUILD_ID =="
cat $APP/.next/BUILD_ID
sha256sum $APP/.next/server/app/admin/users/page.js

echo "== pm2 reload =="
sudo -n pm2 reload repark-h5 --update-env
sleep 6
sudo -n pm2 jlist | python3 -c "import json,sys
d=json.loads(sys.stdin.read())
p=[x for x in d if x['name']=='repark-h5'][0]
print('pid=%s status=%s' % (p['pid'], p['pm2_env']['status']))"
