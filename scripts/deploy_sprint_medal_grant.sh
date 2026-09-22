#!/usr/bin/env bash
#
# deploy_sprint_medal_grant.sh
# Production deployment script for REPARK 7.0 sprint medal-grant + admin bypass.
#
# Requires:
#   - SSH key: H:\PROJECT\P17_H5meimo-demo\keys\mercenary_h5_project.pem
#   - Bastion host: mercenary@18.212.214.88
#   - Target: /var/www/app on 98.93.252.250
#   - Migration file: supabase/migrations/17_milestone_admin_bypass.sql
#
# What it does:
#   1. Snapshot current state (PM2 status, BUILD_ID)
#   2. Build in a temp directory on the server
#   3. Apply migration17 (idempotent, with IF NOT EXISTS semantics)
#   4. Stop PM2, atomically swap build, restart PM2
#   5. Health check
#   6. Rollback on failure
#
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
SSH_KEY="H:\\PROJECT\\P17_H5meimo-demo\\keys\\mercenary_h5_project.pem"
SSH_KEY_ESCAPED="H:/PROJECT/P17_H5meimo-demo/keys/mercenary_h5_project.pem"
SSH_OPTS="-i '$SSH_KEY_ESCAPED' -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
SSH_CMD="ssh $SSH_OPTS -tt mercenary@18.212.214.88"
SCP_CMD="scp -i '$SSH_KEY_ESCAPED' -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

REMOTE_USER=root
REMOTE_HOST=98.93.252.250
REMOTE_APP_DIR=/var/www/app
REMOTE_NEXUS_DIR=/var/www/nexus
REMOTE_SNAPSHOT_DIR=/var/www/snapshot-$(date +%Y%m%dT%H%M%S)
REMOTE_MIGRATION_DIR=/var/www/migrations
REMOTE_BUILD_STAGE=/var/www/build-stage-$$

# Local project root
LOCAL_PROJECT="H:\\PROJECT\\P17_H5meimo-demo"
LOCAL_PROJECT_FWD="H:/PROJECT/P17_H5meimo-demo"

# ── Helpers ───────────────────────────────────────────────────────────────────
log() { echo "[DEPLOY $(date +%H:%M:%S)] $*"; }
warn() { echo "[DEPLOY $(date +%H:%M:%S)] WARN: $*" >&2; }
die()  { echo "[DEPLOY $(date +%H:%M:%S)] ERROR: $*" >&2; exit 1; }

remote_exec() {
  $SSH_CMD "sudo /bin/bash -se" <<'REMOTE_SCRIPT'
set -euo pipefail
REMOTE_SCRIPT
}

remote_run() {
  $SSH_CMD <<'REMOTE_SCRIPT'
set -euo pipefail
REMOTE_SCRIPT
}

# ── Pre-flight ─────────────────────────────────────────────────────────────────
log "=== PRE-FLIGHT ==="
log "SSH key: $SSH_KEY"
log "Remote app: $REMOTE_USER@$REMOTE_HOST:$REMOTE_APP_DIR"
log "Snapshot dir: $REMOTE_SNAPSHOT_DIR"

# Verify key exists locally
if [[ ! -f "$LOCAL_PROJECT/keys/mercenary_h5_project.pem" ]]; then
  die "SSH key not found: $LOCAL_PROJECT/keys/mercenary_h5_project.pem"
fi

# ── Step 1: Snapshot current state ───────────────────────────────────────────
log "=== STEP 1: SNAPSHOT CURRENT STATE ==="
$SSH_CMD <<'REMOTE_SCRIPT'
set -euo pipefail
echo "--- PM2 status ---"
pm2 list 2>&1 | head -10
echo ""
echo "--- BUILD_ID ---"
cat /var/www/app/.next/BUILD_ID 2>/dev/null || echo "(not found)"
echo ""
echo "--- ecosystem config ---"
ls -la /var/www/app/ecosystem.config.js 2>/dev/null || echo "(not found)"
echo ""
echo "--- migration history ---"
# Check if migration17 columns already exist
psql "$DATABASE_URL" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='milestone_rewards' AND column_name IN ('admin_bypass','admin_bypass_source');" 2>/dev/null || echo "(psql not available or connection failed)"
REMOTE_SCRIPT

