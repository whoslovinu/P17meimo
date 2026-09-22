#!/bin/bash
set -e
TS=$(date -u +%Y%m%dT%H%M%S)
PROD=/var/www/app
NEW=/var/www/source-convergence
BACKUP=/var/www/.next.backup-r9pre-${TS}
LOG=/tmp/deploy_r9.txt
echo "[DEPLOY] start at $(date -u)" | tee "$LOG"
echo "[DEPLOY] new BUILD_ID: $(cat $NEW/.next/BUILD_ID)" | tee -a "$LOG"
echo "[DEPLOY] prod BUILD_ID (before): $(cat $PROD/.next/BUILD_ID 2>/dev/null || echo 'missing')" | tee -a "$LOG"

# Pre-flight verification gate
echo "[DEPLOY] Running release verification gate..." | tee -a "$LOG"
if ! sudo python3 "$NEW/verify_bundle.py" >> "$LOG" 2>&1; then
  echo "[DEPLOY] VERIFICATION FAILED — aborting swap" | tee -a "$LOG"
  cat "$LOG"
  exit 1
fi
echo "[DEPLOY] verification passed" | tee -a "$LOG"

# Backup and swap
echo "[DEPLOY] backing up $PROD/.next -> $BACKUP" | tee -a "$LOG"
sudo mv "$PROD/.next" "$BACKUP"
echo "[DEPLOY] linking $NEW/.next -> $PROD/.next" | tee -a "$LOG"
sudo cp -al "$NEW/.next" "$PROD/.next" 2>/dev/null || sudo cp -a "$NEW/.next" "$PROD/.next"
echo "[DEPLOY] new prod BUILD_ID: $(cat $PROD/.next/BUILD_ID)" | tee -a "$LOG"
echo "[DEPLOY] reloading pm2 repark-h5" | tee -a "$LOG"
sudo pm2 reload repark-h5
sleep 5
echo "[DEPLOY] /api/time: $(curl -s -m 10 http://127.0.0.1:3000/api/time)" | tee -a "$LOG"
echo "[DEPLOY] done at $(date -u)" | tee -a "$LOG"
echo "BACKUP=$BACKUP" | tee -a "$LOG"
cat "$LOG"
