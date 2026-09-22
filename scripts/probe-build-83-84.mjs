// scripts/probe-build-83-84.mjs
// Orchestrates the isolated #83/#84 build probe end-to-end:
//   1. Uploads local app/api/admin/users/search/route.ts (post-fix) to
//      /tmp/local_search_route.ts on the remote.
//   2. Uploads scripts/probe-build-83-84.sh to /tmp/probe-build-83-84.sh
//      on the remote and chmods it 755.
//   3. Executes the remote script which:
//        a. mkdir /tmp/repark-build-probe-83-84/
//        b. rsync /var/www/app/ → probe dir (exclude .next)
//        c. verify pre-fix hashes
//        d. overwrite probe's search/route.ts with the uploaded local fix
//        e. verify post-fix hashes
//        f. npm run build:no-lint in the probe dir
//   4. Verifies /var/www/app unchanged (BUILD_ID + search/route.ts hash).
//
// ABSOLUTE SAFETY: never touches /var/www/app, PM2, DB, Redis.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const LOCAL_FIX_FILE = path.resolve('app/api/admin/users/search/route.ts');
const LOCAL_BASH_FILE = path.resolve('scripts/probe-build-83-84.sh');
const REMOTE_FIX_PATH = '/tmp/local_search_route.ts';
const REMOTE_BASH_PATH = '/tmp/probe-build-83-84.sh';
const PROBE_DIR = '/tmp/repark-build-probe-83-84';

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

function sftpUpload(sftp, localPath, remotePath, mode = 0o644) {
  return new Promise((resolve, reject) => {
    const ws = sftp.createWriteStream(remotePath, { mode });
    ws.on('close', resolve);
    ws.on('error', reject);
    readFile(localPath).then((buf) => ws.end(buf)).catch(reject);
  });
}

function sftpStat(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, st) => err ? reject(err) : resolve(st));
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
      privateKey, passphrase: PASSPHRASE, readyTimeout: 20000,
    });
  });
  log('SSH', 'Connected');

  const sftp = await new Promise((resolve, reject) => {
    client.sftp((err, s) => err ? reject(err) : resolve(s));
  });
  log('SFTP', 'Opened');

  // Pre-check: probe dir must NOT already exist (refuse to clobber).
  try {
    await sftpStat(sftp, PROBE_DIR);
    log('SFTP', `ABORT — ${PROBE_DIR} already exists on remote`);
    client.end();
    process.exit(20);
  } catch (e) {
    log('SFTP', `${PROBE_DIR} not present (expected): ${e.message}`);
  }

  // Upload the local post-fix search route.
  log('SFTP', `Uploading ${LOCAL_FIX_FILE} → ${REMOTE_FIX_PATH}`);
  await sftpUpload(sftp, LOCAL_FIX_FILE, REMOTE_FIX_PATH, 0o644);

  // Upload the bash orchestrator.
  log('SFTP', `Uploading ${LOCAL_BASH_FILE} → ${REMOTE_BASH_PATH}`);
  await sftpUpload(sftp, LOCAL_BASH_FILE, REMOTE_BASH_PATH, 0o755);

  // Close SFTP handle.
  sftp.end();

  // Run the bash script.
  log('EXEC', `Running ${REMOTE_BASH_PATH}`);
  const exitCode = await new Promise((resolve) => {
    client.exec(`bash ${REMOTE_BASH_PATH}`, (err, stream) => {
      if (err) { console.error('exec err:', err.message); resolve(99); return; }
      stream.on('data', (chunk) => process.stdout.write(chunk));
      stream.stderr.on('data', (chunk) => process.stderr.write(chunk));
      stream.on('close', (code) => resolve(code));
    });
  });
  log('EXEC', `probe script exit code: ${exitCode}`);

  // Post-verification: /var/www/app must still have original BUILD_ID and
  // its original search/route.ts hash (we never wrote to it).
  log('POSTCHECK', 'Verifying /var/www/app unchanged');
  const verifyCmd = `
    echo "live_build_id=$(cat /var/www/app/.next/BUILD_ID 2>/dev/null || echo NONE)";
    echo "live_search_hash=$(sha256sum /var/www/app/app/api/admin/users/search/route.ts | awk '{print $1}')";
    echo "live_list_hash=$(sha256sum /var/www/app/app/api/admin/users/list/route.ts | awk '{print $1}')";
    echo "live_pm2=$(pm2 list 2>/dev/null | grep -c 'online' || echo 0)";
    echo "probe_search_hash=$(sha256sum /tmp/repark-build-probe-83-84/app/api/admin/users/search/route.ts | awk '{print $1}')";
    echo "probe_list_hash=$(sha256sum /tmp/repark-build-probe-83-84/app/api/admin/users/list/route.ts | awk '{print $1}')";
    echo "probe_frontend_hash=$(sha256sum /tmp/repark-build-probe-83-84/app/admin/users/page.tsx | awk '{print $1}')";
    echo "probe_build_id=$(cat /tmp/repark-build-probe-83-84/.next/BUILD_ID 2>/dev/null || echo NONE)";
    echo "probe_build_present=$([ -d /tmp/repark-build-probe-83-84/.next ] && echo YES || echo NO)";
  `.replace(/\n/g, ' ');

  const verifyOut = await new Promise((resolve) => {
    let out = '';
    client.exec(verifyCmd, (err, stream) => {
      if (err) { console.error('verify exec err:', err.message); resolve(''); return; }
      stream.on('data', (chunk) => { out += chunk.toString('utf8'); process.stdout.write(chunk); });
      stream.on('close', () => resolve(out));
    });
  });

  log('POSTCHECK', '--- summary ---');
  for (const line of verifyOut.split('\n')) {
    if (line.includes('=')) console.log('  ' + line.trim());
  }

  client.end();
  log('SSH', 'Done');
  process.exit(exitCode);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
