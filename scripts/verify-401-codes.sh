#!/bin/bash
set -e
BASE="http://localhost:3000"

echo "=== Login (ENV password) ==="
curl -s -i -c /tmp/c6 -X POST $BASE/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password":"giys-agjj-niqt-yx2g"}' | head -2

echo
echo "=== A. IRON_GATE 401 (no cookie) — code: UNAUTHORIZED ==="
curl -s -X POST $BASE/api/admin/change-password \
  -H "Content-Type: application/json" \
  -d '{"oldPassword":"x","newPassword":"new12345678","confirmPassword":"new12345678"}' \
  | head -1

echo
echo "=== B. change-password w/ valid cookie, WRONG old pw — code: OLD_PASSWORD_MISMATCH ==="
curl -s -b /tmp/c6 -X POST $BASE/api/admin/change-password \
  -H "Content-Type: application/json" \
  -d '{"oldPassword":"WRONG","newPassword":"new12345678","confirmPassword":"new12345678"}' \
  | head -1

echo
echo "=== C. /api/admin/stats w/o cookie — code: UNAUTHORIZED ==="
curl -s -X POST $BASE/api/admin/stats \
  -H "Content-Type: application/json" -d '{}' \
  | head -1