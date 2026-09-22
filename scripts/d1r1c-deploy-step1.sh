#!/bin/bash
# scripts/d1r1c-deploy-step1.sh — D1-R1C production snapshot (with sudo)
set -u
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
REMOTE_APP=/var/www/app
REMOTE_BACKUP_DIR="$REMOTE_APP/.rollback/shared-feedback-D1-R1-prod-before-$STAMP"

echo "═════════════════════════════════════════════════════════════"
echo "D1-R1C PRODUCTION SNAPSHOT"
echo "STAMP: $STAMP"
echo "REMOTE_BACKUP_DIR: $REMOTE_BACKUP_DIR"
echo "═════════════════════════════════════════════════════════════"

# ── STEP 1a: Snapshot via sudo ─────────────────────────────────────────────
echo ""
echo "[STEP 1a] Create backup directory"
sudo -n mkdir -p "$REMOTE_BACKUP_DIR" && echo "  ✓ directory created" || { echo "  ✗ FAIL"; exit 1; }

# Backup the three files
echo ""
echo "[STEP 1b] Backup files"
for f in lib/db/pg.ts app/api/action/attack/route.ts app/api/admin/users/search/route.ts; do
  if sudo -n test -f "$REMOTE_APP/$f"; then
    dest="$REMOTE_BACKUP_DIR/$(echo $f | tr '/' '-')"
    sudo -n cp -f "$REMOTE_APP/$f" "$dest" && echo "  ✓ backed up $f" || { echo "  ✗ cp FAIL $f"; exit 1; }
  else
    echo "  ✗ MISSING ON PROD: $f"
    exit 1
  fi
done

# Record hashes
echo ""
echo "[STEP 1c] Record hashes"
sudo -n bash -c "echo '' > '$REMOTE_BACKUP_DIR/SHA256.txt'"
for f in lib/db/pg.ts app/api/action/attack/route.ts app/api/admin/users/search/route.ts; do
  h=$(sudo -n sha256sum "$REMOTE_APP/$f" | awk '{print $1}')
  sudo -n bash -c "echo '$h  $f' >> '$REMOTE_BACKUP_DIR/SHA256.txt'"
  echo "  $h  $f"
done

# Record state
echo ""
echo "[STEP 1d] Record state"
sudo -n bash -c "cat > '$REMOTE_BACKUP_DIR/STATE.txt' <<EOF
STAMP=$STAMP
EOF"

if sudo -n test -f "$REMOTE_APP/.next/BUILD_ID"; then
  BUILD_ID=$(sudo -n cat "$REMOTE_APP/.next/BUILD_ID")
  sudo -n bash -c "echo 'BUILD_ID_BEFORE=$BUILD_ID' >> '$REMOTE_BACKUP_DIR/STATE.txt'"
  echo "  BUILD_ID_BEFORE=$BUILD_ID"
fi

# PM2 state
echo ""
echo "[STEP 1e] Record PM2 state"
PM2_OUT=$(sudo -n pm2 jlist 2>/dev/null || echo "PM2_READ_FAIL")
if [ "$PM2_OUT" != "PM2_READ_FAIL" ]; then
  sudo -n bash -c "echo '$PM2_OUT' | python3 -c \"
import json,sys
try:
    data=json.loads(sys.stdin.read())
    for p in data:
        if p.get('name')=='repark-h5':
            print('PM2_NAME=' + str(p.get('name','')))
            print('PM2_PID=' + str(p.get('pid','')))
            pm2_env = p.get('pm2_env', {})
            print('PM2_STATUS=' + str(pm2_env.get('status','')))
            print('PM2_UPTIME=' + str(pm2_env.get('pm_uptime','')))
except Exception as e:
    print('PM2_PARSE_FAIL=' + str(e))
\" >> '$REMOTE_BACKUP_DIR/STATE.txt' 2>&1"
fi

echo ""
echo "[STEP 1f] Final state:"
sudo -n cat "$REMOTE_BACKUP_DIR/STATE.txt"
echo ""
echo "[STEP 1g] Final hashes:"
sudo -n cat "$REMOTE_BACKUP_DIR/SHA256.txt"
echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 1 COMPLETE]"
echo "═════════════════════════════════════════════════════════════"
