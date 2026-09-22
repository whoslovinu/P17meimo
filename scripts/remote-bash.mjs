// scripts/remote-bash.mjs — SFTP-upload a local script to the server, then
// exec it via bash. No login shell, no env-printing. Plain pipe.
//
// Usage:
//   node scripts/remote-bash.mjs <local-script> [extra-bash-args...]
//
// After upload to /tmp/<basename>, runs: bash /tmp/<basename> [args]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const localPath = process.argv[2];
if (!localPath) { console.error('Usage: node scripts/remote-bash.mjs <local-script> [args...]'); process.exit(2); }
const extraArgs = process.argv.slice(3);

const baseName = path.basename(localPath);
const remotePath = `/tmp/${baseName}`;
const privateKey = await readFile(KEY_PATH, 'utf8');
const rawBody = await readFile(localPath, 'utf8');
// Force LF line endings (Windows CRLF breaks bash)
const body = rawBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

const client = new SshClient();

client.on('ready', () => {
  log('SSH', 'Connected. Opening SFTP...');
  client.sftp((err, sftp) => {
    if (err) { console.error('SFTP err:', err.message); process.exit(1); }
    log('SFTP', `Writing ${body.length} bytes to ${remotePath}`);
    const ws = sftp.createWriteStream(remotePath, { mode: 0o755 });
    ws.on('close', () => {
      log('SFTP', 'Upload OK. Running bash...');
      const quotedArgs = extraArgs.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
      const cmd = `bash '${remotePath}' ${quotedArgs}`.trim();
      log('SSH', `Exec: ${cmd}`);
      client.exec(cmd, (e, stream) => {
        if (e) { console.error('exec err:', e.message); process.exit(1); }
        stream.on('close', (code) => {
          log('EXEC', `Done code=${code}`);
          client.end();
          process.exit(code ?? 0);
        });
        stream.on('data', d => process.stdout.write(d));
        stream.stderr.on('data', d => process.stderr.write(d));
      });
    });
    ws.on('error', e => { console.error('write err:', e.message); process.exit(1); });
    ws.end(body);
  });
});

client.on('error', err => { console.error('SSH err:', err.message); process.exit(1); });
client.connect({
  host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME,
  privateKey, passphrase: PASSPHRASE, readyTimeout: 30000,
});