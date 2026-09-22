// scripts/d1r1c-proc.mjs — Identify what's running on port 3000
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');

function log(label, msg) { console.log(`[${label}] ${msg}`); }

async function sshExec(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) { reject(err); return; }
      let out = '', err2 = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => err2 += d);
      stream.on('close', () => resolve({ out, err: err2 }));
    });
  });
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();
  await new Promise((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', reject);
    client.connect({ host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME, privateKey, readyTimeout: 30000 });
  });
  log('SSH', 'Connected');

  // What owns port 3000?
  log('PROC', 'lsof on port 3000:');
  const lsof = await sshExec(client, 'lsof -i :3000 2>/dev/null || fuser 3000/tcp 2>/dev/null || echo "no lsof/fuser"');
  log('PROC', lsof.out);

  // ps aux for node/next processes
  log('PROC', 'Node/next processes:');
  const ps = await sshExec(client, 'ps aux | grep -E "node|next|repark" | grep -v grep | head -10');
  log('PROC', ps.out);

  // systemd status
  log('PROC', 'systemd repark:');
  const sysd = await sshExec(client, 'sudo systemctl status repark-h5 2>/dev/null || sudo systemctl status nextjs 2>/dev/null || echo "no systemd service found"');
  log('PROC', sysd.out.slice(0, 600));

  // How was the app started?
  log('PROC', 'Process tree for port 3000 owner:');
  const pidOfPort = await sshExec(client, 'ss -tlnp | grep 3000');
  const pidMatch = pidOfPort.out.match(/pid=(\d+)/);
  if (pidMatch) {
    const pid = pidMatch[1];
    const tree = await sshExec(client, `pstree -p ${pid} 2>/dev/null || cat /proc/${pid}/cmdline 2>/dev/null | tr "\\0" " "`);
    log('PROC', `PID ${pid}: ${tree.out.trim()}`);
    const environ = await sshExec(client, `cat /proc/${pid}/environ 2>/dev/null | tr "\\0" "\\n" | grep -E "NODE_ENV|NEXT_|APP_" | head -10`);
    log('PROC', `ENV: ${environ.out.trim()}`);
  } else {
    log('PROC', 'Could not extract PID from ss output');
    log('PROC', pidOfPort.out);
  }

  // Check if the app is listening on 3000 by testing it
  log('HEALTH', 'Direct HTTP test on port 3000:');
  const httpTest = await sshExec(client, 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/time --max-time 10');
  log('HEALTH', `HTTP ${httpTest.out.trim()}`);

  client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(9); });
