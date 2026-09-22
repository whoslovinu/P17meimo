#!/usr/bin/env bash
# REPARK 7.0 (2026-08-24) note: this script is a smoke test of public
# endpoints. Step 4 hits /api/game/init (legacy alias) — the active route
# is /api/battle/init and now exposes activity-scoped personal_damage.
# No code change required; document-only clarification.
echo "=== 1. /api/time ==="
curl -sf http://localhost:3000/api/time && echo

echo ""
echo "=== 2. /api/boss/status ==="
curl -sf http://localhost:3000/api/boss/status && echo

echo ""
echo "=== 3. /api/banner ==="
curl -sf http://localhost:3000/api/banner | head -c 200 && echo

echo ""
echo "=== 4. /api/game/init ==="
curl -sf http://localhost:3000/api/game/init | head -c 200 && echo

echo ""
echo "=== 5. /api/user/status (with userId) ==="
curl -sf "http://localhost:3000/api/user/status?userId=11111111-1111-1111-1111-111111111111" | head -c 300 && echo

echo ""
echo "=== 6. /api/battle/init (no cookie - may fail) ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/battle/init

echo ""
echo "=== 7. /api/battle/leaderboard ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/api/battle/leaderboard

echo ""
echo "=== 8. /api/battle/task-claim with userId (POST) ==="
curl -s -X POST "http://localhost:3000/api/battle/task-claim?userId=11111111-1111-1111-1111-111111111111" \
  -H "Content-Type: application/json" \
  -d '{"type":"energy_consumed"}' \
  -w "\nHTTP %{http_code}\n"

echo ""
echo "=== 9. Admin login again (verify cookie works) ==="
curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{"password":"giys-agjj-niqt-yx2g"}' \
  -c /tmp/admin-cookies.txt \
  -w "\nHTTP %{http_code}\n"

echo ""
echo "=== 10. Admin logout (with cookie) ==="
curl -s -X POST http://localhost:3000/api/admin/logout \
  -H "Origin: http://98.93.252.250:3000" \
  -b /tmp/admin-cookies.txt \
  -w "\nHTTP %{http_code}\n"