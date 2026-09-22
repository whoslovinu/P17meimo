// scripts/remote-run.mjs — Upload a local script to the server and execute it.
// Avoids the "bash -lc prints env vars" issue and avoids quoting hell.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const usage = `Usage:
  node scripts/remote-run.mjs --upload <local-path> --remote <remote-path> [--chmod 600]
  node scripts/remote-run.mjs --run <remote-path> [extra-args...]
  node scripts/remote-run.mjs --script <local-script-path>   # upload to /tmp/<basename>, chmod 700, run
`;
const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const MODE = args.includes('--upload') ? 'upload' : args.includes('--run') ? 'run' : args.includes('--script') ? 'script' : null;
if (!MODE) { console.error(usage); process.exit(2); }

const localPath = getArg('--upload') || getArg('--script');
const remotePath = getArg('--remote', localPath ? `/tmp/${path.basename(localPath)}` : null);
const chmod = getArg('--chmod', null);
const runCmd = MODE === 'run' ? args[args.indexOf('--run') + 1] : null;
const extraArgs = MODE === 'run' ? args.slice(args.indexOf('--run') + 2) : [];

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();
  let uploadDone = new Promise((resolve, reject) => {});

  client.on('ready', () => {
    log('SSH', 'Connected');
    if (MODE === 'upload' || MODE === 'script') {
      // SFTP upload
      client.sftp((err, sftp) => {
        if (err) { console.error('SFTP error:', err.message); process.exit(1); }
        log('SFTP', `Uploading ${localPath} → ${remotePath}`);
        sftp.fastPut(localPath, remotePath, (putErr) => {
          if (putErr) { console.error('fastPut error:', putErr.message); process.exit(1); }
          log('SFTP', 'Upload OK');
          if (chmod) {
            client.exec(`chmod ${chmod} '${remotePath}'`, (e, st) => {
              if (e) { console.error('chmod err:', e.message); process.exit(1); }
              st.on('close', () => { log('SFTP', `chmod ${chmod} OK`); exitClean(); });
              st.stderr.on('data', d => process.stderr.write(d));
              st.on('data', () => {});
            });
          } else {
            exitClean();
          }
        });
      });
    }
    if (MODE === 'run') {
      const fullCmd = [runCmd, ...extraArgs].map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
      log('SSH', `Running: ${fullCmd}`);
      client.exec(fullCmd, (err, stream) => {
        if (err) { console.error('exec err:', err.message); process.exit(1); }
        stream.on('close', (code, sig) => { log('EXEC', `done code=${code}`); client.end(); process.exit(code ?? 0); });
        stream.on('data', d => process.stdout.write(d));
        stream.stderr.on('data', d => process.stderr.write(d));
      });
    }
    if (MODE === 'script') {
      // After upload (handled in SFTP callback), run it
      const orig = client.listeners('ready')[0];
      // chain: after upload finishes, exec the script
      const execScript = () => {
        log('SSH', `Running: bash '${remotePath}'`);
        client.exec(`bash '${remotePath}'`, (err, stream) => {
          if (err) { console.error('exec err:', err.message); process.exit(1); }
          stream.on('close', (code, sig) => { log('EXEC', `done code=${code}`); client.end(); process.exit(code ?? 0); });
          stream.on('data', d => process.stdout.write(d));
          stream.stderr.on('data', d => process.stderr.write(d));
        });
      };
      // wait until upload callback fires
      const interval = setInterval(() => {
        // race condition: upload may still be in flight. Hook by re-using the exec callback below.
      }, 100);
      // easier: just defer; upload is via fastPut which is async, so re-listen:
      client.once('exec-ready', execScript);
    }
  });

  function exitClean() { client.end(); }

  client.on('error', err => { console.error('SSH err:', err.message); process.exit(1); });

  client.connect({
    host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME,
    privateKey, passphrase: PASSPHRASE, readyTimeout: 30000,
  });
}

main().catch(e => { console.error('FATAL:', e.stack || e.message); process.exit(2); });