// scripts/d1r1c-root.mjs — Root PM2 investigation and restart
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';
import https from 'node:https';

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

  // Run as root via sudo
  log('ROOT', 'PM2 list as root:');
  const pm2Root = await sshExec(client, 'sudo pm2 list 2>/dev/null');
  log('ROOT', pm2Root.out.slice(0, 1000));

  log('ROOT', 'PM2 jlist as root:');
  const pm2jRoot = await sshExec(client, 'sudo pm2 jlist 2>/dev/null');
  log('ROOT', pm2jRoot.out.slice(0, 1000));

  // Find next-server PID via root
  log('ROOT', 'next-server PID via root:');
  const pidRoot = await sshExec(client, "sudo ps aux | grep 'next-server' | grep -v grep | awk '{print \$2, \$3, \$11, \$12, \$13}'");
  log('ROOT', pidRoot.out.trim());

  // Verify if the new build is active by checking what BUILD_ID it reports
  // via a fresh API call
  log('HEALTH', 'Testing API via curl (local):');
  const apiTest = await sshExec(client, 'curl -s http://127.0.0.1:3000/api/time --max-time 10');
  log('HEALTH', `Response: ${apiTest.out.trim().slice(0, 100)}`);

  // Check what BUILD_ID is currently served
  log('BUILD', 'Current BUILD_ID:');
  const buildId = await sshExec(client, 'cat /var/www/app/.next/BUILD_ID 2>/dev/null');
  log('BUILD', buildId.out.trim());

  // The issue: build happened, .next updated, but next-server still serves old chunks
  // Solution: graceful restart via root PM2
  log('PM2', 'Sending graceful reload to root PM2:');
  const reload = await sshExec(client, 'sudo pm2 reload repark-h5 --update-env 2>&1 || sudo pm2 reload all 2>&1 || echo "reload_failed"');
  log('PM2', reload.out.slice(0, 300));

  // Wait 15 seconds
  log('WAIT', 'Waiting 15 seconds for restart...');
  await new Promise(r => setTimeout(r, 15000));

  // Verify new PID
  log('VERIFY', 'Checking new next-server PID:');
  const newPid = await sshExec(client, "sudo ps aux | grep 'next-server' | grep -v grep | awk '{print \$2}'");
  log('VERIFY', `New PID: ${newPid.out.trim()}`);

  // Health after restart
  log('HEALTH2', 'API test after reload:');
  const api2 = await sshExec(client, 'curl -s http://127.0.0.1:3000/api/time --max-time 10');
  log('HEALTH2', `Response: ${api2.out.trim().slice(0, 100)}`);
  log('HEALTH2', `Error: ${api2.err.trim().slice(0, 100)}`);

  // Check new BUILD_ID
  const newBuildId = await sshExec(client, 'cat /var/www/app/.next/BUILD_ID 2>/dev/null');
  log('BUILD2', `BUILD_ID after reload: ${newBuildId.out.trim()}`);

  client.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(9); });
