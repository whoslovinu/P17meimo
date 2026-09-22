#!/bin/bash
# =============================================================================
# scripts/do-rollback-badge-phase1.sh
# REPARK Badge Phase 1 — Rollback Script
#
# Restores:
#   - Source files (pg.ts + badge routes) from .bak_$TIMESTAMP backups
#   - DATABASE: DROP TABLE public.badges (removes badge data)
#
# Usage:
#   bash scripts/do-rollback-badge-phase1.sh
# =============================================================================

set -euo pipefail

APP_DIR="/var/www/app"

echo "=========================================="
echo "REPARK Badge Phase 1 — ROLLBACK"
echo "=========================================="
echo ""
echo "[WARN] This will:"
echo "  1. Restore source files from backups"
echo "  2. DROP TABLE public.badges"
echo ""
read -p "Continue? (yes/no): " confirm
if [[ "$confirm" != "yes" ]]; then
  echo "Aborted."
  exit 0
fi

# ── 1. Restore source files ─────────────────────────────────────────────────
echo ""
echo "[1/3] Restoring source files from backups..."

# Find most recent backup
BKS=($APP_DIR/lib/db/pg.ts.bak_*)
BKP="${BKS[-1]}"
if [[ -f "$BKP" ]]; then
  echo "    Restoring: $BKP"
  sudo cp "$BKP" /var/www/app/lib/db/pg.ts
  sudo chown root:root /var/www/app/lib/db/pg.ts
else
  echo "[WARN] No pg.ts backup found — skipping"
fi

BKA=($APP_DIR/app/api/admin/badge/route.ts.bak_*)
BKA="${BKA[-1]}"
if [[ -f "$BKA" ]]; then
  echo "    Restoring badge list route: $BKA"
  sudo cp "$BKA" /var/www/app/app/api/admin/badge/route.ts
  sudo chown root:root /var/www/app/app/api/admin/badge/route.ts
else
  echo "[WARN] No badge/route.ts backup found"
fi

# badge/[id]/route.ts: no backup (was rewritten), but we still restore from git
echo "    Restoring badge/[id] from git HEAD..."
cd "$APP_DIR"
sudo git checkout HEAD -- app/api/admin/badge/\[id\]/route.ts 2>/dev/null || \
  sudo cp "$APP_DIR/.git_backup/app/api/admin/badge/[id]/route.ts" /var/www/app/app/api/admin/badge/[id]/route.ts 2>/dev/null || \
  echo "[WARN] Could not restore [id]/route.ts — check manually"
sudo chown root:root /var/www/app/app/api/admin/badge/\[id\]/route.ts

# ── 2. PM2 restart ─────────────────────────────────────────────────────────
echo ""
echo "[2/3] Rebuilding and restarting PM2..."
cd "$APP_DIR"
sudo -E env NODE_ENV=production PORT=3000 npx next build 2>&1 | tail -3
sudo fuser -k 3000/tcp 2>/dev/null || true
sleep 2
sudo pm2 delete repark-h5 2>/dev/null || true
sleep 1
sudo pm2 start "$APP_DIR/ecosystem.config.js" --env production
sleep 8
sudo pm2 list

# ── 3. Database rollback ───────────────────────────────────────────────────
echo ""
echo "[3/3] Rolling back database..."
read -p "Drop public.badges table? (yes/no): " confirm2
if [[ "$confirm2" == "yes" ]]; then
  PGPASSWORD="$DATABASE_PASSWORD" psql \
    "${DATABASE_URL:-postgresql://postgres:CHANGE_ME@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres}" \
    -c "DROP TABLE IF EXISTS public.badges CASCADE;" 2>&1
  echo "[OK] Table dropped."
else
  echo "[SKIP] Table NOT dropped. Manually run:"
  echo "  DROP TABLE IF EXISTS public.badges CASCADE;"
fi

# ── 4. Health check ─────────────────────────────────────────────────────────
echo ""
echo "[4/4] Health check..."
sleep 3
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/time)
echo "/api/time → $STATUS"
if [[ "$STATUS" == "200" ]]; then
  echo "[OK] Server responding."
else
  echo "[FAIL] Server not responding correctly."
fi

echo ""
echo "=========================================="
echo "ROLLBACK COMPLETE"
echo "=========================================="
