// scripts/run-fix-v3.mjs
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import path from 'node:path';

const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const HOST = '98.93.252.250';
const USER = 'ubuntu';

const SCRIPT = `
echo "=== DIAG: what owns port 3000? ==="
ss -ltnp 2>/dev/null | grep :3000
PID_NOW=$(ss -ltnp 2>/dev/null | grep ':3000' 2>/dev/null | head -1 | sed 's/.*pid=//' | sed 's/,.*//')
echo "pid=$PID_NOW"
if [ -n "$PID_NOW" ]; then
  ps -fp $PID_NOW
  PPID_NOW=$(ps -o ppid= -p "$PID_NOW" 2>/dev/null | tr -d ' ')
  echo "ppid=$PPID_NOW"
fi
echo ""
echo "=== PM2 DELETE (stop autorestart) ==="
sudo -n pm2 delete repark-h5 2>/dev/null && echo DELETED || echo NOT_FOUND
echo ""
echo "=== WAIT 3s for PM2 to fully release ==="
sleep 3
echo ""
echo "=== KILL ORPHAN ==="
PID_KILL=$(ss -ltnp 2>/dev/null | grep ':3000' 2>/dev/null | head -1 | sed 's/.*pid=//' | sed 's/,.*//')
echo "killing pid=$PID_KILL"
sudo kill -9 $PID_KILL 2>/dev/null && echo KILLED || echo ALREADY_DEAD
sleep 3
echo ""
echo "=== PORT CHECK ==="
ss -ltnp 2>/dev/null | grep :3000 || echo FREE
echo ""
echo "=== PM2 START ==="
sudo -n pm2 start /var/www/app/ecosystem.config.js --env production 2>&1
sleep 20
echo ""
echo "=== PM2 STATUS ==="
sudo -n pm2 list 2>&1 | head -10
PM2PID=$(sudo -n pm2 pid repark-h5 2>/dev/null | head -1)
echo "pm2_pid=$PM2PID"
echo ""
echo "=== PORT ==="
ss -ltnp 2>/dev/null | grep :3000 || echo NONE
ACTUAL_PID=$(ss -ltnp 2>/dev/null | grep ':3000' 2>/dev/null | head -1 | sed 's/.*pid=//' | sed 's/,.*//')
echo "actual_pid=$ACTUAL_PID"
echo ""
echo "=== PARENT CHAIN ==="
PM2D=$(pm2 pid 2>/dev/null | head -1 || echo '')
echo "pm2_daemon=$PM2D"
if [ -n "$ACTUAL_PID" ]; then
  PPID_CHAIN=$(ps -o ppid= -p "$ACTUAL_PID" 2>/dev/null | tr -d ' ' || echo '')
  echo "actual_ppid=$PPID_CHAIN"
  if [ "$PPID_CHAIN" = "$PM2D" ]; then
    echo "RESULT=ONLINE_UNDER_PM2"
  else
    echo "RESULT=ORPHAN"
  fi
fi
echo ""
echo "=== HEALTH ==="
curl -s -o /dev/null -w '/api/time: %{http_code}\n' http://127.0.0.1:3000/api/time || echo FAILED
curl -s -o /dev/null -w '/lb: %{http_code}\n' http://127.0.0.1:3000/api/battle/leaderboard || echo FAILED
echo ""
echo "=== BUILD_ID ==="
cat /var/www/app/.next/BUILD_ID
echo ""
echo "=== PM2 SAVE ==="
sudo -n pm2 save 2>&1 && echo SAVED || echo SAVE_FAIL
echo "=== DONE ==="
`;

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      console.log('[SSH] Connected.');
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
