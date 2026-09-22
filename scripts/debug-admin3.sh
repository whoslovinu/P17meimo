#!/usr/bin/env bash
echo "=== Wait 60s for rate limit window to clear ==="
sleep 65

echo "=== Now login attempt ==="
curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{"password":"giys-agjj-niqt-yx2g"}' \
  -c /tmp/admin-cookies.txt \
  -w "\nHTTP %{http_code}\n"

echo ""
echo "=== Cookies received ==="
cat /tmp/admin-cookies.txt | grep -v "^#" | head

echo ""
echo "=== Try /admin/users/compensate with cookie ==="
curl -s -b /tmp/admin-cookies.txt http://localhost:3000/api/admin/users/compensate \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{}' \
  -w "\nHTTP %{http_code}\n"