#!/bin/bash
set -euo pipefail
echo "=== DEPLOY: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# Project root (has package.json, node_modules, and app/ subdirectory)
BUILD_ROOT=/var/www/build-stage-20260915
# Next.js app/ directory (app/ is nested inside BUILD_ROOT)
NEXT_APP_DIR=$BUILD_ROOT/app
APP=/var/www/app

echo ""
echo "=== 1. COPY MODIFIED SOURCE FILES ==="
sudo cp /tmp/route-claim.ts "$NEXT_APP_DIR/app/api/game/milestone/claim/route.ts"
sudo cp /tmp/route-init.ts "$NEXT_APP_DIR/app/api/battle/init/route.ts"
sudo cp /tmp/SubPageModal.tsx "$NEXT_APP_DIR/app/components/features/battle/SubPageModal.tsx"
sudo cp /tmp/badgeNameCache.ts "$NEXT_APP_DIR/lib/badgeNameCache.ts"
sudo cp /tmp/pg.ts "$NEXT_APP_DIR/lib/db/pg.ts"
sudo cp /tmp/postgres.ts "$NEXT_APP_DIR/lib/db/postgres.ts"
sudo cp /tmp/badgeAdapter.ts "$NEXT_APP_DIR/lib/services/badgeAdapter.ts"
sudo cp /tmp/act-upd.ts "$NEXT_APP_DIR/app/api/admin/activity/update/route.ts"
sudo cp /tmp/user-search.ts "$NEXT_APP_DIR/app/api/admin/users/search/route.ts"
sudo cp /tmp/admin-users.tsx "$NEXT_APP_DIR/app/admin/users/page.tsx"
sudo cp /tmp/override.ts "$NEXT_APP_DIR/app/api/admin/users/[uid]/milestones/override/route.ts"
echo "+ All modified source files copied"

echo ""
echo "=== 2. BUILD (from Next.js app directory) ==="
cd "$NEXT_APP_DIR"
sudo npm run build:no-lint 2>&1 | tail -25
BUILD_EXIT=$?
echo "Build exit code: $BUILD_EXIT"

if [[ $BUILD_EXIT -ne 0 ]]; then
  echo "BUILD FAILED — aborting deploy"
  exit 1
fi

# .next output goes into the Next.js app/ directory
NEXT_OUT="$NEXT_APP_DIR/.next"
NEW_BUILD_ID=$(sudo cat "$NEXT_OUT/BUILD_ID")
echo "New BUILD_ID: $NEW_BUILD_ID"

echo ""
echo "=== 3. STOP PM2 ==="
sudo pm2 stop repark-h5 2>&1 | tail -3
sleep 3

echo ""
echo "=== 4. BACKUP CURRENT .next ==="
PREV="$APP/.next"
BACKUP="/var/www/app/.next.backup-$(date +%Y%m%dT%H%M%S)"
sudo cp -r "$PREV" "$BACKUP"
echo "Backup: $BACKUP ($(sudo du -sh $BACKUP | cut -f1))"

echo ""
echo "=== 5. ATOMIC SWAP ==="
sudo rm -rf "$PREV"
sudo mv "$NEXT_OUT" "$PREV"
echo "Swapped .next"

echo ""
echo "=== 6. RESTART PM2 ==="
sudo pm2 startOrRestart repark-h5 2>&1 | tail -5
sleep 8

echo ""
echo "=== 7. HEALTH CHECK ==="
HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/time 2>/dev/null || echo "000")
echo "HTTP /api/time: $HTTP"
if [[ "$HTTP" == "200" ]]; then
  echo "HEALTH: PASS"
else
  echo "HEALTH: FAIL (HTTP $HTTP) — rolling back"
  sudo pm2 stop repark-h5 2>&1 | tail -2
  sudo rm -rf "$PREV"
  sudo cp -r "$BACKUP" "$PREV"
  sudo pm2 startOrRestart repark-h5 2>&1 | tail -3
  echo "ROLLBACK DONE"
  exit 1
fi

echo ""
echo "=== 8. VERIFY ==="
FINAL_BUILD=$(sudo cat "$APP/.next/BUILD_ID")
echo "Final BUILD_ID: $FINAL_BUILD"
sudo pm2 list 2>&1 | head -6

echo ""
echo "=== DEPLOY COMPLETE ==="
echo "BUILD_ID: $FINAL_BUILD (was: alpzW9H5weAwG7kdC9HZr)"
echo "Rollback backup: $BACKUP"
echo "Snapshot: /var/www/snapshot-20260915T1648"
