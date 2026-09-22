// scripts/run-deploy-v2.mjs
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import path from 'node:path';

const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const HOST = '98.93.252.250';
const USER = 'ubuntu';
const DEPLOY_DIR = '/tmp/deploy-2026-08-25T08-59-41';

// Step 1: Check new BUILD_ID
// Step 2: Delete PM2 (stops autorestart)
// Step 3: Kill orphan (port free)
// Step 4: Copy .next as ubuntu user (NO sudo on mkdir!)
// Step 5: Fix ownership
// Step 6: Start PM2
// Step 7: Verify

const SCRIPT = `
set -e
echo "=== SOURCE BUILD ==="
cat "${DEPLOY_DIR}/.next/BUILD_ID"
echo ""
echo "=== PM2 DELETE (stop autorestart) ==="
sudo -n pm2 delete repark-h5 2>/dev/null && echo DELETED || echo ALREADY_GONE
echo ""
echo "=== KILL ORPHAN ==="
sudo fuser -k 3000/tcp 2>/dev/null && echo KILLED || echo ALREADY_DEAD
sleep 4
echo "=== PORT ==="
ss -ltnp 2>/dev/null | grep :3000 || echo FREE
echo ""
echo "=== COPY .next as ubuntu (CRITICAL: no sudo on mkdir) ==="
mkdir -p /tmp/.next-deploy
rm -rf /tmp/.next-deploy/.next
cp -r "${DEPLOY_DIR}/.next" /tmp/.next-deploy/
sudo cp -rT /tmp/.next-deploy/.next /var/www/app/.next
sudo chown -R ubuntu:ubuntu /var/www/app/.next
echo "COPY OK"
echo ""
echo "=== COPY package ecosystem ==="
cp "${DEPLOY_DIR}/package.json" /var/www/app/package.json
cp "${DEPLOY_DIR}/ecosystem.config.js" /var/www/app/ecosystem.config.js
echo "CONFIG OK"
echo ""
echo "=== VERIFY BUILD_ID ==="
cat /var/www/app/.next/BUILD_ID
echo ""
echo "=== VERIFY afterrender ==="
grep -c 'afterrender' /var/www/app/app/components/features/battle/SpineViewer.tsx 2>/dev/null && echo "afterrender FOUND" || echo "afterrender NOT FOUND"
echo ""
echo "=== PM2 START ==="
sudo -n pm2 start /var/www/app/ecosystem.config.js --env production 2>&1
sleep 25
echo ""
echo "=== PM2 STATUS ==="
sudo -n pm2 list 2>&1 | head -10
NPID=$(sudo -n pm2 pid repark-h5 2>/dev/null | head -1)
echo "pm2_tracked_pid=$NPID"
echo ""
echo "=== PORT 3000 ==="
ss -ltnp 2>/dev/null | grep :3000 || echo NONE
NPID2=$(ss -ltnp 2>/dev/null | grep ':3000' 2>/dev/null | head -1 | sed 's/.*pid=//' | sed 's/,.*//')
echo "actual_pid=$NPID2"
echo ""
echo "=== PARENT CHAIN ==="
for pid in $NPID2 $NPID; do
  ppid_val=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || echo '')
  cmd_val=$(ps -o cmd= -p "$pid" 2>/dev/null | head -1 | cut -c1-60 || echo '')
  echo "pid=$pid ppid=$ppid_val cmd=$cmd_val"
done
PM2D=$(pm2 pid 2>/dev/null | head -1)
echo "pm2_daemon=$PM2D"
if [ "$NPID2" != "" ] && [ "$PM2D" != "" ]; then
  ppid_val=$(ps -o ppid= -p "$NPID2" 2>/dev/null | tr -d ' ')
  if [ "$ppid_val" = "$PM2D" ]; then
    echo "RESULT=ONLINE_UNDER_PM2"
  else
    echo "RESULT=ORPHAN ppid=$ppid_val"
  fi
fi
echo ""
echo "=== HEALTH ==="
curl -s -o /dev/null -w '/api/time: %{http_code}\n' http://127.0.0.1:3000/api/time || echo FAILED
curl -s -o /dev/null -w '/lb: %{http_code}\n' http://127.0.0.1:3000/api/battle/leaderboard || echo FAILED
echo ""
echo "=== PM2 SAVE ==="
sudo -n pm2 save 2>&1 && echo SAVED || echo SAVE_FAIL
echo ""
echo "=== DONE ==="
`;

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      console.log('[SSH] Connected. Running deploy v2...');
      conn.exec(SCRIPT, { pty: false }, (err, stream) => {
        if (err) { reject(err); return; }
        stream.on('data', (data) => process.stdout.write(data.toString()));
        stream.stderr.on('data', (data) => process.stderr.write(data.toString()));
        stream.on('close', (code) => {
          console.log('\n[EXIT] code=' + code);
          conn.end();
          resolve(code);
        });
      });
    });
    conn.on('error', (err) => { console.error('SSH error:', err.message); reject(err); });
    conn.connect({ host: HOST, port: 22, username: USER, privateKey, readyTimeout: 30000 });
  });
}

main().then(code => process.exit(code ?? 0)).catch(e => { console.error('FATAL:', e.message); process.exit(1); });
