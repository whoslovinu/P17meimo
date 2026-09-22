// scripts/d1r1c-probe.mjs — Probe production state and PM2
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';
import https from 'node:https';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');

function log(label, msg) { console.log(`[${label}] ${msg}`); }
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

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

  // List all PM2 processes
  log('PM2', 'All PM2 processes:');
  const pm2list = await sshExec(client, 'pm2 jlist 2>/dev/null');
  log('PM2', pm2list.out.slice(0, 2000));

  // Check port 3000 listeners
  log('NET', 'Port 3000 listeners:');
  const portCheck = await sshExec(client, 'ss -tlnp 2>/dev/null | grep 3000 || netstat -tlnp 2>/dev/null | grep 3000 || echo "no listeners"');
  log('NET', portCheck.out);

  // Health
  log('HEALTH', 'Testing https://98.93.252.250/api/time');
  try {
    const r = await httpGet('https://98.93.252.250/api/time');
    log('HEALTH', `HTTP ${r.status}`);
  } catch(e) { log('HEALTH', `FAILED: ${e.message}`); }

  // Check .next BUILD_ID
  const buildId = await sshExec(client, 'cat /var/www/app/.next/BUILD_ID 2>/dev/null');
  log('BUILD', `BUILD_ID: ${buildId.out.trim()}`);

  // Verify deployed file hash
  const h = await sshExec(client, 'sha256sum /var/www/app/app/admin/users/page.tsx 2>/dev/null || python3 -c "import hashlib; print(hashlib.sha256(open(\'/var/www/app/app/admin/users/page.tsx\',\'rb\').read()).hexdigest())"');
  log('HASH', `Deployed hash: ${h.out.trim().split(' ')[0].toUpperCase()}`);

  // Verify 模糊筛选 in bundle
  const fuzzy = await sshExec(client, 'grep -l "模糊筛选" /var/www/app/.next/static/chunks/app/admin/users/*.js 2>/dev/null || echo "NOT FOUND"');
  log('BUNDLE', `模糊筛选 found in: ${fuzzy.out.trim()}`);

  // Verify 重置 and 返回列表 in bundle
  const reset = await sshExec(client, 'grep -l "重置" /var/www/app/.next/static/chunks/app/admin/users/*.js 2>/dev/null || echo "NOT FOUND"');
  log('BUNDLE', `重置 found in: ${reset.out.trim()}`);

  // #76 invariant check
  const inv76 = await sshExec(client, 'grep "selectedDamage" /var/www/app/app/admin/users/page.tsx 2>/dev/null | head -5');
  log('INV76', inv76.out.trim() || 'NOT FOUND');

  client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(9); });
