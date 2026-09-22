#!/bin/bash
set -e
BASE="http://localhost:3000"
ORIGIN="http://localhost:3000"

echo "=== 1. Login with original ENV password ==="
LOGIN_RESP=$(curl -s -c /tmp/admin.cookies -b /tmp/admin.cookies -X POST "$BASE/api/admin/login" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"password":"giys-agjj-niqt-yx2g"}')
echo "Login response: $LOGIN_RESP"
echo

echo "=== 2. Try change-password with WRONG old password (must reject 401) ==="
WRONG_RESP=$(curl -s -b /tmp/admin.cookies -X POST "$BASE/api/admin/change-password" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"oldPassword":"wrong-pw","newPassword":"NewSecret#2026","confirmPassword":"NewSecret#2026"}')
echo "Wrong-pw response: $WRONG_RESP"
echo

echo "=== 3. Change-password with CORRECT old password ==="
NEW_PW="NewSecret#2026"
GOOD_RESP=$(curl -s -b /tmp/admin.cookies -X POST "$BASE/api/admin/change-password" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "{\"oldPassword\":\"giys-agjj-niqt-yx2g\",\"newPassword\":\"$NEW_PW\",\"confirmPassword\":\"$NEW_PW\"}")
echo "Change response: $GOOD_RESP"
echo

echo "=== 4. Wait 1s for cache + cookie clear ==="
sleep 1

echo "=== 5. Login with NEW password (must succeed) ==="
NEW_LOGIN=$(curl -s -c /tmp/admin2.cookies -X POST "$BASE/api/admin/login" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "{\"password\":\"$NEW_PW\"}")
echo "New-password login: $NEW_LOGIN"
echo

echo "=== 6. Verify protected admin endpoint works with new cookie ==="
ME=$(curl -s -b /tmp/admin2.cookies "$BASE/api/admin/stats")
echo "Stats endpoint: $ME" | head -c 300
echo "..."

echo
echo "=== 7. Revert: change back to original ENV password ==="
sleep 1
REVERT=$(curl -s -b /tmp/admin2.cookies -X POST "$BASE/api/admin/change-password" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "{\"oldPassword\":\"$NEW_PW\",\"newPassword\":\"giys-agjj-niqt-yx2g\",\"confirmPassword\":\"giys-agjj-niqt-yx2g\"}")
echo "Revert response: $REVERT"
echo
echo "=== Done ==="