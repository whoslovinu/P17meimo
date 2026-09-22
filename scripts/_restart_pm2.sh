#!/usr/bin/env bash
# Restart PM2 with ecosystem.config.js (which uses next-start.sh for env loading)
set -e
echo "── Step 1: Stop existing PM2 process ──"
pm2 delete repark-h5 2>/dev/null || echo "(no existing process to delete)"
echo
echo "── Step 2: Start with ecosystem.config.js ──"
pm2 start /var/www/app/ecosystem.config.js --env production --update-env
pm2 save
echo
sleep 6
echo "── Step 3: PM2 status ──"
pm2 list
echo
echo "── Step 4: Find next-server PID ──"
NEXT_PID=$(pgrep -f "next-server" | head -1)
echo "next-server PID: $NEXT_PID"
echo
echo "── Step 5: Check env vars in next-server ──"
if [ -n "$NEXT_PID" ]; then
  cat /proc/$NEXT_PID/environ | sed -e 's/\x00/\n/g' | grep -E "^(WEBHOOK_SECRET|NODE_ENV|NEXT_PUBLIC_TASK_THRESHOLD)" | head -10
fi
echo
echo "── Step 6: Total env count ──"
if [ -n "$NEXT_PID" ]; then
  cat /proc/$NEXT_PID/environ | sed -e 's/\x00/\n/g' | wc -l
fi