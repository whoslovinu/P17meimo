// scripts/run-check-pm2-daemon.mjs
import { readFile } from 'node:fs/promises';
import { Client } from 'ssh2';
import path from 'node:path';

const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const HOST = '98.93.252.250';
const USER = 'ubuntu';

const SCRIPT = `
echo "=== PM2 DAEMON PID ==="
PM2D=$(pm2 pid 2>/dev/null | head -1)
echo "pm2_daemon_pid=$PM2D"
echo ""
echo "=== WHO OWNS PM2 DAEMON? ==="
ps -fp $PM2D 2>/dev/null || echo "PM2 daemon not found"
echo ""
echo "=== PPID OF PM2 DAEMON ==="
PPID_D=$(ps -o ppid= -p $PM2D 2>/dev/null | tr -d ' ')
echo "pm2_daemon_ppid=$PPID_D"
ps -fp $PPID_D 2>/dev/null || echo "PPID $PPID_D not found"
echo ""
echo "=== PPID OF PPID (who owns init) ==="
PPID_PPID=$(ps -o ppid= -p $PPID_D 2>/dev/null | tr -d ' ')
echo "init_ppid=$PPID_PPID"
ps -fp $PPID_PPID 2>/dev/null || echo "init PPID $PPID_PPID not found"
echo ""
echo "=== PM2 DUMP.pm2 ==="
cat /root/.pm2/dump.pm2 2>/dev/null | head -30 || echo "NO DUMP"
echo ""
echo "=== /etc/init.d/pm2 ==="
ls /etc/init.d/pm2* 2>/dev/null || echo "NO INIT.D"
cat /etc/init.d/pm2* 2>/dev/null | head -20 || true
echo ""
echo "=== ECOSYSTEM CONFIG ==="
cat /var/www/app/ecosystem.config.js 2>/dev/null | head -20 || echo "NO CONFIG"
`;

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
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
