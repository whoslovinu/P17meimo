#!/usr/bin/env bash
echo "=== Check ADMIN_SECRET_KEY on server ==="
grep -E "ADMIN_SECRET_KEY|ADMIN_DEV_BYPASS" /var/www/app/.env.production || echo "NOT FOUND"
echo ""
echo "=== First 10 chars ==="
grep ADMIN_SECRET_KEY /var/www/app/.env.production | cut -c1-80
echo ""
echo "=== /api/admin/validate (pre-login credential check) ==="
curl -s -X POST http://localhost:3000/api/admin/validate \
  -H "Content-Type: application/json" \
  -H "Origin: http://98.93.252.250:3000" \
  -d '{"password":"giys-agjj-niqt-yx2g"}' 2>&1
echo ""
echo ""
echo "=== Confirm SHA256 of 'giys-agjj-niqt-yx2g' ==="
echo -n 'giys-agjj-niqt-yx2g' | sha256sum