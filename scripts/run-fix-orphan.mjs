// scripts/run-fix-orphan.mjs
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import path from 'node:path';

const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const HOST = '98.93.252.250';
const USER = 'ubuntu';

const SCRIPT = `
echo "=== CURRENT STATE ==="
ss -ltnp 2>/dev/null | grep :3000 || echo FREE
PID_NOW=$(ss -ltnp 2>/dev/null | grep ':3000' 2>/dev/null | head -1 | sed 's/.*pid=//' | sed 's/,.*//')
echo "current_pid=$PID_NOW"
echo ""
echo "=== KILL CURRENT PORT HOLDER ==="
if [ -n "$PID_NOW" ]; then
  sudo kill -9 $PID_NOW 2>/dev/null && echo "KILLED $PID_NOW" || echo "ALREADY_DEAD"
fi
sleep 4
echo ""
echo "=== VERIFY PORT FREE ==="
ss -ltnp 2>/dev/null | grep :3000 || echo FREE
echo ""
echo "=== START PM2 FRESH ==="
sudo -n pm2 delete repark-h5 2>/dev/null || true
sleep 1
sudo -n pm2 start /var/www/app/ecosystem.config.js --env production 2>&1
sleep 20
echo ""
echo "=== PM2 STATUS ==="
sudo -n pm2 list 2>&1 | head -10
PM2PID=$(sudo -n pm2 pid repark-h5 2>/dev/null | head -1)
echo "pm2_pid=$PM2PID"
echo ""
echo "=== PORT 3000 ==="
ss -ltnp 2>/dev/null | grep :3000 || echo NONE
NEW_PID=$(ss -ltnp 2>/dev/null | grep ':3000' 2>/dev/null | head -1 | sed 's/.*pid=//' | sed 's/,.*//')
echo "new_pid=$NEW_PID"
echo ""
echo "=== PARENT ==="
for p in $PM2PID $NEW_PID; do
  PPID_VAL=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ' || echo '')
  echo "pid=$p ppid=$PPID_VAL"
done
PM2D=$(pm2 pid 2>/dev/null | head -1 || echo '')
if [ -n "$NEW_PID" ] && [ -n "$PM2D" ]; then
  PPID_VAL=$(ps -o ppid= -p "$NEW_PID" 2>/dev/null | tr -d ' ')
  if [ "$PPID_VAL" = "$PM2D" ]; then
    echo "RESULT=ONLINE_UNDER_PM2"
  else
    echo "RESULT=ORPHAN parent=$PPID_VAL"
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
