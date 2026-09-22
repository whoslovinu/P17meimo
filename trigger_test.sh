#!/bin/bash
# Trigger a task-claim via internal SQL — emulate what the front-end sends.

# 1. Find a real user UUID for uid=128
echo "=== Lookup uid=128 ==="
UUID_128=$(PGPASSWORD=repark psql -h 127.0.0.1 -U postgres -d repark_h5 -t -A -c "SELECT id FROM public.users WHERE external_id='128' OR external_id::text='128' LIMIT 1;" 2>/dev/null)
echo "  uuid: $UUID_128"

# 2. Show current state
echo ""
echo "=== task_progress for uid=128 ==="
PGPASSWORD=repark psql -h 127.0.0.1 -U postgres -d repark_h5 -c "SELECT task_type, current_progress, claimed_count, is_claimed, reset_date FROM public.task_progress WHERE user_id::text LIKE '%128%' ORDER BY reset_date DESC, task_type;" 2>&1

echo ""
echo "=== user_daily_tasks for uid=128 ==="
PGPASSWORD=repark psql -h 127.0.0.1 -U postgres -d repark_h5 -c "SELECT date, daily_energy_consumed, daily_money_recharged FROM public.user_daily_tasks WHERE user_id::text LIKE '%128%' ORDER BY date DESC;" 2>&1

# 3. Try the API
echo ""
echo "=== Trigger task-claim with cookie auth ==="
# Build a test cookie matching what middleware expects
COOKIE="uid=128"
# Get the uuid this maps to
RESP=$(curl -s -X POST "http://127.0.0.1:3000/api/battle/task-claim" \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d '{"task_type":"daily_recharge"}' \
  -w "\nHTTP_STATUS:%{http_code}")
echo "$RESP"