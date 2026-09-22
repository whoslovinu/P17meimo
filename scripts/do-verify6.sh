#!/bin/bash
echo '--- page chunks with copyToClipboard ---'
grep -rl 'copyToClipboard' /var/www/app/.next/static/chunks/app/ 2>/dev/null | head -5
echo '--- all app chunks ---'
ls /var/www/app/.next/static/chunks/app/ 2>/dev/null | head -10
echo '--- look in app/page chunks ---'
find /var/www/app/.next/static/chunks/app/ -name '*.js' 2>/dev/null | head -10
echo '--- admin users page chunk by date ---'
find /var/www/app/.next/static/chunks/app/ -name '*admin*users*' 2>/dev/null | head -5
find /var/www/app/.next/static/chunks/app/ -name '*users*admin*' 2>/dev/null | head -5
