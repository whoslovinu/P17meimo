#!/bin/bash
echo '--- copyToClipboard in admin users page chunk ---'
grep -rl 'copyToClipboard' /var/www/app/.next/server/app/admin/users/ 2>/dev/null | head -3
grep -c 'copyToClipboard' /var/www/app/.next/server/app/admin/users/*.js 2>/dev/null | grep -v ':0$'
echo '--- page JS for admin users ---'
ls -la /var/www/app/.next/server/app/admin/users/page_client-reference-manifest.js 2>/dev/null
echo '--- grep main-app chunk for copyToClipboard ---'
grep -c 'copyToClipboard' /var/www/app/.next/static/chunks/main-app-*.js 2>/dev/null || echo 'NOT IN MAIN-APP'
echo '--- any chunk with copyToClipboard ---'
grep -rl 'copyToClipboard' /var/www/app/.next/static/chunks/ 2>/dev/null | head -5
