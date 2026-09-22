#!/bin/bash
echo '--- isReadyForLiveView gate ---'
grep -c 'isReadyForLiveView' /var/www/app/.next/static/chunks/*.js 2>/dev/null | grep -v ':0$' | head -5
grep -c 'isReadyForLiveView' /var/www/app/.next/static/chunks/*.js 2>/dev/null | grep ':0$' | wc -l
echo '--- isCurrentModelRendered gate ---'
grep -c 'isCurrentModelRendered' /var/www/app/.next/static/chunks/*.js 2>/dev/null | grep -v ':0$' | head -5
grep -c 'isCurrentModelRendered' /var/www/app/.next/static/chunks/*.js 2>/dev/null | grep ':0$' | wc -l
echo '--- battleInit + isAssetLoaded gate ---'
grep -c 'battleInit' /var/www/app/.next/static/chunks/*.js 2>/dev/null | grep -v ':0$' | head -5
grep -c 'isAssetLoaded' /var/www/app/.next/static/chunks/*.js 2>/dev/null | grep -v ':0$' | head -5
echo '--- copyToClipboard ---'
grep -c 'copyToClipboard' /var/www/app/.next/static/chunks/*.js 2>/dev/null | grep -v ':0$' | head -5
echo '--- LoadingGate Check diagnostic ---'
grep -c 'LoadingGate Check' /var/www/app/.next/static/chunks/*.js 2>/dev/null | grep -v ':0$' | head -5
echo '--- First Frame Physically Rendered ---'
grep -c 'First Frame Physically Rendered' /var/www/app/.next/static/chunks/*.js 2>/dev/null | grep -v ':0$' | head -5
echo '--- PM2 out log recent ---'
tail -5 /home/ubuntu/.pm2/logs/repark-h5-out-0.log | grep -v '^\[' | head -5
