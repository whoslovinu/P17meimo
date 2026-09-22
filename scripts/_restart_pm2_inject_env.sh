#!/usr/bin/env bash
# Parse .env.production into PM2 env JSON and restart the app
set -e

ENV_FILE="/var/www/app/.env.production"
echo "Reading $ENV_FILE..."

# Build env JSON from file (skip comments and blanks)
ENV_JSON=$(node -e "
  const fs = require('fs');
  const out = {};
  const content = fs.readFileSync('$ENV_FILE', 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^[\"']|[\"']$/g, '');
    if (key) out[key] = val;
  }
  process.stdout.write(JSON.stringify(out));
")
echo "Built env JSON with $(echo $ENV_JSON | node -e 'process.stdin.on(\"data\",d=>console.log(JSON.parse(d).length))') keys"
echo

echo "── Step 1: Delete existing PM2 process ──"
pm2 delete repark-h5 2>/dev/null || echo "(no existing process)"
echo

echo "── Step 2: Start with npm start + injected env ──"
# Use Node child_process to pass env to PM2
node -e "
  const { execSync } = require('child_process');
  const env = JSON.parse(\`$ENV_JSON\`);
  const pm2env = JSON.stringify(env);
  const cmd = 'pm2 start npm --name repark-h5 -- -- start --update-env';
  console.log('Run:', cmd);
  // Use --cwd as well
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env, PM2_PROGRAMMATIC: '1' } });
" 2>&1 | tail -10
echo
sleep 5
echo "── Step 3: PM2 status ──"
pm2 list
echo
echo "── Step 4: Find next-server PID ──"
NEXT_PID=$(pgrep -f "next-server" | head -1)
echo "next-server PID: $NEXT_PID"
echo
echo "── Step 5: Check env vars ──"
if [ -n "$NEXT_PID" ]; then
  cat /proc/$NEXT_PID/environ | sed -e 's/\x00/\n/g' | grep -E "^(WEBHOOK_SECRET|NODE_ENV|NEXT_PUBLIC_TASK_THRESHOLD)" | head -10
fi
echo
echo "── Step 6: Save PM2 dump ──"
pm2 save
echo
echo "── Step 7: Health check ──"
sleep 2
curl -sf http://localhost:3000/api/internal/startup 2>/dev/null || echo "(startup endpoint no response)"