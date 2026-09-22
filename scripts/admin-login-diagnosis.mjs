// scripts/admin-login-diagnosis.mjs
// Diagnoses and fixes the admin login 401 issue on production.
// Checks PM2 env, verifies ADMIN_SECRET_KEY, and restarts if needed.

import { readFile } from 'node:fs/promises';
import { Client as SshClient } from 'ssh2';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KEY_PATH = path.resolve(__dirname, '../keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';

const EXPECTED_SECRET = 'giys-agjj-niqt-yx2g';

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

async function sshExec(client, cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) { reject(err); return; }
      let out = '';
      let errOut = '';
      stream.on('close', (code) => resolve({ code, out, err: errOut }));
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
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
      host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME,
      privateKey, passphrase: PASSPHRASE, readyTimeout: 30000,
    });
  });
  log('SSH', 'Connected to production');

  // Step 1: Check what PM2 process is running
  log('PM2', 'Checking PM2 status...');
  const status = await sshExec(client, 'pm2 jlist');
  try {
    const processes = JSON.parse(status.out);
    const app = processes.find(p => p.name === 'repark-h5');
    if (!app) {
      log('PM2', 'repark-h5 not found! Processes: ' + processes.map(p => p.name).join(', '));
    } else {
      log('PM2', `Found repark-h5 PID=${app.pid}, status=${app.pm2_env?.status}`);
      log('PM2', `NODE_ENV=${app.pm2_env?.NODE_ENV}`);
      log('PM2', `ADMIN_SECRET_KEY env=${app.pm2_env?.env?.ADMIN_SECRET_KEY ?? '(not set)'}`);

      const actualSecret = app.pm2_env?.env?.ADMIN_SECRET_KEY;
      if (actualSecret === EXPECTED_SECRET) {
        log('DIAG', '✅ ADMIN_SECRET_KEY in PM2 MATCHES expected value');
      } else {
        log('DIAG', `❌ MISMATCH! PM2 has: "${actualSecret}"`);
        log('DIAG', `        Expected:  "${EXPECTED_SECRET}"`);
        log('FIX', 'Uploading corrected .env.production and restarting PM2...');

        // Read local .env.production
        const localEnv = await readFile(path.resolve(__dirname, '../.env.production'), 'utf8');

        // Upload via SFTP
        await new Promise((resolve, reject) => {
          client.sftp((err, sftp) => {
            if (err) { reject(err); return; }
            const ws = sftp.createWriteStream('/var/www/app/.env.production', { mode: 0o600 });
            ws.on('close', () => { log('SFTP', 'Uploaded .env.production'); resolve(); });
            ws.on('error', e => reject(e));
            ws.end(localEnv);
          });
        });

        // Restart PM2
        log('PM2', 'Restarting repark-h5...');
        await sshExec(client, 'pm2 restart repark-h5 --env production && pm2 save');
        log('PM2', 'Restart done');

        // Wait a moment and verify
        await new Promise(r => setTimeout(r, 3000));
        const afterRestart = await sshExec(client, 'pm2 jlist');
        const afterProcesses = JSON.parse(afterRestart.out);
        const afterApp = afterProcesses.find(p => p.name === 'repark-h5');
        log('PM2', `After restart — ADMIN_SECRET_KEY: "${afterApp?.pm2_env?.env?.ADMIN_SECRET_KEY}"`);
      }
    }
  } catch (e) {
    log('ERR', `PM2 jlist parse failed: ${e.message}`);
    log('ERR', `stdout: ${status.out.slice(0, 500)}`);
  }

  // Step 2: Test login with curl
  log('CURL', 'Testing POST /api/admin/login with correct password...');
  const curlCmd = `curl -s -X POST http://localhost:3000/api/admin/login ` +
    `-H "Content-Type: application/json" ` +
    `-d '{"password":"${EXPECTED_SECRET}"}' ` +
    `-w "\\nHTTP_CODE:%{http_code}" ` +
    `-D /tmp/curl-headers.txt -o /tmp/curl-body.txt 2>&1; ` +
    `echo "BODY:"; cat /tmp/curl-body.txt; ` +
    `echo "HEADERS:"; cat /tmp/curl-headers.txt`;

  const curlResult = await sshExec(client, curlCmd);
  console.log(curlResult.out);
  if (curlResult.err) console.error('CURL ERR:', curlResult.err);

  client.end();
  log('DONE', 'Diagnosis complete');
}

main().catch(e => { console.error('FATAL:', e.stack || e.message); process.exit(2); });
