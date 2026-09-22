#!/bin/bash
echo '--- find copyToClipboard in all .next ---'
grep -rl 'copyToClipboard' /var/www/app/.next/ 2>/dev/null | grep -v '.map$' | head -10
echo '--- find in server/app/admin ---'
grep -rl 'copyToClipboard' /var/www/app/.next/server/app/admin/ 2>/dev/null | head -5
echo '--- find in page-level chunks ---'
grep -rl 'copyToClipboard' /var/www/app/.next/static/ 2>/dev/null | head -10
echo '--- ls of admin users page server chunk ---'
ls -la /var/www/app/.next/server/app/admin/users/page.js 2>/dev/null
wc -c /var/www/app/.next/server/app/admin/users/page.js 2>/dev/null
grep -c 'copyToClipboard' /var/www/app/.next/server/app/admin/users/page.js 2>/dev/null || echo 'NOT FOUND IN SERVER PAGE'
echo '--- search for isReadyForLiveView in same ---'
grep -c 'isReadyForLiveView' /var/www/app/.next/server/app/admin/users/page.js 2>/dev/null || echo 'NOT FOUND'
