#!/bin/bash
echo "===REBUILD_AS_ROOT==="
cd /var/www/app
echo "--- sudo check ---"
sudo -n true && echo "sudo: OK" || echo "sudo: PASSWORDLESS OK or unavailable"
echo ""
echo "--- existing .next dir ---"
stat -c '%U:%G %a' /var/www/app/.next
echo ""
echo "--- running build as root ---"
date +%s
sudo -n NODE_ENV=production npx next build 2>&1 | tail -30
echo "--- build finished ---"
date +%s
echo ""
echo "--- .next ownership after build ---"
stat -c '%U:%G %a' /var/www/app/.next