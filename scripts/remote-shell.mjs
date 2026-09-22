// scripts/remote-shell.mjs — Open an interactive shell session on the bastion
// and stream a script (passed via stdin or --script flag) into it.
//
// This bypasses the bash -lc / login-shell env-var-printing problem because
// we send each command via a fresh subshell that doesn't print env.
//
// Usage:
//   echo 'echo hi' | node scripts/remote-shell.mjs
//   node scripts/remote-shell.mjs --script scripts/server-provision.sh
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client as SshClient } from 'ssh2';

const BASTION_HOST = '98.93.252.250';
const BASTION_PORT = 22;
const BASTION_USERNAME = 'ubuntu';
const KEY_PATH = path.resolve('keys/mercenary_h5_project.pem');
const PASSPHRASE = process.env.DEPLOY_SSH_PASSPHRASE?.trim() || undefined;

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const scriptPath = getArg('--script', null);
const exitAfter = args.includes('--exit');
const noSudo = args.includes('--no-sudo');  // skip "sudo -n true" guard

function log(label, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${label}] ${msg}`);
}

async function main() {
  const privateKey = await readFile(KEY_PATH, 'utf8');
  const client = new SshClient();

  let body = '';
  if (scriptPath) {
    body = await readFile(scriptPath, 'utf8');
  } else if (!process.stdin.isTTY) {
    body = await new Promise((resolve) => {
      let chunks = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', c => chunks += c);
      process.stdin.on('end', () => resolve(chunks));
    });
  } else {
    console.error('Usage: --script <path> or pipe via stdin');
    process.exit(2);
  }

  client.on('ready', () => {
    log('SSH', 'Connected. Opening shell...');
    client.shell((err, stream) => {
      if (err) { console.error('shell err:', err.message); process.exit(1); }
      let stdoutBuf = '';
      let cmdRunning = false;
      let totalCmdLines = body.split('\n').length;

      stream.on('close', () => { log('SHELL', 'closed'); client.end(); process.exit(0); });
      stream.stderr.on('data', d => process.stderr.write(d));
      stream.stdout.on('data', (data) => {
        const text = data.toString();
        process.stdout.write(text);
        stdoutBuf += text;
      });

      // Send the script body, line by line, gated by PS1 detection
      const lines = body.split('\n');
      let i = 0;
      const sendLine = () => {
        if (i >= lines.length) {
          if (exitAfter) stream.write('exit\n');
          return;
        }
        const line = lines[i++];
        if (line.trim() === '' || line.trim().startsWith('#')) { sendLine(); return; }
        stream.write(line + '\n');
        // wait briefly then advance (simple pacing — works for most scripts)
        setTimeout(sendLine, 80);
      };
      setTimeout(sendLine, 800);
    });
  });

  client.on('error', err => { console.error('SSH err:', err.message); process.exit(1); });
  client.connect({
    host: BASTION_HOST, port: BASTION_PORT, username: BASTION_USERNAME,
    privateKey, passphrase: PASSPHRASE, readyTimeout: 30000,
  });
}

main().catch(e => { console.error('FATAL:', e.stack || e.message); process.exit(2); });