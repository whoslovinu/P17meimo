#!/bin/bash
# =============================================================================
# scripts/do-deploy-badge-phase1.sh
# REPARK Badge Phase 1 — Production Deployment Script
#
# Scope (TASK-restricted):
#   - supabase/migrations/16_add_badges_table.sql
#   - lib/db/pg.ts
#   - app/api/admin/badge/route.ts
#   - app/api/admin/badge/[id]/route.ts
#
# DO NOT touch: attack route / auth / redis / battle logic / UI / identity flow
#
# Usage (run on the EC2 instance, NOT locally):
#   cd /var/www/app
#   bash scripts/do-deploy-badge-phase1.sh
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

APP_DIR="/var/www/app"
BACKUP_DIR="/opt/repark/backups"
NOW=$(date +%Y%m%d_%H%M%S)

echo "=========================================="
echo "REPARK Badge Phase 1 — Production Deploy"
echo "Time: $NOW"
echo "=========================================="

# ── 1. DATABASE PRE-CHECK ───────────────────────────────────────────────────
echo ""
echo "[1/6] Database pre-check: verify public.badges does NOT exist..."
EXISTS=$(PGPASSWORD="$DATABASE_PASSWORD" psql \
  "${DATABASE_URL:-postgresql://postgres:CHANGE_ME@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres}" \
  -t -c "SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname='public' AND tablename='badges');" 2>/dev/null | tr -d ' ' || echo 'error')

if [[ "$EXISTS" == "t" || "$EXISTS" == "true" ]]; then
  echo "[ABORT] public.badges already exists. Migration already applied or collision."
  echo "        Run: SELECT id, name FROM public.badges ORDER BY id; to inspect."
  exit 1
fi
echo "[OK] public.badges does not exist — safe to proceed."

# ── 2. BACKUP (snapshot before schema change) ───────────────────────────────
echo ""
echo "[2/6] Pre-migration DB snapshot..."
mkdir -p "$BACKUP_DIR"
DUMP_FILE="$BACKUP_DIR/repark_pre_badge_phase1_${NOW}.dump"
if pg_dump \
  "${DATABASE_URL:-postgresql://postgres:CHANGE_ME@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres}" \
  -F c -b > "$DUMP_FILE" 2>&1; then
  SIZE=$(du -h "$DUMP_FILE" | cut -f1)
  echo "[OK] Backup saved: $DUMP_FILE ($SIZE)"
else
  echo "[WARN] Backup failed. Continuing anyway — migration is non-destructive."
fi

# ── 3. APPLY MIGRATION ──────────────────────────────────────────────────────
echo ""
echo "[3/6] Applying migration: 16_add_badges_table.sql..."
PGPASSWORD="$DATABASE_PASSWORD" psql \
  "${DATABASE_URL:-postgresql://postgres:CHANGE_ME@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres}" \
  -f "$APP_DIR/supabase/migrations/16_add_badges_table.sql" 2>&1

# Verify seed count
COUNT=$(PGPASSWORD="$DATABASE_PASSWORD" psql \
  "${DATABASE_URL:-postgresql://postgres:CHANGE_ME@rp1.c3qwr1twbd0j.us-east-1.rds.amazonaws.com:5432/postgres}" \
  -t -c "SELECT COUNT(*) FROM public.badges WHERE is_active=true;" 2>/dev/null | tr -d ' ')
if [[ "$COUNT" == "10" ]]; then
  echo "[OK] Migration applied. Seed verified: $COUNT active badges"
else
  echo "[WARN] Expected 10 active badges, got: $COUNT"
  echo "       Run: SELECT id, name, is_active FROM public.badges ORDER BY id;"
fi

# ── 4. SOURCE DEPLOY ─────────────────────────────────────────────────────────
echo ""
echo "[4/6] Deploying source files..."

# 4a. lib/db/pg.ts
echo "    lib/db/pg.ts..."
cp "$APP_DIR/lib/db/pg.ts" "$APP_DIR/lib/db/pg.ts.bak_${NOW}"
sudo cp "$APP_DIR/lib/db/pg.ts" /var/www/app/lib/db/pg.ts
sudo chown root:root /var/www/app/lib/db/pg.ts

# 4b. app/api/admin/badge/route.ts (new)
echo "    app/api/admin/badge/route.ts..."
mkdir -p "$APP_DIR/app/api/admin/badge"
cp "$APP_DIR/app/api/admin/badge/route.ts" "$APP_DIR/app/api/admin/badge/route.ts.bak_${NOW}" 2>/dev/null || true
sudo cp "$APP_DIR/app/api/admin/badge/route.ts" /var/www/app/app/api/admin/badge/route.ts
sudo chown root:root /var/www/app/app/api/admin/badge/route.ts

