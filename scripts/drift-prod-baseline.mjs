// scripts/drift-prod-baseline.mjs — READ ONLY
// Pulls BUILD_ID, PM2 status, /api/time from production
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USER = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;
const APP_DIR = '/var/www/app';

function log(label, msg) { console.log(`[${label}] ${msg}`); }

async function sshExec(client, cmd, label) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('data', (c) => { out += c.toString(); });
      stream.stderr.on('data', (c) => { errOut += c.toString(); });
      stream.on('close', () => resolve({ out: out.trim(), err: errOut.trim(), code: stream.exitCode ?? null }));
    });
  });
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();
  await new Promise((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', reject);
    client.connect({
      host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USER,
      privateKey, passphrase: PASSPHRASE, readyTimeout: 15000,
    });
  });
  log('SSH', 'Connected');

  try {
    const buildIdCmd = `cat ${APP_DIR}/.next/BUILD_ID 2>/dev/null || echo NO_BUILD_ID_FILE`;
    const buildId = await sshExec(client, buildIdCmd, 'BUILD_ID');
    log('BUILD_ID', `${buildId.out}`);

    const pm2Cmd = `pm2 list 2>/dev/null | head -40 || echo NO_PM2`;
    const pm2 = await sshExec(client, pm2Cmd, 'PM2');
    log('PM2', `${pm2.out}`);

    const processCmd = `ps -eo pid,etime,cmd | grep -E 'next-server|node.*next' | grep -v grep | head -10`;
    const process = await sshExec(client, processCmd, 'PROCESS');
    log('PROCESS', `${process.out}`);

    // /api/time — try via localhost + the public URL pattern that other scripts use
    const localTime = await sshExec(client, `curl -fsS --max-time 5 http://127.0.0.1:3000/api/time || echo LOCAL_API_TIME_FAILED`, 'API_TIME_LOCAL');
    log('API_TIME_LOCAL', `${localTime.out}`);

    // Detect public URL from nginx config (read-only)
    const nginx = await sshExec(client, `grep -h 'server_name' /etc/nginx/sites-enabled/*.conf 2>/dev/null | head -5 || true`, 'NGINX');
    log('NGINX', `${nginx.out}`);

    console.log('\n=== BASELINE_JSON ===');
    console.log(JSON.stringify({
      remote_build_id: buildId.out,
      remote_pm2: pm2.out,
      remote_process: process.out,
      api_time_local: localTime.out,
      nginx_server_names: nginx.out,
    }, null, 2));
    console.log('=== END ===');
  } finally {
    client.end();
    log('SSH', 'Disconnected');
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });