#!/bin/bash
# scripts/d1r1c-step12.sh — Verify rollback files exist
set -u

echo "═════════════════════════════════════════════════════════════"
echo "[STEP 12] Rollback readiness verification"
echo "═════════════════════════════════════════════════════════════"

# Find the backup directory
BACKUP_DIR=$(sudo -n bash -c "ls -1d /var/www/app/.rollback/shared-feedback-D1-R1-prod-before-* 2>/dev/null | sort | tail -1")
if [ -z "$BACKUP_DIR" ]; then
  echo "✗ NO BACKUP DIRECTORY FOUND"
  exit 1
fi
echo ""
echo "[12a] Backup directory: $BACKUP_DIR"
sudo -n ls -la "$BACKUP_DIR"

echo ""
echo "[12b] Backup files SHA256 (BEFORE deploy):"
sudo -n cat "$BACKUP_DIR/SHA256.txt" 2>/dev/null

echo ""
echo "[12c] Backup STATE (BUILD_ID, PM2):"
sudo -n cat "$BACKUP_DIR/STATE.txt" 2>/dev/null

echo ""
echo "[12d] Currently deployed SHA256 (AFTER deploy):"
echo "lib/db/pg.ts:"
sudo -n sha256sum /var/www/app/lib/db/pg.ts | awk '{print "  " $1}'
echo "app/api/action/attack/route.ts:"
sudo -n sha256sum /var/www/app/app/api/action/attack/route.ts | awk '{print "  " $1}'
echo "app/api/admin/users/search/route.ts:"
sudo -n sha256sum /var/www/app/app/api/admin/users/search/route.ts | awk '{print "  " $1}'

echo ""
echo "[12e] Verified D1-R1 hashes (intended deploy):"
echo "  lib/db/pg.ts          = 60a1d273be9a58de18a09573e46b8d5adc0603be2e70087c6a44cabd41c538e9"
echo "  attack/route.ts       = 18aefcb6dd551b5d331a3dae9acf1816ed4a203c40e588487fadffef5f60be77"
echo "  search/route.ts       = 3459c3e2d10235f15cb8e666880ad8a191b8418e4b18caf884a0a9f52cb9f3e1"

echo ""
echo "[12f] Rollback command (DO NOT EXECUTE NOW):"
cat <<'EOF'
  cd /var/www/app
  cp -f .rollback/shared-feedback-D1-R1-prod-before-<STAMP>/lib-db-pg.ts       lib/db/pg.ts
  cp -f .rollback/shared-feedback-D1-R1-prod-before-<STAMP>/app-api-action-attack-route.ts  app/api/action/attack/route.ts
  cp -f .rollback/shared-feedback-D1-R1-prod-before-<STAMP>/app-api-admin-users-search-route.ts  app/api/admin/users/search/route.ts
  npx tsc --noEmit
  NODE_ENV=production npx next build
  pm2 reload repark-h5 --update-env
EOF

echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 12 COMPLETE]"
echo "═════════════════════════════════════════════════════════════"
