#!/usr/bin/env bash
echo "=== Search the ACTUAL deployed route.js for HMAC mismatch ==="
# Look in the .next/server path that the running PM2 process is using
grep -oE "(HMAC mismatch|WEBHOOK.*mismatch|expected=)" /var/www/app/.next/server/app/api/webhook/user-action/route.js 2>/dev/null | head -3
echo
echo "=== File timestamp ==="
ls -la /var/www/app/.next/server/app/api/webhook/user-action/route.js