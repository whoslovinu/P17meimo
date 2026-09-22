#!/bin/bash
echo '=== Verify bundle has canvas gate ==='
grep -rln 'isCanvasRendered' /var/www/app/.next/server 2>&1 | head -5
echo '---'
grep -rln 'forceEnter BLOCKED' /var/www/app/.next/server 2>&1 | head -3
echo '---'
echo '=== current LoadingScreen compiled bundle ==='
grep -n 'isCanvasRendered\|firstVisibleFrame\|afterrender' /var/www/app/.next/static/chunks/2161.932c1676cf44bd17.js 2>&1 | head -3 || true
echo '---'
echo '=== current BattleLayout compiled bundle ==='
grep -rn 'isCanvasRendered' /var/www/app/.next/static/chunks 2>&1 | head -5