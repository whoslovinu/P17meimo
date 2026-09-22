#!/bin/bash
# scripts/d1r1c-deploy-step4.sh — PM2 reload and verify health

echo "═════════════════════════════════════════════════════════════"
echo "[STEP 4a] PM2 reload repark-h5"
echo "═════════════════════════════════════════════════════════════"
sudo -n pm2 reload repark-h5 --update-env 2>&1 | tail -20

echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 4b] Wait for boot, then check PM2 status"
echo "═════════════════════════════════════════════════════════════"
sleep 8
sudo -n pm2 status repark-h5

echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 4c] Verify port 3000"
echo "═════════════════════════════════════════════════════════════"
ss -ltnp 2>/dev/null | grep -E ':3000\b' || echo "  ✗ Port 3000 NOT LISTENING"

echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 4d] /api/time → 200"
echo "═════════════════════════════════════════════════════════════"
HTTP_CODE=$(curl -s -o /tmp/api-time-out.txt -w '%{http_code}' http://127.0.0.1:3000/api/time)
echo "  HTTP $HTTP_CODE"
cat /tmp/api-time-out.txt
echo ""

echo ""
echo "═════════════════════════════════════════════════════════════"
echo "[STEP 4e] Record new BUILD_ID + PM2 PID"
echo "═════════════════════════════════════════════════════════════"
NEW_BUILD_ID=$(sudo -n cat /var/www/app/.next/BUILD_ID)
echo "  NEW BUILD_ID: $NEW_BUILD_ID"
NEW_PM2_PID=$(sudo -n pm2 jlist | python3 -c "
import json,sys
try:
    data=json.loads(sys.stdin.read())
    for p in data:
        if p.get('name')=='repark-h5':
            print(p.get('pid',''))
except:
    pass
")
echo "  NEW PM2 PID: $NEW_PM2_PID"
echo "NEW_BUILD_ID=$NEW_BUILD_ID" > /tmp/d1r1c-step4.txt
echo "NEW_PM2_PID=$NEW_PM2_PID" >> /tmp/d1r1c-step4.txt
