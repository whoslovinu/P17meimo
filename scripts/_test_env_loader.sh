#!/usr/bin/env bash
# Test the env loader from next-start.sh in isolation
set -e
ENV_FILE="/var/www/app/.env.production"
echo "Source file: $ENV_FILE"
echo "File size:   $(wc -c < $ENV_FILE) bytes"
echo "File lines:  $(wc -l < $ENV_FILE)"
echo

# Mirror the loader logic exactly
set -a
COUNT=0
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == [[:space:]]#* ]] && continue
  [[ "$line" == \#* ]] && continue
  # skip lines without '='
  [[ "$line" != *"="* ]] && continue
  export "$line"
  COUNT=$((COUNT+1))
done < "$ENV_FILE"
set +a

echo "Exported $COUNT vars"
echo
echo "--- Selected vars ---"
echo "WEBHOOK_SECRET[0..20]=${WEBHOOK_SECRET:0:20}…"
echo "NODE_ENV=$NODE_ENV"
echo "NEXT_PUBLIC_TASK_THRESHOLD_ENERGY=$NEXT_PUBLIC_TASK_THRESHOLD_ENERGY"
echo "NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE=$NEXT_PUBLIC_TASK_THRESHOLD_RECHARGE"
echo "ADMIN_SECRET_KEY=${ADMIN_SECRET_KEY:0:6}…"
echo
echo "--- Total env vars in shell now ---"
env | wc -l