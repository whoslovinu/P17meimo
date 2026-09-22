#!/bin/bash
echo '--- client JS bundles ---'
ls -la /var/www/app/.next/static/chunks/*.js 2>/dev/null | tail -5
echo '--- grep for pipeline signals in client chunks ---'
grep -l 'isReadyForLiveView' /var/www/app/.next/static/chunks/*.js 2>/dev/null | head -3
grep -l 'isCurrentModelRendered' /var/www/app/.next/static/chunks/*.js 2>/dev/null | head -3
grep -l 'copyToClipboard' /var/www/app/.next/static/chunks/*.js 2>/dev/null | head -3
grep -l 'LoadingGate Check' /var/www/app/.next/static/chunks/*.js 2>/dev/null | head -3
echo '--- BattleLayout in chunks ---'
grep -l 'BattleLayout' /var/www/app/.next/static/chunks/*.js 2>/dev/null | head -3
