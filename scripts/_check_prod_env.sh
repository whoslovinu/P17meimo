#!/usr/bin/env bash
# Check the running next-server process env
PID=$(pgrep -f "next-server" | head -1)
echo "next-server PID: $PID"
echo
echo "--- Selected env vars ---"
cat /proc/$PID/environ 2>/dev/null | sed -e 's/\x00/\n/g' | grep -E "^(WEBHOOK_SECRET|NODE_ENV|NEXT_PUBLIC_TASK_THRESHOLD)" | head -10
echo
echo "--- Confirm WEBHOOK_SECRET first 8 chars ---"
cat /proc/$PID/environ 2>/dev/null | sed -e 's/\x00/\n/g' | grep "^WEBHOOK_SECRET" | head -1 | cut -c1-20
echo
echo "--- Total env vars ---"
cat /proc/$PID/environ 2>/dev/null | sed -e 's/\x00/\n/g' | wc -l