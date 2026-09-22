// scripts/repark_upload_route.mjs — SFTP upload a single TS file to /var/www/app
// Used for incremental deploys that don't require a fresh git pull.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');

const LOCAL = path.resolve(process.argv[2]);
const REMOTE = process.argv[3];
if (!LOCAL || !REMOTE) {
  console.error('Usage: node repark_upload_route.mjs <local_path> <remote_path>');
  process.exit(2);
}

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();
  await new Promise((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', reject);
    client.connect({
      host: BASTION_HOST,
      port: BASTION_PORT,
      username: BASTION_USERNAME,
      privateKey,
    });
  });
  log('SSH', 'Connected');
  await new Promise((resolve, reject) => {
    client.sftp(async (err, sftp) => {
      if (err) { console.error('SFTP err:', err.message); process.exit(1); }
      const content = await readFile(LOCAL, 'utf8');
      log('SFTP', `Uploading ${LOCAL} → ${REMOTE} (${content.length} bytes)`);
      await new Promise((res2, rej2) => {
        const ws = sftp.createWriteStream(REMOTE, { mode: 0o644 });
        ws.on('close', res2);
        ws.on('error', rej2);
        ws.end(content);
      });
      log('SFTP', 'Upload complete');
      client.end();
      resolve();
    });
  });
  client.on('end', () => process.exit(0));
}

main().catch((e) => { console.error('UPLOAD_ERROR:', e.message); process.exit(3); });