# ── Step 2: Create snapshot directory ─────────────────────────────────────────
log "=== STEP 2: CREATE SNAPSHOT ==="
$SSH_CMD <<'REMOTE_SCRIPT'
set -euo pipefail
SNAPSHOT_DIR="/var/www/snapshot-$(date +%Y%m%dT%H%M%S)"
echo "Creating snapshot at: $SNAPSHOT_DIR"
mkdir -p "$SNAPSHOT_DIR"
# Snapshot .next build
cp -r /var/www/app/.next "$SNAPSHOT_DIR/.next"
# Snapshot key source files (not node_modules)
for f in \
  app/api/game/milestone/claim/route.ts \
  app/api/battle/init/route.ts \
  app/components/features/battle/SubPageModal.tsx \
  lib/badgeNameCache.ts \
  lib/db/pg.ts \
  app/api/admin/activity/update/route.ts \
  app/api/admin/users/search/route.ts \
  app/api/admin/users/page.tsx \
  app/api/admin/users/\[uid\]/milestones/override/route.ts \
  supabase/migrations/17_milestone_admin_bypass.sql \
  tests/unit/cross-activity-milestone.spec.ts \
  tests/unit/get-form-status.spec.ts \
  tests/unit/override-semantics.spec.ts \
  tests/unit/battle-form-state.spec.ts \
  tests/unit/milestone-claim-grant.spec.ts
do
  mkdir -p "$SNAPSHOT_DIR/$(dirname $f)"
  cp "/var/www/app/$f" "$SNAPSHOT_DIR/$f" 2>/dev/null && echo "  + $f" || echo "  - $f (not found)"
done
echo "Snapshot complete: $SNAPSHOT_DIR"
REMOTE_SCRIPT

# ── Step 3: Upload source + build ─────────────────────────────────────────────
log "=== STEP 3: UPLOAD SOURCE ==="
BUILD_STAGE="/var/www/build-stage-$$"

$SCP_CMD -r \
  "$LOCAL_PROJECT_FWD/app/api/game/milestone" \
  "$LOCAL_PROJECT_FWD/app/api/battle/init/route.ts" \
  "$LOCAL_PROJECT_FWD/app/components/features/battle/SubPageModal.tsx" \
  "$LOCAL_PROJECT_FWD/lib/badgeNameCache.ts" \
  "$LOCAL_PROJECT_FWD/lib/db/pg.ts" \
  "$LOCAL_PROJECT_FWD/app/api/admin/activity/update/route.ts" \
  "$LOCAL_PROJECT_FWD/app/api/admin/users/search/route.ts" \
  "$LOCAL_PROJECT_FWD/app/api/admin/users/page.tsx" \
  "$LOCAL_PROJECT_FWD/app/api/admin/users/[uid]/milestones/override/route.ts" \
  "$LOCAL_PROJECT_FWD/supabase/migrations/17_milestone_admin_bypass.sql" \
  "$LOCAL_PROJECT_FWD/tests/unit/cross-activity-milestone.spec.ts" \
  "$LOCAL_PROJECT_FWD/tests/unit/get-form-status.spec.ts" \
  "$LOCAL_PROJECT_FWD/tests/unit/override-semantics.spec.ts" \
  "$LOCAL_PROJECT_FWD/tests/unit/battle-form-state.spec.ts" \
  "$LOCAL_PROJECT_FWD/tests/unit/milestone-claim-grant.spec.ts" \
  "$REMOTE_USER@$REMOTE_HOST:/var/www/upload-stage-$$/" 2>&1 | head -20 || true

log "Source uploaded to /var/www/upload-stage-$$"

# ── Step 4: Apply migration17 ─────────────────────────────────────────────────
log "=== STEP 4: APPLY MIGRATION17 ==="
$SSH_CMD <<'REMOTE_SCRIPT'
set -euo pipefail
MIGRATION="/var/www/migrations/17_milestone_admin_bypass.sql"
echo "Migration file exists: $(test -f $MIGRATION && echo YES || echo NO)"

# Check if columns already exist
EXISTING=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.columns WHERE table_name='milestone_rewards' AND column_name IN ('admin_bypass','admin_bypass_source');" 2>/dev/null || echo "0")
echo "Existing bypass columns: $EXISTING"

if [[ "$EXISTING" == "0" ]]; then
  echo "Applying migration17..."
  psql "$DATABASE_URL" -f "$MIGRATION" 2>&1
  echo "Migration applied."
else
  echo "Migration17 already applied (columns exist). Skipping."
fi

# Verify
psql "$DATABASE_URL" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='milestone_rewards' AND column_name LIKE '%bypass%';" 2>/dev/null || echo "Verification failed"
REMOTE_SCRIPT

# ── Step 5: Build on server ───────────────────────────────────────────────────
log "=== STEP 5: BUILD ON SERVER ==="
$SSH_CMD <<'REMOTE_SCRIPT'
set -euo pipefail
BUILD_DIR="/var/www/build-$$"
UPLOAD_DIR="/var/www/upload-stage-$$"
echo "Build directory: $BUILD_DIR"