# 4c. app/api/admin/badge/[id]/route.ts (rewritten)
echo "    app/api/admin/badge/[id]/route.ts..."
sudo cp "$APP_DIR/app/api/admin/badge/[id]/route.ts" /var/www/app/app/api/admin/badge/[id]/route.ts
sudo chown root:root /var/www/app/app/api/admin/badge/[id]/route.ts

# Verify SHA256 of deployed files
echo ""
echo "    SHA256 verification:"
echo "    pg.ts      : $(sha256sum /var/www/app/lib/db/pg.ts | cut -c1-16)"
echo "    badge/     : $(sha256sum /var/www/app/app/api/admin/badge/route.ts | cut -c1-16)"
echo "    badge/[id] : $(sha256sum /var/www/app/app/api/admin/badge/[id]/route.ts | cut -c1-16)"

# ── 5. PM2 RESTART ──────────────────────────────────────────────────────────
echo ""
echo "[5/6] Restarting PM2..."
cd /var/www/app
sudo -E env NODE_ENV=production PORT=3000 npx next build 2>&1 | tail -5
sudo fuser -k 3000/tcp 2>/dev/null || true
sleep 2
sudo pm2 delete repark-h5 2>/dev/null || true
sleep 1
sudo pm2 start "$APP_DIR/ecosystem.config.js" --env production
sleep 8
sudo pm2 list

# ── 6. HEALTH CHECKS ─────────────────────────────────────────────────────────
echo ""
echo "[6/6] Health checks..."
sleep 3  # Allow server to warm up

PASS=0; FAIL=0

# 6a. GET /api/time (regression)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/time)
if [[ "$STATUS" == "200" ]]; then
  echo "[PASS] /api/time → $STATUS"
  ((PASS++))
else
  echo "[FAIL] /api/time → $STATUS (expected 200)"
  ((FAIL++))
fi

# 6b. GET /api/admin/badge (list)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/admin/badge)
BODY=$(curl -s http://127.0.0.1:3000/api/admin/badge)
if [[ "$STATUS" == "200" ]]; then
  echo "[PASS] GET /api/admin/badge → $STATUS"
  ((PASS++))
else
  echo "[FAIL] GET /api/admin/badge → $STATUS (expected 200)"
  echo "       Body: ${BODY:0:200}"
  ((FAIL++))
fi

# 6c. GET /api/admin/badge/10021 (known badge)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/admin/badge/10021)
BODY=$(curl -s http://127.0.0.1:3000/api/admin/badge/10021)
if [[ "$STATUS" == "200" ]] && echo "$BODY" | grep -q '"name"'; then
  echo "[PASS] GET /api/admin/badge/10021 → $STATUS (has name)"
  ((PASS++))
else
  echo "[FAIL] GET /api/admin/badge/10021 → $STATUS"
  echo "       Body: ${BODY:0:200}"
  ((FAIL++))
fi

# 6d. GET /api/admin/badge/99999999 (unknown badge → 404)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/admin/badge/99999999)
if [[ "$STATUS" == "404" ]]; then
  echo "[PASS] GET /api/admin/badge/99999999 → $STATUS (expected 404)"
  ((PASS++))
else
  echo "[FAIL] GET /api/admin/badge/99999999 → $STATUS (expected 404)"
  ((FAIL++))
fi

# 6e. GET /api/admin/badge/10035 (魅魔征服者)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/admin/badge/10035)
BODY=$(curl -s http://127.0.0.1:3000/api/admin/badge/10035)
if [[ "$STATUS" == "200" ]] && echo "$BODY" | grep -q '魅魔征服者'; then
  echo "[PASS] GET /api/admin/badge/10035 → 200 (魅魔征服者)"
  ((PASS++))
else
  echo "[FAIL] GET /api/admin/badge/10035 → $STATUS"
  echo "       Body: ${BODY:0:200}"
  ((FAIL++))
fi

# ── SUMMARY ────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "RESULT: PASS=$PASS / FAIL=$FAIL"
if [[ "$FAIL" -eq 0 ]]; then
  echo "STATUS: DEPLOY SUCCESS"
  echo "=========================================="
  echo "Badge Phase 1 deployed successfully."
  echo "DB backup: $DUMP_FILE"
  echo "Rollback:  bash scripts/do-rollback-badge-phase1.sh"
  exit 0
else
  echo "STATUS: DEPLOY FAILED — see FAIL entries above"
  echo "=========================================="
  echo "Run: bash scripts/do-rollback-badge-phase1.sh"
  exit 1
fi
