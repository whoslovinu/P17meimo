#!/bin/bash
echo '--- PM2 error logs ---'
sudo pm2 logs repark-h5 --lines 15 --nostream 2>&1 | grep -v '^$' | tail -20
echo '--- running next processes ---'
ps aux | grep 'next' | grep -v grep | head -5
echo '--- BUILD_ID ---'
cat /var/www/app/.next/BUILD_ID
echo '--- copyToClipboard ---'
grep -c 'copyToClipboard' /var/www/app/app/admin/users/page.tsx 2>&1 || echo 'NOT FOUND'
