#!/bin/bash
echo '--- .env.local ---'
sudo cat /var/www/app/.env.local 2>&1 | grep -v SECRET | grep -v KEY | grep -v PASS | head -20
echo '--- ADMIN related vars ---'
sudo cat /var/www/app/.env.local 2>&1 | grep -E 'ADMIN' | head -5
echo '--- env vars ---'
sudo cat /proc/893119/environ | tr '\0' '\n' | grep -v SECRET | grep -v PASS | head -20
