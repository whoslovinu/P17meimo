#!/usr/bin/env node
/**
 * scripts/upload-tarball.mjs
 * SFTP upload of a local tarball to /tmp/ on the AWS bastion,
 * then extract + build + PM2 restart via remote-shell.
 *
 * Usage:
 *   node scripts/upload-tarball.mjs <local_tarball> <remote_dest>
 *
 * Dependencies: ssh2 (already in package.json)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');

const LOCAL_TAR = process.argv[2];
const REMOTE_DEST = process.argv[3] ?? '/tmp/deploy.tar.gz';

if (!LOCAL_TAR) {
  console.error('Usage: node scripts/upload-tarball.mjs <local_tarball> [remote_dest]');
  process.exit(2);
}

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

async function main() {
  log('UPLOAD', `Reading ${LOCAL_TAR}`);
  const content = await readFile(LOCAL_TAR);
  log('UPLOAD', `File size: ${content.length} bytes`);

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
    client.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      log('SFTP', `Uploading to ${REMOTE_DEST} (${content.length} bytes)...`);
      const ws = sftp.createWriteStream(REMOTE_DEST, { mode: 0o644 });
      ws.on('close', () => {
        log('SFTP', 'Upload complete');
        resolve();
      });
      ws.on('error', reject);
      ws.end(content);
    });
  });

  client.end();
  log('DONE', `Uploaded ${LOCAL_TAR} -> ubuntu@${BASTION_HOST}:${REMOTE_DEST}`);
  process.exit(0);
}

main().catch((e) => { console.error('UPLOAD_ERROR:', e.message); process.exit(3); });
