#!/bin/bash
# scripts/d1r1c-deploy-step2.sh — Verify uploaded files match local, then deploy

# Expected hashes (local D1-R1 verified, lowercase)
EXPECTED_LIB_DB_PG="60a1d273be9a58de18a09573e46b8d5adc0603be2e70087c6a44cabd41c538e9"
EXPECTED_ATTACK="18aefcb6dd551b5d331a3dae9acf1816ed4a203c40e588487fadffef5f60be77"
EXPECTED_SEARCH="3459c3e2d10235f15cb8e666880ad8a191b8418e4b18caf884a0a9f52cb9f3e1"

echo "═════════════════════════════════════════════════════════════"
echo "[STEP 2a] Verify /tmp uploaded file hashes"
echo "═════════════════════════════════════════════════════════════"

ACTUAL_LIB_DB_PG=$(sha256sum /tmp/lib-db-pg.ts | awk '{print $1}')
ACTUAL_ATTACK=$(sha256sum /tmp/attack-route.ts | awk '{print $1}')
ACTUAL_SEARCH=$(sha256sum /tmp/search-route.ts | awk '{print $1}')

echo "lib/db/pg.ts          local=$EXPECTED_LIB_DB_PG /tmp=$ACTUAL_LIB_DB_PG"
echo "attack/route.ts       local=$EXPECTED_ATTACK     /tmp=$ACTUAL_ATTACK"
echo "search/route.ts       local=$EXPECTED_SEARCH     /tmp=$ACTUAL_SEARCH"

if [ "$ACTUAL_LIB_DB_PG" != "$EXPECTED_LIB_DB_PG" ] || \
   [ "$ACTUAL_ATTACK" != "$EXPECTED_ATTACK" ] || \
   [ "$ACTUAL_SEARCH" != "$EXPECTED_SEARCH" ]; then
  echo ""
  echo "✗ HASH MISMATCH — ABORT DEPLOY"
  exit 1
fi
echo ""
echo "✓ All three files match verified D1-R1 hashes"

echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 2b] Deploy to /var/www/app (via sudo)"
echo "═════════════════════════════════════════════════════════════"

sudo -n cp /tmp/lib-db-pg.ts /var/www/app/lib/db/pg.ts && echo "  ✓ deployed lib/db/pg.ts"
sudo -n cp /tmp/attack-route.ts /var/www/app/app/api/action/attack/route.ts && echo "  ✓ deployed app/api/action/attack/route.ts"
sudo -n cp /tmp/search-route.ts /var/www/app/app/api/admin/users/search/route.ts && echo "  ✓ deployed app/api/admin/users/search/route.ts"

echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 2c] Verify deployed hashes"
echo "═════════════════════════════════════════════════════════════"

DEPLOYED_LIB_DB_PG=$(sudo -n sha256sum /var/www/app/lib/db/pg.ts | awk '{print $1}')
DEPLOYED_ATTACK=$(sudo -n sha256sum /var/www/app/app/api/action/attack/route.ts | awk '{print $1}')
DEPLOYED_SEARCH=$(sudo -n sha256sum /var/www/app/app/api/admin/users/search/route.ts | awk '{print $1}')

echo "lib/db/pg.ts          expected=$EXPECTED_LIB_DB_PG  deployed=$DEPLOYED_LIB_DB_PG"
echo "attack/route.ts       expected=$EXPECTED_ATTACK      deployed=$DEPLOYED_ATTACK"
echo "search/route.ts       expected=$EXPECTED_SEARCH      deployed=$DEPLOYED_SEARCH"

if [ "$DEPLOYED_LIB_DB_PG" != "$EXPECTED_LIB_DB_PG" ] || \
   [ "$DEPLOYED_ATTACK" != "$EXPECTED_ATTACK" ] || \
   [ "$DEPLOYED_SEARCH" != "$EXPECTED_SEARCH" ]; then
  echo ""
  echo "✗ DEPLOYED HASH MISMATCH — ABORT"
  exit 1
fi

echo ""
echo "✓ All deployed hashes match verified D1-R1"
echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 2 COMPLETE]"
echo "═════════════════════════════════════════════════════════════"
