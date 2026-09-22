// scripts/drift-fetch-list-route.mjs
// READ-ONLY: pulls /var/www/app/app/api/admin/users/list/route.ts from
// production, computes its SHA256 (remote-side), prints contents, and saves
// a local copy for diffing. Does NOT modify anything on the remote.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const REMOTE_PATH = '/var/www/app/app/api/admin/users/list/route.ts';
const LOCAL_OUT = path.resolve('.audit/drift-list-route.remote.ts');

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex').toUpperCase();
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();

  await new Promise((resolve, reject) => {
    client.on('ready', resolve);
    client.on('error', reject);
    client.connect({
      host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME,
      privateKey, passphrase: PASSPHRASE, readyTimeout: 15000,
    });
  });
  log('SSH', 'Connected');

  // Remote-side: compute SHA256 + size + mtime. Read-only.
  const hashCmd = `sha256sum ${REMOTE_PATH}; stat -c 'size=%s mtime=%Y' ${REMOTE_PATH}; echo END`;
  const meta = await new Promise((resolve, reject) => {
    client.exec(hashCmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.stderr.on('data', (c) => process.stderr.write(c));
      stream.on('data', (c) => (out += c.toString()));
      stream.on('close', () => resolve(out));
    });
  });
  log('SSH', `remote_meta:\n${meta.trim()}`);

  // SFTP read of the actual file content.
  const sftp = await new Promise((resolve, reject) => {
    client.sftp((err, s) => err ? reject(err) : resolve(s));
  });
  log('SFTP', 'Opened for read-only fetch');

  const buf = await new Promise((resolve, reject) => {
    const chunks = [];
    const rs = sftp.createReadStream(REMOTE_PATH);
    rs.on('data', (c) => chunks.push(c));
    rs.on('error', reject);
    rs.on('close', () => resolve(Buffer.concat(chunks)));
  });
  log('SFTP', `Read ${buf.length} bytes from remote`);

  sftp.end();
  client.end();
  log('SSH', 'Disconnected (read-only, no writes to remote)');

  // Local hash verification of fetched bytes.
  const localHash = sha256(buf);
  log('LOCAL', `local_hash_of_fetched_bytes=${localHash}`);

  await writeFile(LOCAL_OUT, buf);
  log('LOCAL', `Saved remote copy to ${LOCAL_OUT}`);

  console.log('\n=== FETCHED_REMOTE_BYTES_SHA256 ===');
  console.log(localHash);
  console.log('=== BYTES_LENGTH ===');
  console.log(String(buf.length));
  console.log('=== END ===');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
