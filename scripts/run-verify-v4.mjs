// scripts/run-verify-v4.mjs
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import path from 'node:path';

const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const HOST = '98.93.252.250';
const USER = 'ubuntu';

const SCRIPT = `
echo "=== PM2 DAEMON (correct way) ==="
DAEMON_PID=$(pm2 pid 2>/dev/null | head -1)
echo "pm2_daemon=$DAEMON_PID"
echo ""
echo "=== PM2 TRACKED PID ==="
TRACKED_PID=$(sudo -n pm2 pid repark-h5 2>/dev/null | head -1)
echo "tracked_pid=$TRACKED_PID"
echo ""
echo "=== PORT 3000 ==="
ss -ltnp 2>/dev/null | grep :3000 || echo NONE
ACTUAL_PID=$(ss -ltnp 2>/dev/null | grep ':3000' 2>/dev/null | head -1 | sed 's/.*pid=//' | sed 's/,.*//')
echo "actual_pid=$ACTUAL_PID"
echo ""
echo "=== ACTUAL PROCESS ==="
ps -fp $ACTUAL_PID 2>/dev/null || echo "NOT FOUND"
echo ""
echo "=== PARENT CHAIN ==="
PPID_ACTUAL=$(ps -o ppid= -p $ACTUAL_PID 2>/dev/null | tr -d ' ' || echo '')
echo "actual_pid=$ACTUAL_PID parent=$PPID_ACTUAL"
if [ "$PPID_ACTUAL" = "$DAEMON_PID" ]; then
  echo "RESULT=ONLINE_UNDER_PM2_DAEMON (correct)"
else
  echo "RESULT=ORPHAN"
fi
echo ""
echo "=== PM2 STATUS ==="
sudo -n pm2 list 2>&1 | head -10
echo ""
echo "=== ECOSYSTEM wait_ready ==="
grep -n 'wait_ready\|instances\|exec_mode' /var/www/app/ecosystem.config.js 2>/dev/null | head -10
echo ""
echo "=== HEALTH ==="
curl -s -o /dev/null -w '/api/time: %{http_code}\n' http://127.0.0.1:3000/api/time || echo FAILED
curl -s -o /dev/null -w '/lb: %{http_code}\n' http://127.0.0.1:3000/api/battle/leaderboard || echo FAILED
echo ""
echo "=== BUILD_ID ==="
cat /var/www/app/.next/BUILD_ID
echo ""
echo "=== afterrender in deployed code ==="
grep -c 'renderer.*afterrender\|afterrender.*renderer' /var/www/app/app/components/features/battle/SpineViewer.tsx 2>/dev/null && echo "AFTERRENDER=FOUND" || echo "AFTERRENDER=NOT_FOUND"
grep -n 'renderer.*on.*afterrender\|app.renderer.*afterrender' /var/www/app/app/components/features/battle/SpineViewer.tsx 2>/dev/null | head -5
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
        stream.on('close', (code) => { conn.end(); resolve(code); });
      });
    });
    conn.on('error', (err) => { console.error('SSH error:', err.message); reject(err); });
    conn.connect({ host: HOST, port: 22, username: USER, privateKey, readyTimeout: 30000 });
  });
}

main().then(code => process.exit(code ?? 0)).catch(e => { console.error('FATAL:', e.message); process.exit(1); });
