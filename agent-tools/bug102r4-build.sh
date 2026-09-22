#!/bin/bash
set -euo pipefail
ts=$(date -u +%Y%m%dT%H%M%SZ)
echo "TS=$ts"
SC=/var/www/source-convergence
APP=/var/www/app

echo "== baseline =="
echo "PROD_BUILD_ID_BEFORE=$(cat $APP/.next/BUILD_ID)"

echo "== snapshot =="
SNAP=/var/www/app/.rollback/bug102r4-$ts
sudo -n mkdir -p $SNAP
sudo -n rsync -a --delete $APP/.next/ $SNAP/.next/
sudo -n cp $APP/.next/BUILD_ID $SNAP/BUILD_ID
echo "SNAP=$SNAP"

echo "== sync files =="
sudo -n cp /home/ubuntu/page.bug102r4.tsx $SC/app/admin/users/page.tsx
sudo -n cp /home/ubuntu/fetchWithTimeout.ts $SC/app/lib/fetchWithTimeout.ts
sudo -n cp /home/ubuntu/adminApi.ts $SC/app/admin/lib/adminApi.ts
sudo -n chown root:root $SC/app/admin/users/page.tsx $SC/app/lib/fetchWithTimeout.ts $SC/app/admin/lib/adminApi.ts
sudo -n chmod 644 $SC/app/admin/users/page.tsx $SC/app/lib/fetchWithTimeout.ts $SC/app/admin/lib/adminApi.ts

for p in app/admin/users/page.tsx app/lib/fetchWithTimeout.ts app/admin/lib/adminApi.ts; do
  L=$(sha256sum "/home/ubuntu/$(basename $p | sed 's/\./.bug102r4./g' | sed 's/tsx/page.bug102r4.tsx/')" 2>/dev/null | awk '{print $1}')
done
L1=$(sha256sum /home/ubuntu/page.bug102r4.tsx | awk '{print $1}')
S1=$(sudo -n sha256sum $SC/app/admin/users/page.tsx | awk '{print $1}')
L2=$(sha256sum /home/ubuntu/fetchWithTimeout.ts | awk '{print $1}')
S2=$(sudo -n sha256sum $SC/app/lib/fetchWithTimeout.ts | awk '{print $1}')
L3=$(sha256sum /home/ubuntu/adminApi.ts | awk '{print $1}')
S3=$(sudo -n sha256sum $SC/app/admin/lib/adminApi.ts | awk '{print $1}')
echo "LOCAL_PAGE   =$L1"
echo "SERVED_PAGE  =$S1"
echo "LOCAL_FWT    =$L2"
echo "SERVED_FWT   =$S2"
echo "LOCAL_API    =$L3"
echo "SERVED_API   =$S3"
[ "$L1" = "$S1" ] && [ "$L2" = "$S2" ] && [ "$L3" = "$S3" ] || { echo 'SHA MISMATCH'; exit 1; }

echo "== tsc =="
cd $SC && npx tsc --noEmit
echo "TSC_RC=$?"

echo "== build:no-lint =="
export NODE_ENV=production
time npm run build:no-lint 2>&1 | tail -n 6
echo "BUILD_RC=${PIPESTATUS[0]}"
echo "NEW_BUILD_ID=$(cat .next/BUILD_ID)"

echo "== new chunk =="
find .next/static/chunks/app/admin/users -type f -name 'page-*.js' | head -1
