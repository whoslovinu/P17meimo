// scripts/d1r1c-verify.mjs — Final verification after #82 deploy
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';
import https from 'node:https';
import net from 'node:net';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');

function log(label, msg) { console.log(`[${label}] ${msg}`); }

function httpGet(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpGetHttp(host, port, pathStr, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.setTimeout(timeoutMs);
    client.connect(port, host, () => {
      client.write(`GET ${pathStr} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    client.on('data', d => data += d);
    client.on('end', () => {
      const parts = data.split('\r\n');
      const statusLine = parts[0];
      const body = parts.slice(parts.indexOf('') + 1).join('\r\n');
      const status = parseInt(statusLine.split(' ')[1]);
      resolve({ status, body });
    });
    client.on('timeout', () => { client.destroy(); reject(new Error('timeout')); });
    client.on('error', reject);
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

  // Health on port 3000 (via SSH tunnel / curl)
  log('HEALTH', 'Testing http://98.93.252.250:3000/api/time');
  try {
    const r = await httpGetHttp('98.93.252.250', 3000, '/api/time');
    log('HEALTH', `HTTP ${r.status} - ${r.body.slice(0, 100)}`);
  } catch(e) { log('HEALTH', `FAILED: ${e.message}`); }

  // PM2 status via root
  log('PM2', 'PM2 status (root):');
  const desc = await sshExec(client, 'sudo pm2 list 2>/dev/null');
  log('PM2', desc.out.slice(0, 400));

  const newPidLine = await sshExec(client, "sudo ps aux | grep 'next-server' | grep -v grep | awk '{print \$2}'");
  log('PM2', `New PID: ${newPidLine.out.trim()}`);

  // BUILD_ID
  const buildId = await sshExec(client, 'cat /var/www/app/.next/BUILD_ID 2>/dev/null');
  log('BUILD', `BUILD_ID: ${buildId.out.trim()}`);

  // Verify #82 file hash
  const h82 = await sshExec(client, 'sha256sum /var/www/app/app/admin/users/page.tsx 2>/dev/null || python3 -c "import hashlib; print(hashlib.sha256(open(\'/var/www/app/app/admin/users/page.tsx\',\'rb\').read()).hexdigest())"');
  log('HASH82', `Deployed hash: ${h82.out.trim().split(' ')[0].toUpperCase()}`);

  // Verify #77 file hash
  const h77 = await sshExec(client, 'sha256sum /var/www/app/app/admin/activities/page.tsx 2>/dev/null || python3 -c "import hashlib; print(hashlib.sha256(open(\'/var/www/app/app/admin/activities/page.tsx\',\'rb\').read()).hexdigest())"');
  log('HASH77', `Deployed hash: ${h77.out.trim().split(' ')[0].toUpperCase()}`);

  // D1-R1 hashes
  for (const file of ['lib/db/pg.ts', 'app/api/action/attack/route.ts', 'app/api/admin/users/search/route.ts']) {
    const rh = await sshExec(client, `sha256sum "/var/www/app/${file}" 2>/dev/null || python3 -c "import hashlib; print(hashlib.sha256(open('/var/www/app/${file}','rb').read()).hexdigest())"`);
    log('D1R1', `${file}: ${rh.out.trim().split(' ')[0].toUpperCase()}`);
  }

  // #80 unchanged check
  log('#80', 'search/route.ts LIMIT check:');
  const r80 = await sshExec(client, 'grep -n "LIMIT" /var/www/app/app/api/admin/users/search/route.ts 2>/dev/null | head -5');
  log('#80', r80.out.trim() || 'no LIMIT found (OK - not in resolver)');

  // #76 semantic invariant
  log('#76', 'selectedDamage invariant:');
  const inv76 = await sshExec(client, 'grep -n "const selectedDamage" /var/www/app/app/admin/users/page.tsx');
  log('#76', inv76.out.trim());

  // #81 invariant
  log('#81', 'handleReset/handleBackToList:');
  const inv81a = await sshExec(client, 'grep -n "handleReset\\|handleBackToList\\|setListSearch\\|setPage" /var/www/app/app/admin/users/page.tsx | head -10');
  log('#81', inv81a.out.trim());

  // Bundle check for fuzzy copy
  log('BUNDLE', 'Checking compiled bundle for key copy strings:');
  const fuzzy = await sshExec(client, 'grep -c "模糊筛选" /var/www/app/.next/static/chunks/app/admin/users/*.js 2>/dev/null || echo "0"');
  log('BUNDLE', `模糊筛选 occurrences: ${fuzzy.out.trim()}`);
  const reset = await sshExec(client, 'grep -c "重置" /var/www/app/.next/static/chunks/app/admin/users/*.js 2>/dev/null || echo "0"');
  log('BUNDLE', `重置 occurrences: ${reset.out.trim()}`);
  const back = await sshExec(client, 'grep -c "返回列表" /var/www/app/.next/static/chunks/app/admin/users/*.js 2>/dev/null || echo "0"');
  log('BUNDLE', `返回列表 occurrences: ${back.out.trim()}`);

  // Error log check
  log('LOGS', 'Recent errors:');
  const errLog = await sshExec(client, 'sudo tail -100 /home/ubuntu/.pm2/logs/repark-h5-out.log 2>/dev/null | grep -iE "error|Error|ERROR|fail|Fail|FAILED" | tail -20 || sudo tail -100 /root/.pm2/logs/repark-h5-out.log 2>/dev/null | grep -iE "error|Error|ERROR|fail|Fail" | tail -20 || echo "clean"');
  log('LOGS', errLog.out.trim() || 'clean');

  client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(9); });
