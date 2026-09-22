#!/usr/bin/env bash
sleep 5
echo "=== Login attempt ==="
curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{"password":"giys-agjj-niqt-yx2g"}' \
  -c /tmp/cookies.txt \
  -w "\nHTTP %{http_code}\n"

echo ""
echo "=== Cookies ==="
grep admin_token /tmp/cookies.txt | awk '{print $6 ": " substr($7, 1, 20) "..."}'