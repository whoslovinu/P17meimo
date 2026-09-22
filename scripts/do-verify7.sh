#!/bin/bash
echo '--- admin chunks ---'
find /var/www/app/.next/static/chunks/app/admin/ -name '*.js' 2>/dev/null | head -10
echo '--- copyToClipboard in admin chunks ---'
grep -rl 'copyToClipboard' /var/www/app/.next/static/chunks/app/admin/ 2>/dev/null | head -5
echo '--- copyToClipboard count in all admin ---'
find /var/www/app/.next/static/chunks/app/admin/ -name '*.js' -exec grep -l 'copyToClipboard' {} \; 2>/dev/null | head -5
