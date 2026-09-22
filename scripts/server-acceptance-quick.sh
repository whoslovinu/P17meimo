#!/usr/bin/env bash
# scripts/server-acceptance-quick.sh — Quick smoke test for the deployed H5.
# Skips /api/internal/startup (requires HMAC token).
#
# REPARK 7.0 (2026-08-24) note: only reads /api/game/init for a generic
# `ok:true` check. The active route is /api/battle/init and now exposes
# activity-scoped personal_damage alongside global_damage. The smoke test
# is unaffected; no code change required.

echo "=== P17 H5 Quick Acceptance ==="
echo "Server: http://98.93.252.250:3000"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

PASS=0
FAIL=0

check() {
  local name="$1"
  local expected="$2"
  local url="$3"
  local auth="$4"
  local result
  if [[ -n "$auth" ]]; then
    result=$(curl -sf -H "$auth" --max-time 8 "$url" 2>/dev/null || echo "FAIL")
  else
    result=$(curl -sf --max-time 8 "$url" 2>/dev/null || echo "FAIL")
  fi
  if [[ "$result" == "FAIL" ]]; then
    echo "  ❌ $name  (curl failed)"
    FAIL=$((FAIL + 1))
    return
  fi
  if echo "$result" | grep -qE "$expected"; then
    echo "  ✅ $name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name  expected=$expected got=$result"
    FAIL=$((FAIL + 1))
  fi
}

echo "[1] Server reachable"
check "/api/time" '"ok":true' "http://localhost:3000/api/time"

echo "[2] Public endpoints"
check "/api/boss/status" '"ok":true' "http://localhost:3000/api/boss/status"
check "/api/banner" '"ok":true' "http://localhost:3000/api/banner"

echo "[3] Public data"
check "/api/game/init" '"ok":true' "http://localhost:3000/api/game/init"

echo "[4] Battle page renders"
check "/battle" '<html|<div' "http://localhost:3000/battle"

echo "[5] Homepage"
check "/" '<html|<div|<title' "http://localhost:3000/"

echo ""
echo "============================================"
echo " PASS: $PASS   FAIL: $FAIL"
echo "============================================"

if [[ $FAIL -eq 0 ]]; then
  echo "✅ Deployment looks healthy"
  exit 0
else
  echo "⚠️  $FAIL checks failed — see above"
  exit 1
fi