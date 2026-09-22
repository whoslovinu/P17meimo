// scripts/run-check-gate.mjs
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import path from 'node:path';

const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const HOST = '98.93.252.250';
const USER = 'ubuntu';

const SCRIPT = `
echo "=== WHAT TIMING GATE IS IN SERVER CODE? ==="
grep -n 'app.ticker.addOnce\|app.renderer.on\|ticker.addOnce\|renderer.on' /var/www/app/app/components/features/battle/SpineViewer.tsx 2>/dev/null | head -10
echo ""
echo "=== LINE 1300-1310 context ==="
sed -n '1295,1320p' /var/www/app/app/components/features/battle/SpineViewer.tsx 2>/dev/null
echo ""
echo "=== SEARCH afterrender anywhere ==="
grep -n 'afterrender' /var/www/app/app/components/features/battle/SpineViewer.tsx 2>/dev/null | head -10
echo ""
echo "=== TOTAL LINES IN FILE ==="
wc -l /var/www/app/app/components/features/battle/SpineViewer.tsx 2>/dev/null
echo ""
echo "=== BUILD_ID ==="
cat /var/www/app/.next/BUILD_ID
echo ""
echo "=== HEALTH ==="
curl -s -o /dev/null -w '/api/time: %{http_code}\n' http://127.0.0.1:3000/api/time || echo FAILED
echo ""
echo "=== PM2 STATUS ==="
sudo -n pm2 list 2>&1 | head -10
DAEMON_PID=$(pm2 pid 2>/dev/null | head -1)
TRACKED_PID=$(sudo -n pm2 pid repark-h5 2>/dev/null | head -1)
ACTUAL_PID=$(ss -ltnp 2>/dev/null | grep ':3000' 2>/dev/null | head -1 | sed 's/.*pid=//' | sed 's/,.*//')
echo "daemon=$DAEMON_PID tracked=$TRACKED_PID actual=$ACTUAL_PID"
PPID_ACTUAL=$(ps -o ppid= -p $ACTUAL_PID 2>/dev/null | tr -d ' ' || echo '')
echo "actual_ppid=$PPID_ACTUAL"
if [ "$PPID_ACTUAL" = "$DAEMON_PID" ]; then
  echo "RESULT=ONLINE_UNDER_PM2"
else
  echo "RESULT=ORPHAN"
fi
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
    conn.on('error', (err) => { console.error('SSH error:', err.message); reject(err); });
    conn.connect({ host: HOST, port: 22, username: USER, privateKey, readyTimeout: 30000 });
  });
}

main().then(code => process.exit(code ?? 0)).catch(e => { console.error('FATAL:', e.message); process.exit(1); });
