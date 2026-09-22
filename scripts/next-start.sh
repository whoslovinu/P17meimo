#!/bin/bash
set -euo pipefail
APP_DIR="/var/www/app"
ENV_FILE="$APP_DIR/.env.production"

# Manually load .env.production — next start does NOT auto-load env files
if [[ -f "$ENV_FILE" ]]; then
  set -a
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == [[:space:]]#* ]] && continue
    export "$line"
  done < "$ENV_FILE"
  set +a
fi

export NODE_ENV=production

exec "$APP_DIR/node_modules/.bin/next" start
