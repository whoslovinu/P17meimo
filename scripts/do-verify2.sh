#!/bin/bash
echo '--- server chunks with pipeline signals ---'
grep -rl 'isReadyForLiveView' /var/www/app/.next/server/ 2>/dev/null | head -3
echo '--- page-server chunks with isCurrentModelRendered ---'
grep -rl 'isCurrentModelRendered' /var/www/app/.next/server/ 2>/dev/null | head -3
echo '--- copyToClipboard in server ---'
grep -rl 'copyToClipboard' /var/www/app/.next/server/ 2>/dev/null | head -3
echo '--- page-app battle page-server size ---'
ls -la /var/www/app/.next/server/app/battle/page_client-reference-manifest.js 2>/dev/null || echo 'NOT FOUND'
ls -la /var/www/app/.next/server/app/admin/users/page_client-reference-manifest.js 2>/dev/null || echo 'NOT FOUND'
echo '--- recent error logs ---'
tail -20 /home/ubuntu/.pm2/logs/repark-h5-error-0.log 2>/dev/null | grep -v '^\[TAILING\]' | head -10
