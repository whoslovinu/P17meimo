// scripts/run-deploy.mjs — Execute deploy script on server via SSH2
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import path from 'node:path';

const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const HOST = '98.93.252.250';
const USER = 'ubuntu';

const DEPLOY_DIR = '/tmp/deploy-2026-08-25T08-59-41';

const SCRIPT = `
DEPLOY_DIR="${DEPLOY_DIR}"
echo "=== CHECK SOURCE ==="
ls "$DEPLOY_DIR/.next/BUILD_ID" || exit 1
cat "$DEPLOY_DIR/.next/BUILD_ID"
echo ""
echo "=== STOP PM2 ==="
sudo -n pm2 delete repark-h5 2>/dev/null || true
echo "=== KILL PORT ==="
sudo fuser -k 3000/tcp 2>/dev/null || true
sleep 4
echo "=== PORT NOW ==="
ss -ltnp 2>/dev/null | grep :3000 || echo FREE
echo "=== COPY .next ==="
sudo mkdir -p /tmp/.next-new && sudo rm -rf /tmp/.next-new/*
cp -rT "$DEPLOY_DIR/.next" /tmp/.next-new
sudo cp -rT /tmp/.next-new /var/www/app/.next
sudo chown -R ubuntu:ubuntu /var/www/app/.next
echo COPY_OK
echo "=== COPY package ecosystem ==="
cp "$DEPLOY_DIR/package.json" /tmp/.pkg-new && sudo cp /tmp/.pkg-new /var/www/app/package.json
cp "$DEPLOY_DIR/ecosystem.config.js" /tmp/.eco-new && sudo cp /tmp/.eco-new /var/www/app/ecosystem.config.js && echo COPY_CONFIG_OK
echo "=== NEW BUILD_ID ==="
cat /var/www/app/.next/BUILD_ID
echo ""
echo "=== PM2 START ==="
sudo -n pm2 start /var/www/app/ecosystem.config.js --env production 2>&1
sleep 20
echo "=== PM2 STATUS ==="
sudo -n pm2 list 2>&1 | head -10
NPID=$(sudo -n pm2 pid repark-h5 2>/dev/null | head -1)
echo "tracked_pid=$NPID"
echo "=== PORT 3000 ==="
ss -ltnp 2>/dev/null | grep :3000 || echo NONE
echo "=== ACTUAL PID ==="
ss -ltnp 2>/dev/null | grep ':3000' | sed 's/.*pid=//' | sed 's/,.*//' | while read pid; do
  echo "actual_pid=$pid"
  PPID=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || echo '')
  echo "parent=$PPID"
  PM2D=$(pm2 pid 2>/dev/null | head -1 || echo '')
  echo "pm2_daemon=$PM2D"
  if [ "$PPID" = "$PM2D" ]; then
    echo "RESULT=ONLINE_UNDER_PM2"
  else
    echo "RESULT=ORPHAN"
  fi
done
echo "=== HEALTH ==="
curl -s -o /dev/null -w '/api/time: %{http_code}\n' http://127.0.0.1:3000/api/time || echo FAILED
curl -s -o /dev/null -w '/lb: %{http_code}\n' http://127.0.0.1:3000/api/battle/leaderboard || echo FAILED
echo "=== VERIFY afterrender GATE ==="
grep -n 'afterrender' /var/www/app/app/components/features/battle/SpineViewer.tsx 2>&1 | head -5
echo "=== PM2 SAVE ==="
sudo -n pm2 save 2>&1 && echo SAVED || echo SAVE_FAIL
echo "=== DONE ==="
`;

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      console.log('[SSH] Connected. Running deploy...');
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
