#!/bin/bash
set -e
TS=$(date -u +%Y%m%dT%H%M%S)
PROD=/var/www/app
NEW=/var/www/build-clean-r7
BACKUP=/var/www/.next.backup-r7r8pre-${TS}
echo "[DEPLOY] start at $(date -u)" | tee /tmp/deploy_r8.txt
echo "[DEPLOY] new BUILD_ID: $(cat $NEW/.next/BUILD_ID)" | tee -a /tmp/deploy_r8.txt
echo "[DEPLOY] prod BUILD_ID (before): $(cat $PROD/.next/BUILD_ID 2>/dev/null || echo 'missing')" | tee -a /tmp/deploy_r8.txt
echo "[DEPLOY] backing up $PROD/.next -> $BACKUP" | tee -a /tmp/deploy_r8.txt
sudo mv "$PROD/.next" "$BACKUP"
echo "[DEPLOY] linking $NEW/.next -> $PROD/.next"
sudo cp -al "$NEW/.next" "$PROD/.next" 2>/dev/null || sudo cp -a "$NEW/.next" "$PROD/.next"
echo "[DEPLOY] new prod BUILD_ID: $(cat $PROD/.next/BUILD_ID)" | tee -a /tmp/deploy_r8.txt
echo "[DEPLOY] reloading pm2 repark-h5" | tee -a /tmp/deploy_r8.txt
sudo pm2 reload repark-h5
echo "[DEPLOY] done at $(date -u)" | tee -a /tmp/deploy_r8.txt
echo "BACKUP=$BACKUP" >> /tmp/deploy_info_r8.txt
cat /tmp/deploy_info_r8.txt
