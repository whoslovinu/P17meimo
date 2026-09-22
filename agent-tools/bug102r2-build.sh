#!/bin/bash
set -euo pipefail
ts=$(date -u +%Y%m%dT%H%M%SZ)
echo "TS=$ts"
SC=/var/www/source-convergence
APP=/var/www/app

echo '== baseline =='
echo "PROD_BUILD_ID_BEFORE=$(cat $APP/.next/BUILD_ID)"

echo '== new snapshot for rollback =='
SNAP=/var/www/app/.rollback/bug-102r2-$ts
sudo -n mkdir -p $SNAP
sudo -n rsync -a --delete $APP/.next/ $SNAP/.next/
sudo -n cp $APP/.next/BUILD_ID $SNAP/BUILD_ID
sudo -n cp $APP/app/admin/users/page.tsx $SNAP/page.app.users.tsx 2>/dev/null || true
echo "SNAP=$SNAP"

echo '== sync source from local tmp =='
sudo -n cp /home/ubuntu/page.bug102r2.tsx $SC/app/admin/users/page.tsx
sudo -n chown root:root $SC/app/admin/users/page.tsx
sudo -n chmod 644 $SC/app/admin/users/page.tsx
LOCAL_SHA=$(sha256sum /home/ubuntu/page.bug102r2.tsx | awk '{print $1}')
SERVED_SHA=$(sha256sum $SC/app/admin/users/page.tsx | awk '{print $1}')
echo "LOCAL_SHA=$LOCAL_SHA"
echo "SERVED_SHA=$SERVED_SHA"
test "$LOCAL_SHA" = "$SERVED_SHA" || { echo 'SHA MISMATCH'; exit 1; }

echo '== tsc =='
cd $SC
npx tsc --noEmit
echo "TSC_RC=$?"

echo '== build:no-lint =='
export NODE_ENV=production
time npm run build:no-lint 2>&1 | tail -n 8
echo "BUILD_RC=${PIPESTATUS[0]}"
echo "NEW_BUILD_ID=$(cat .next/BUILD_ID)"
