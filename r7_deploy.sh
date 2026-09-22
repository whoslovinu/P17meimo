#!/bin/bash
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%S)
PROD=/var/www/app
NEW=/var/www/build-clean-r7
BACKUP=/var/www/.next.backup-r6pre-${TS}
echo "[DEPLOY] start at $(date -u)"
echo "[DEPLOY] new BUILD_ID: $(cat $NEW/.next/BUILD_ID)"
echo "[DEPLOY] prod BUILD_ID (before): $(cat $PROD/.next/BUILD_ID 2>/dev/null || echo 'missing')"
echo "[DEPLOY] backing up $PROD/.next -> $BACKUP"
sudo mv "$PROD/.next" "$BACKUP"
echo "[DEPLOY] swapping $NEW/.next -> $PROD/.next"
# Copy .next from new to prod (only .next, leave source intact so it stays bound to cwd)
sudo cp -al "$NEW/.next" "$PROD/.next" 2>/dev/null || sudo cp -a "$NEW/.next" "$PROD/.next"
echo "[DEPLOY] new prod BUILD_ID: $(cat $PROD/.next/BUILD_ID)"
echo "[DEPLOY] reloading pm2 repark-h5"
sudo pm2 reload repark-h5
echo "[DEPLOY] done at $(date -u)"
echo "BACKUP=$BACKUP" > /tmp/deploy_info.txt
echo "OLD_BUILD=$(cat $BACKUP/BUILD_ID)" >> /tmp/deploy_info.txt
echo "NEW_BUILD=$(cat $PROD/.next/BUILD_ID)" >> /tmp/deploy_info.txt
cat /tmp/deploy_info.txt
