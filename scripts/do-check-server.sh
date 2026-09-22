#!/bin/bash
echo '--- running next processes ---'
ps aux | grep 'next' | grep -v grep | head -5
echo '--- BUILD_ID ---'
cat /var/www/app/.next/BUILD_ID
echo '--- copyToClipboard grep ---'
grep -c 'copyToClipboard' /var/www/app/app/admin/users/page.tsx || echo 'NOT FOUND'
echo '--- PM2 error logs ---'
sudo pm2 logs repark-h5 --lines 5 --nostream 2>&1 | grep -v '^$' | tail -10
echo '--- .next ownership ---'
stat -c '%U:%G' /var/www/app/.next 2>&1