mkdir -p "$BUILD_DIR"
cp -r /var/www/app/node_modules "$BUILD_DIR/"
cp -r /var/www/app/package.json "$BUILD_DIR/"
cp -r /var/www/app/package-lock.json "$BUILD_DIR/" 2>/dev/null || true
cp -r "$UPLOAD_DIR"/* "$BUILD_DIR/" 2>/dev/null || true

cd "$BUILD_DIR"
echo "Running npm install..."
npm install --prefer-offline 2>&1 | tail -5
echo "Running npm run build..."
npm run build 2>&1 | tail -20
BUILD_EXIT=$?
echo "Build exit code: $BUILD_EXIT"

if [[ $BUILD_EXIT -ne 0 ]]; then
  echo "BUILD FAILED. Aborting deployment."
  exit 1
fi

# Capture BUILD_ID
cat .next/BUILD_ID
echo "Build complete. BUILD_ID=$(cat .next/BUILD_ID)"
REMOTE_SCRIPT

BUILD_ID=$($SSH_CMD "cat /proc/$$/fd/1 2>/dev/null" | grep "BUILD_ID=" | tail -1 | sed 's/BUILD_ID=//' || echo "unknown")

# ── Step 6: Atomic swap ───────────────────────────────────────────────────────
log "=== STEP 6: ATOMIC SWAP ==="
$SSH_CMD <<'REMOTE_SCRIPT'
set -euo pipefail
BUILD_DIR="/var/www/build-$$"
APP_DIR="/var/www/app"
BUILD_ID_FILE="$APP_DIR/.next/BUILD_ID"

echo "Stopping PM2..."
pm2 stop repark-h5 2>&1 | tail -3
sleep 2

echo "Backing up current .next..."
cp -r "$APP_DIR/.next" "$APP_DIR/.next.backup-$(date +%Y%m%dT%H%M%S)" 2>/dev/null || true

echo "Swapping .next..."
rm -rf "$APP_DIR/.next"
mv "$BUILD_DIR/.next" "$APP_DIR/.next"

echo "New BUILD_ID: $(cat $BUILD_ID_FILE)"

echo "Restarting PM2..."
pm2 startOrRestart repark-h5 2>&1 | tail -5
sleep 5

echo "PM2 status after restart:"
pm2 list 2>&1 | head -6
REMOTE_SCRIPT

# ── Step 7: Health check ───────────────────────────────────────────────────────
log "=== STEP 7: HEALTH CHECK ==="
HEALTH_STATUS="FAIL"
for i in 1 2 3; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/time 2>/dev/null || echo "000")
  echo "Health attempt $i: HTTP $HTTP_CODE"
  if [[ "$HTTP_CODE" == "200" ]]; then
    HEALTH_STATUS="PASS"
    break
  fi
  sleep 3
done

if [[ "$HEALTH_STATUS" != "PASS" ]]; then
  warn "Health check FAILED. Initiating rollback..."
  # Rollback is handled by the REMOTE_SCRIPT block below which runs on failure
  $SSH_CMD <<'ROLLBACK_SCRIPT'
set -euo pipefail
echo "ROLLBACK: Restoring backup .next..."
APP_DIR="/var/www/app"
LATEST_BACKUP=$(ls -t "$APP_DIR"/.next.backup-* 2>/dev/null | head -1)
if [[ -n "$LATEST_BACKUP" ]]; then
  echo "Using backup: $LATEST_BACKUP"
  pm2 stop repark-h5 2>&1 | tail -2
  rm -rf "$APP_DIR/.next"
  cp -r "$LATEST_BACKUP" "$APP_DIR/.next"
  pm2 startOrRestart repark-h5 2>&1 | tail -3
  echo "Rollback complete."
else
  echo "No backup found. Manual intervention required."
fi
ROLLBACK_SCRIPT
  die "Health check failed. Rollback executed."
fi

# ── Step 8: Verify build contains new logic ───────────────────────────────────
log "=== STEP 8: VERIFY NEW BUILD ==="
$SSH_CMD <<'REMOTE_SCRIPT'
set -euo pipefail
echo "Checking .next for new logic..."
# Look for the grantBadge call in compiled output (it gets minified)
if grep -q "勋章发放失败\|grantBadge\|main_station" /var/www/app/.next/static/chunks/*.js 2>/dev/null | head -1; then
  echo "  + New claim/grant logic found in build"
else
  echo "  ! Warning: could not confirm grant logic in build"
fi
echo "BUILD_ID: $(cat /var/www/app/.next/BUILD_ID)"
echo "Admin bypass check:"
psql "$DATABASE_URL" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='milestone_rewards' AND column_name='admin_bypass';" 2>/dev/null || echo "(psql not available)"
REMOTE_SCRIPT

log "=== DEPLOY COMPLETE ==="
log "BUILD_ID: see above"
log "HEALTH: $HEALTH_STATUS"
log "Rollback snapshot: $REMOTE_SNAPSHOT_DIR"
