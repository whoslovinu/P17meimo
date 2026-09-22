#!/bin/bash
set -euo pipefail
ts=$(date -u +%Y%m%dT%H%M%SZ)
echo "TS=$ts"
SC=/var/www/source-convergence
APP=/var/www/app

echo "== baseline =="
echo "PROD_BUILD_ID_BEFORE=$(cat $APP/.next/BUILD_ID)"

echo "== snapshot =="
SNAP=/var/www/app/.rollback/bug102r3-$ts
sudo -n mkdir -p $SNAP
sudo -n rsync -a --delete $APP/.next/ $SNAP/.next/
sudo -n cp $APP/.next/BUILD_ID $SNAP/BUILD_ID
sudo -n cp $APP/app/admin/users/page.tsx $SNAP/page.app.users.tsx 2>/dev/null || true
echo "SNAP=$SNAP"

echo "== sync to source-convergence =="
sudo -n cp /home/ubuntu/page.bug102r3.tsx $SC/app/admin/users/page.tsx
sudo -n chown root:root $SC/app/admin/users/page.tsx
sudo -n chmod 644 $SC/app/admin/users/page.tsx
L=$(sha256sum /home/ubuntu/page.bug102r3.tsx | awk '{print $1}')
S=$(sudo -n sha256sum $SC/app/admin/users/page.tsx | awk '{print $1}')
echo "LOCAL_SHA=$L"
echo "SERVED_SHA=$S"
test "$L" = "$S" || { echo 'SHA MISMATCH'; exit 1; }

echo "== tsc =="
cd $SC && npx tsc --noEmit
echo "TSC_RC=$?"

echo "== build:no-lint =="
export NODE_ENV=production
time npm run build:no-lint 2>&1 | tail -n 6
echo "BUILD_RC=${PIPESTATUS[0]}"
echo "NEW_BUILD_ID=$(cat .next/BUILD_ID)"
