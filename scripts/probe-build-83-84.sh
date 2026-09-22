#!/bin/bash
# scripts/probe-build-83-84.sh
# Remote-side orchestration script for the isolated build probe.
# Runs entirely on the production server. Does NOT touch /var/www/app, PM2,
# DB, Redis, or ACTIVE_CONTEXT.
set -u

PROBE_DIR="/tmp/repark-build-probe-83-84"
SRC_DIR="/var/www/app"
LOCAL_FIX_PATH="/tmp/local_search_route.ts"  # uploaded beforehand via SFTP

step() { echo "=== $* ==="; }

step "PRECHECK: PROBE_DIR"
if [ -e "$PROBE_DIR" ]; then
  echo "PROBE_DIR_ALREADY_EXISTS: $PROBE_DIR"
  echo "ABORTING — refusing to overwrite existing probe"
  exit 11
fi

step "MKDIR PROBE_DIR"
mkdir -p "$PROBE_DIR"
echo "created: $PROBE_DIR"

step "RSYNC /var/www/app → PROBE_DIR (exclude .next)"
# Copy everything except .next (we want a fresh build).
# Use --exclude for .next, and do NOT follow symlinks (defensive).
rsync -a --exclude='.next' --exclude='.audit' \
      "$SRC_DIR/" "$PROBE_DIR/"
RC=$?
echo "rsync exit code: $RC"
if [ "$RC" -ne 0 ]; then
  echo "RSYNC_FAILED"
  exit 12
fi

step "VERIFY PRE-FIX HASHES (before applying local fix)"
echo "list route hash:    $(sha256sum $PROBE_DIR/app/api/admin/users/list/route.ts   | awk '{print $1}')"
echo "search route hash:  $(sha256sum $PROBE_DIR/app/api/admin/users/search/route.ts | awk '{print $1}')"
echo "frontend page hash: $(sha256sum $PROBE_DIR/app/admin/users/page.tsx            | awk '{print $1}')"
echo "live /var/www/app search route hash: $(sha256sum $SRC_DIR/app/api/admin/users/search/route.ts | awk '{print $1}')"

step "APPLY LOCAL FIX: $LOCAL_FIX_PATH → search/route.ts"
if [ ! -f "$LOCAL_FIX_PATH" ]; then
  echo "LOCAL_FIX_NOT_UPLOADED_AT $LOCAL_FIX_PATH"
  echo "ABORTING — fix file missing"
  exit 13
fi
cp "$LOCAL_FIX_PATH" "$PROBE_DIR/app/api/admin/users/search/route.ts"
echo "fix applied"

step "VERIFY POST-FIX HASHES"
echo "list route hash:    $(sha256sum $PROBE_DIR/app/api/admin/users/list/route.ts   | awk '{print $1}')"
echo "search route hash:  $(sha256sum $PROBE_DIR/app/api/admin/users/search/route.ts | awk '{print $1}')"
echo "frontend page hash: $(sha256sum $PROBE_DIR/app/admin/users/page.tsx            | awk '{print $1}')"

step "BUILD: npm run build:no-lint"
cd "$PROBE_DIR"
npm run build:no-lint 2>&1
RC=$?
echo "build exit code: $RC"
exit $RC
