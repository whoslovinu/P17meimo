// scripts/d1r1c-final.mjs — Final health check via SSH
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

  // Health via curl
  log('HEALTH', 'GET /api/time:');
  const r = await sshExec(client, 'curl -s -o /dev/null -w "HTTP %{http_code}" http://127.0.0.1:3000/api/time --max-time 10');
  log('HEALTH', r.out.trim());

  // PM2 PID
  const pid = await sshExec(client, "sudo ps aux | grep 'next-server' | grep -v grep | awk '{print \$2}'");
  log('PM2', `PID: ${pid.out.trim()}`);

  // PM2 status
  const status = await sshExec(client, 'sudo pm2 list 2>/dev/null | grep repark-h5');
  log('PM2', status.out.trim());

  // BUILD_ID
  const bid = await sshExec(client, 'cat /var/www/app/.next/BUILD_ID');
  log('BUILD', `BUILD_ID: ${bid.out.trim()}`);

  // Nginx proxy test
  log('NGINX', 'Nginx proxy test:');
  const nginx = await sshExec(client, 'curl -s -o /dev/null -w "HTTP %{http_code}" http://127.0.0.1/api/time --max-time 10 2>/dev/null || echo "nginx not listening locally"');
  log('NGINX', nginx.out.trim());

  client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(9); });
