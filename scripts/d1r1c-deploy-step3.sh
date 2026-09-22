#!/bin/bash
# scripts/d1r1c-deploy-step3.sh — Run TSC + build on production
set -e
cd /var/www/app

echo "═════════════════════════════════════════════════════════════"
echo "[STEP 3a] TypeScript check (npx tsc --noEmit)"
echo "═════════════════════════════════════════════════════════════"
sudo -n bash -c "cd /var/www/app && npx tsc --noEmit" 2>&1 | tee /tmp/tsc-output.txt
TSC_EXIT=${PIPESTATUS[0]}
echo ""
echo "TSC exit code: $TSC_EXIT"

if [ "$TSC_EXIT" != "0" ]; then
  echo ""
  echo "✗ TSC FAILED — ABORT"
  exit 1
fi
echo "✓ TSC PASS"

echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 3b] Production build"
echo "═════════════════════════════════════════════════════════════"
sudo -n bash -c "cd /var/www/app && NODE_ENV=production npx next build" 2>&1 | tee /tmp/build-output.txt
BUILD_EXIT=${PIPESTATUS[0]}
echo ""
echo "Build exit code: $BUILD_EXIT"

if [ "$BUILD_EXIT" != "0" ]; then
  echo ""
  echo "✗ BUILD FAILED — ABORT"
  exit 1
fi

NEW_BUILD_ID=$(sudo -n cat /var/www/app/.next/BUILD_ID)
echo ""
echo "✓ BUILD PASS"
echo "NEW BUILD_ID: $NEW_BUILD_ID"
echo "$NEW_BUILD_ID" > /tmp/new-build-id.txt
